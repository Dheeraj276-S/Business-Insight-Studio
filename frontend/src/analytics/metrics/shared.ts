import type { AmountAggregation, DataRow, FieldId, Metric, Mappings } from '../types'
import { formatExactNumber } from '../formatting'

export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (raw.includes('%')) return null
  let text = raw.replace(/[\s$€£¥₹]/g, '')
  if (!text) return null
  const isParenthesized = text.startsWith('(') && text.endsWith(')')
  if (isParenthesized) text = text.slice(1, -1)
  if (text.includes(',') && text.includes('.') && text.lastIndexOf(',') > text.lastIndexOf('.')) {
    text = text.replace(/\./g, '').replace(',', '.')
  } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    text = text.replace(/,/g, '')
  } else if (/^-?\d+,\d{1,2}$/.test(text)) {
    text = text.replace(',', '.')
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null
  const number = Number(text) * (isParenthesized ? -1 : 1)
  return Number.isFinite(number) ? number : null
}

export function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/)
  if (iso) {
    const datePart = makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    if (!datePart) return null
    if (!/[T\s]/.test(text)) return datePart
    const timestamp = new Date(text)
    return Number.isNaN(timestamp.getTime()) ? null : timestamp
  }
  const numeric = text.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/)
  if (numeric) {
    const first = Number(numeric[1])
    const second = Number(numeric[2])
    if (first <= 12 && second <= 12 && first !== second) return null
    return makeDate(Number(numeric[3]), first > 12 ? second : first, first > 12 ? first : second)
  }
  if (!/[a-z]/i.test(text)) return null
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function makeDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null
}

export function numberValues(rows: DataRow[], column?: string): { values: number[]; invalid: number } {
  if (!column) return { values: [], invalid: 0 }
  const values: number[] = []
  let invalid = 0
  for (const row of rows) {
    const raw = row[column]
    if (raw === null || raw === undefined || String(raw).trim() === '') continue
    const parsed = parseNumber(raw)
    if (parsed === null) invalid += 1
    else values.push(parsed)
  }
  return { values, invalid }
}

export function sumField(rows: DataRow[], column?: string): number | null {
  const { values } = numberValues(rows, column)
  return values.length ? values.reduce((total, value) => total + value, 0) : null
}

export interface OrderAmounts {
  totals: Map<string, number>
  error?: string
}

export function orderAmounts(rows: DataRow[], amountColumn?: string, orderColumn?: string): OrderAmounts {
  if (!amountColumn || !orderColumn) return { totals: new Map(), error: 'Order-level aggregation requires mapped amount and order ID columns.' }
  const amounts = new Map<string, Set<number>>()
  let missingOrderIds = 0
  for (const row of rows) {
    const amount = parseNumber(row[amountColumn])
    if (amount === null) continue
    const orderId = String(row[orderColumn] ?? '').trim()
    if (!orderId) {
      missingOrderIds += 1
      continue
    }
    const values = amounts.get(orderId) ?? new Set<number>()
    values.add(amount)
    amounts.set(orderId, values)
  }
  if (missingOrderIds) return { totals: new Map(), error: `${missingOrderIds.toLocaleString()} rows with valid amounts have no order ID, so order totals cannot be deduplicated safely.` }
  const conflicts = [...amounts].filter(([, values]) => values.size > 1).map(([id]) => id)
  if (conflicts.length) return { totals: new Map(), error: `${conflicts.length.toLocaleString()} order IDs contain different mapped amounts. Choose row-level amounts or reconcile those orders before using order-level aggregation.` }
  const totals = new Map<string, number>()
  for (const [id, values] of amounts) {
    const value = values.values().next().value
    if (value !== undefined) totals.set(id, value)
  }
  return { totals }
}

export function sumMappedAmount(rows: DataRow[], column: string | undefined, orderColumn: string | undefined, aggregation: AmountAggregation): { value: number | null; detail: string } {
  if (!column) return { value: null, detail: 'Map a revenue or sales amount column to calculate this metric.' }
  if (aggregation === 'row') return { value: sumField(rows, column), detail: fieldDetail(column, 'revenue', rows) }
  const result = orderAmounts(rows, column, orderColumn)
  if (result.error) return { value: null, detail: result.error }
  const values = [...result.totals.values()]
  return {
    value: values.length ? values.reduce((total, value) => total + value, 0) : null,
    detail: values.length ? `Counted one consistent mapped total for each of ${values.length.toLocaleString()} unique orders in “${column}”.` : `No usable order totals were found in “${column}”.`,
  }
}

export function matchedTotals(rows: DataRow[], left?: string, right?: string, orderColumn?: string, aggregation: AmountAggregation = 'row'): { left: number; right: number; count: number } {
  if (!left || !right) return { left: 0, right: 0, count: 0 }
  if (aggregation === 'order') {
    const leftOrders = orderAmounts(rows, left, orderColumn)
    const rightOrders = orderAmounts(rows, right, orderColumn)
    if (leftOrders.error || rightOrders.error) return { left: 0, right: 0, count: 0 }
    const commonIds = [...leftOrders.totals.keys()].filter((id) => rightOrders.totals.has(id))
    return commonIds.reduce((totals, id) => ({
      left: totals.left + (leftOrders.totals.get(id) ?? 0),
      right: totals.right + (rightOrders.totals.get(id) ?? 0),
      count: totals.count + 1,
    }), { left: 0, right: 0, count: 0 })
  }
  let leftTotal = 0
  let rightTotal = 0
  let count = 0
  for (const row of rows) {
    const leftValue = parseNumber(row[left])
    const rightValue = parseNumber(row[right])
    if (leftValue === null || rightValue === null) continue
    leftTotal += leftValue
    rightTotal += rightValue
    count += 1
  }
  return { left: leftTotal, right: rightTotal, count }
}

export function averageOrderValue(rows: DataRow[], orderColumn?: string, amountColumn?: string, aggregation: AmountAggregation = 'row'): { value: number | null; orders: number; detail?: string } {
  if (!orderColumn || !amountColumn) return { value: null, orders: 0 }
  if (aggregation === 'order') {
    const result = orderAmounts(rows, amountColumn, orderColumn)
    const values = [...result.totals.values()]
    return {
      value: !result.error && values.length ? values.reduce((total, amount) => total + amount, 0) / values.length : null,
      orders: result.error ? 0 : values.length,
      detail: result.error,
    }
  }
  const orders = new Map<string, number>()
  for (const row of rows) {
    const id = String(row[orderColumn] ?? '').trim()
    const amount = parseNumber(row[amountColumn])
    if (!id || amount === null) continue
    orders.set(id, (orders.get(id) ?? 0) + amount)
  }
  const count = orders.size
  return { value: count ? [...orders.values()].reduce((total, amount) => total + amount, 0) / count : null, orders: count }
}

export function formatNumber(value: number, maximumFractionDigits = 2): string {
  return formatExactNumber(value, undefined, maximumFractionDigits)
}

export function metric(label: string, value: number | null, detail: string, formatter = formatNumber): Metric {
  return value === null
    ? { label, value: 'Not available', detail, unavailable: true }
    : { label, value: formatter === formatNumber ? formatExactNumber(value) : formatter(value), rawValue: value, detail }
}

export function uniqueCount(rows: DataRow[], column?: string): number | null {
  if (!column) return null
  const identifiers = new Set(rows.map((row) => String(row[column] ?? '').trim()).filter(Boolean))
  return identifiers.size || null
}

export function fieldDetail(column: string | undefined, fieldName: string, rows: DataRow[]): string {
  if (!column) return `Map the ${fieldName} column to calculate this metric.`
  const validCount = numberValues(rows, column).values.length
  return validCount
    ? `Uses ${validCount.toLocaleString()} valid numeric value${validCount === 1 ? '' : 's'} from “${column}”.`
    : `No usable values were found in the mapped ${fieldName} column.`
}

function isUnitCostColumn(column: string | undefined): boolean {
  return Boolean(column && /\bunit\s*cost\b|\bcost\s*(?:per|\/)\s*unit\b/i.test(column))
}

export function totalCost(rows: DataRow[], mappings: Mappings, aggregation: AmountAggregation = 'row'): { value: number | null; detail: string } {
  const column = mappings.cost
  if (!column) return { value: null, detail: 'Map a cost column to calculate this metric.' }
  if (aggregation === 'order') return { value: null, detail: 'Total cost is unavailable in order-total mode because cost may be recorded per line item or repeated per order; its granularity must be confirmed.' }
  if (!isUnitCostColumn(column)) return { value: sumField(rows, column), detail: fieldDetail(column, 'cost', rows) }
  if (!mappings.quantity) return { value: null, detail: 'The mapped column is a unit cost. Map quantity so total cost can be calculated without treating unit cost as a row total.' }
  let total = 0
  let count = 0
  for (const row of rows) {
    const unitCost = parseNumber(row[column])
    const quantity = parseNumber(row[mappings.quantity])
    if (unitCost === null || quantity === null) continue
    total += unitCost * quantity
    count += 1
  }
  return {
    value: count ? total : null,
    detail: count ? `Unit cost from “${column}” multiplied by quantity from “${mappings.quantity}” for ${count.toLocaleString()} matching rows.` : `No rows contain valid values for both unit cost “${column}” and quantity “${mappings.quantity}”.`,
  }
}

export function profitSummary(rows: DataRow[], mappings: Mappings, aggregation: AmountAggregation = 'row'): { profit: number | null; margin: number | null; profitDetail: string; marginDetail: string } {
  if (aggregation === 'order') {
    return {
      profit: null,
      margin: null,
      profitDetail: 'Profit is not calculated in order-total mode because the mapped cost or profit column may use a different row granularity.',
      marginDetail: 'Profit margin is unavailable until revenue and profit or cost use a confirmed, compatible aggregation level.',
    }
  }
  const amountColumn = mappings.amount
  const costColumn = mappings.cost
  if (!amountColumn || !costColumn || amountColumn === costColumn) {
    const detail = amountColumn && costColumn
      ? 'Revenue and cost must be mapped to distinct, compatible columns.'
      : 'Map both revenue and a compatible cost column to calculate profit.'
    return {
      profit: null,
      margin: null,
      profitDetail: detail,
      marginDetail: 'Profit margin requires compatible revenue and cost values on the same records.',
    }
  }
  if (isUnitCostColumn(costColumn) && !mappings.quantity) {
    return {
      profit: null,
      margin: null,
      profitDetail: 'The mapped cost is a unit cost; quantity is required to calculate total cost and profit.',
      marginDetail: 'Map quantity to multiply unit cost before calculating profit margin.',
    }
  }

  let revenueTotal = 0
  let costTotal = 0
  let count = 0
  for (const row of rows) {
    const revenue = parseNumber(row[amountColumn])
    const cost = parseNumber(row[costColumn])
    const quantity = isUnitCostColumn(costColumn) ? parseNumber(row[mappings.quantity ?? '']) : 1
    if (revenue === null || cost === null || quantity === null) continue
    revenueTotal += revenue
    costTotal += cost * quantity
    count += 1
  }
  if (!count) {
    return {
      profit: null,
      margin: null,
      profitDetail: 'No rows contain valid values for both compatible revenue and cost fields.',
      marginDetail: 'No rows contain valid values for both revenue and cost.',
    }
  }
  const profit = revenueTotal - costTotal
  const margin = revenueTotal !== 0 ? profit / revenueTotal * 100 : null
  const marginDetail = revenueTotal === 0
      ? 'Cannot calculate a percentage because the matched revenue total is zero.'
      : `Calculated as profit divided by revenue for ${count.toLocaleString()} rows with valid revenue and cost values.`
  const profitDetail = isUnitCostColumn(costColumn)
    ? `Revenue less unit cost multiplied by quantity, using “${amountColumn}”, “${costColumn}”, and “${mappings.quantity}” on ${count.toLocaleString()} matching rows.`
    : `Revenue less cost per row, using “${amountColumn}” and “${costColumn}” on ${count.toLocaleString()} matching rows.`
  return { profit, margin, profitDetail, marginDetail }
}

export function percentage(value: number, divisor: number): number | null {
  return divisor === 0 ? null : value / divisor * 100
}

export function numericFieldIds(): FieldId[] {
  return ['amount', 'cost', 'quantity', 'profit', 'discount', 'returns', 'campaignSpend', 'leads', 'conversions', 'deliveryCost', 'productionQuantity', 'waste']
}
