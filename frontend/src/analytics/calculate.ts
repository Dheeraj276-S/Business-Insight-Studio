import { calculateCategoryMetrics } from './metrics'
import { formatNumber, numberValues, numericFieldIds, orderAmounts, parseDate, parseNumber } from './metrics/shared'
import type { AmountAggregation, AnalyticsResult, BusinessCategory, ChartPoint, DataRow, Dataset, DateRange, Mappings } from './types'

export type { Mappings } from './types'
export type { DateRange } from './types'

function filterRowsByDate(rows: DataRow[], dateColumn: string | undefined, range: DateRange): { rows: DataRow[]; latest: Date | null; invalidDates: number } {
  if (!dateColumn) return { rows, latest: null, invalidDates: 0 }
  const parsed = rows.map((row) => parseDate(row[dateColumn]))
  const validDates = parsed.filter((date): date is Date => date !== null)
  const latestTime = validDates.reduce((latest, date) => Math.max(latest, date.getTime()), 0)
  const latest = validDates.length ? new Date(latestTime) : null
  const invalidDates = parsed.filter((date) => date === null).length
  if (range === 'all') return { rows, latest, invalidDates }
  if (!latest) return { rows: [], latest, invalidDates }
  const days = Number(range)
  const latestDay = Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), latest.getUTCDate())
  const start = latestDay - (days - 1) * 24 * 60 * 60 * 1000
  const end = latestDay + 24 * 60 * 60 * 1000 - 1
  return {
    rows: rows.filter((_, index) => parsed[index] !== null && parsed[index]!.getTime() >= start && parsed[index]!.getTime() <= end),
    latest,
    invalidDates,
  }
}

export function rowsInDateRange(dataset: Dataset, mappings: Mappings, range: DateRange): DataRow[] {
  return filterRowsByDate(dataset.rows, mappings.date, range).rows
}

function buildTrend(rows: DataRow[], dateColumn: string | undefined, measureColumn: string | undefined, orderColumn: string | undefined, aggregation: AmountAggregation): { points: ChartPoint[]; warning?: string } {
  if (!dateColumn || !measureColumn) return { points: [] }
  const totals = new Map<string, number>()
  if (aggregation === 'order' && measureColumn) {
    const orders = orderAmounts(rows, measureColumn, orderColumn)
    if (orders.error) return { points: [], warning: orders.error }
    const orderMonths = new Map<string, Set<string>>()
    for (const row of rows) {
      const id = String(row[orderColumn ?? ''] ?? '').trim()
      if (!id || !orders.totals.has(id)) continue
      const date = parseDate(row[dateColumn])
      if (!date) continue
      const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
      const months = orderMonths.get(id) ?? new Set<string>()
      months.add(month)
      orderMonths.set(id, months)
    }
    if ([...orderMonths.values()].some((months) => months.size > 1)) {
      return { points: [], warning: 'Monthly trend is unavailable in order-total mode because some order IDs span multiple mapped dates or months.' }
    }
    for (const [id, value] of orders.totals) {
      const month = orderMonths.get(id)?.values().next().value
      if (month) totals.set(month, (totals.get(month) ?? 0) + value)
    }
    return { points: Array.from(totals, ([key, value]) => {
      const [year, month] = key.split('-')
      return { key, point: { label: new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), value } }
    }).sort((left, right) => left.key.localeCompare(right.key)).map(({ point }) => point).slice(-12) }
  }
  for (const row of rows) {
    const date = parseDate(row[dateColumn])
    const measure = parseNumber(row[measureColumn])
    if (!date || measure === null) continue
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
    totals.set(key, (totals.get(key) ?? 0) + measure)
  }
  return { points: Array.from(totals, ([key, value]) => {
    const [year, month] = key.split('-')
    return { key, point: { label: new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), value } }
  }).sort((left, right) => left.key.localeCompare(right.key)).map(({ point }) => point).slice(-12) }
}

export function aggregateByDimension(rows: DataRow[], labelColumn: string | undefined, measureColumn: string | undefined, orderColumn: string | undefined, aggregation: AmountAggregation = 'row'): { points: ChartPoint[]; warning?: string } {
  if (!labelColumn || !measureColumn) return { points: [] }
  const totals = new Map<string, number>()
  if (aggregation === 'order') {
    const orders = orderAmounts(rows, measureColumn, orderColumn)
    if (orders.error) return { points: [], warning: orders.error }
    const orderLabels = new Map<string, Set<string>>()
    for (const row of rows) {
      const id = String(row[orderColumn ?? ''] ?? '').trim()
      const label = String(row[labelColumn] ?? '').trim()
      if (!id || !label || !orders.totals.has(id)) continue
      const labels = orderLabels.get(id) ?? new Set<string>()
      labels.add(label)
      orderLabels.set(id, labels)
    }
    if ([...orderLabels.values()].some((labels) => labels.size > 1)) {
      return { points: [], warning: `The ${labelColumn} breakdown is unavailable in order-total mode because some orders contain multiple ${labelColumn} values. Order totals cannot be allocated across those values without guessing.` }
    }
    for (const [id, value] of orders.totals) {
      const label = orderLabels.get(id)?.values().next().value
      if (label) totals.set(label, (totals.get(label) ?? 0) + value)
    }
    return { points: Array.from(totals, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8) }
  }
  for (const row of rows) {
    const label = String(row[labelColumn] ?? '').trim()
    const value = parseNumber(row[measureColumn])
    if (!label || value === null) continue
    totals.set(label, (totals.get(label) ?? 0) + value)
  }
  return { points: Array.from(totals, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8) }
}

function qualityNotes(dataset: Dataset, mappings: Mappings, rows: DataRow[], invalidDateCount: number, aggregation: AmountAggregation): string[] {
  const notes = [...dataset.warnings]
  if (dataset.missingValues) notes.push(`${dataset.missingValues.toLocaleString()} cells are blank. Missing values are left unchanged and skipped only by calculations that need them.`)
  if (invalidDateCount) notes.push(`${invalidDateCount.toLocaleString()} row${invalidDateCount === 1 ? '' : 's'} ${invalidDateCount === 1 ? 'has' : 'have'} a missing or ambiguous date in the mapped date column; dates are not guessed.`)
  for (const field of numericFieldIds()) {
    const column = mappings[field]
    if (!column) continue
    const invalid = numberValues(rows, column).invalid
    if (invalid) notes.push(`${invalid.toLocaleString()} non-empty value${invalid === 1 ? '' : 's'} in “${column}” could not be read as numbers and are excluded from calculations using that column.`)
  }
  if (aggregation === 'row' && mappings.orderId && mappings.amount) {
    const orderCounts = new Map<string, number>()
    for (const row of rows) {
      const id = String(row[mappings.orderId] ?? '').trim()
      if (id) orderCounts.set(id, (orderCounts.get(id) ?? 0) + 1)
    }
    const repeatedOrders = [...orderCounts.values()].filter((count) => count > 1).length
    if (repeatedOrders) notes.push(`${repeatedOrders.toLocaleString()} order IDs appear on multiple rows. Revenue is summed per row; confirm the mapped amounts are line-item values, not order totals repeated on each line. Select order-total aggregation if the same order total is repeated.`)
  }
  if (aggregation === 'order') notes.push('Revenue is counted once per unique order ID. Profit margin is withheld because the cost or profit column may use a different row granularity.')
  return [...new Set(notes)]
}

export function calculateAnalytics(
  dataset: Dataset,
  category: BusinessCategory,
  mappings: Mappings,
  range: DateRange,
  aggregation: AmountAggregation = 'row',
): AnalyticsResult {
  const dateColumn = mappings.date
  const filtered = filterRowsByDate(dataset.rows, dateColumn, range)
  const rows = filtered.rows
  const metrics = calculateCategoryMetrics(category, rows, mappings, aggregation)
  const trendMeasure = category.id === 'marketing'
    ? mappings.campaignSpend
    : category.id === 'logistics'
      ? mappings.deliveryCost
      : mappings.amount
  const breakdownMeasure = category.id === 'marketing'
    ? mappings.campaignSpend
    : category.id === 'logistics'
      ? mappings.deliveryCost
      : mappings.amount ?? mappings.quantity
  const breakdownColumn = category.id === 'logistics'
    ? mappings.region
    : mappings.item ?? mappings.category ?? mappings.region
  const trendResult = buildTrend(rows, dateColumn, trendMeasure, mappings.orderId, aggregation === 'order' && trendMeasure === mappings.amount ? aggregation : 'row')
  const breakdownResult = aggregateByDimension(rows, breakdownColumn, breakdownMeasure, mappings.orderId, aggregation === 'order' && breakdownMeasure === mappings.amount ? aggregation : 'row')
  const trend = trendResult.points
  const breakdown = breakdownResult.points
  const observations: string[] = []

  if (breakdown.length && breakdownColumn && breakdownMeasure) {
    const [top] = breakdown
    const measureLabel = breakdownMeasure === mappings.quantity ? 'recorded quantity' : 'recorded amount'
    const dimensionLabel = breakdownColumn === mappings.item ? 'items' : breakdownColumn === mappings.category ? 'categories' : 'regions'
    observations.push(`“${top.label}” has the highest ${measureLabel} among the displayed ${dimensionLabel}.`)
  }
  if (trend.length > 1) {
    const first = trend[0]
    const last = trend[trend.length - 1]
    const delta = last.value - first.value
    observations.push(`Recorded ${trendMeasure} ${delta >= 0 ? 'increased' : 'decreased'} by ${formatNumber(Math.abs(delta))} between ${first.label} and ${last.label}.`)
  }

  const scopeNote = dateColumn && range !== 'all'
    ? `Date range uses the latest valid date in this file (${filtered.latest?.toLocaleDateString() ?? 'no valid dates'}), not today's date.`
    : ''
  const dateRangeQuality = dateColumn && range !== 'all' && filtered.invalidDates
    ? `${filtered.invalidDates.toLocaleString()} row${filtered.invalidDates === 1 ? '' : 's'} ${filtered.invalidDates === 1 ? 'with a missing or ambiguous date is' : 'with missing or ambiguous dates are'} excluded from this date-filtered view.`
    : ''
  const missingRequired = category.id === 'marketing'
    ? !mappings.campaignSpend ? 'Campaign spending is not mapped; campaign cost metrics cannot be calculated.' : ''
    : category.id === 'logistics'
      ? !mappings.shipmentId ? 'Shipment ID is not mapped; shipment count cannot be calculated.' : ''
      : !mappings.amount ? 'Revenue / sales amount is not mapped; revenue-based metrics cannot be calculated.' : ''
  return {
    metrics,
    trend,
    breakdown,
    trendLabel: trendMeasure ? `${category.id === 'marketing' ? 'Campaign spending' : category.id === 'logistics' ? 'Delivery costs' : 'Sales'} by month` : 'Trend unavailable',
    breakdownLabel: breakdownColumn
      ? category.id === 'logistics'
        ? 'Delivery cost by region'
        : `Performance by ${breakdownColumn === mappings.item ? 'item' : breakdownColumn === mappings.category ? 'category' : 'region'}`
      : 'Breakdown unavailable',
    qualityNotes: [...qualityNotes(dataset, mappings, rows, dateColumn ? filtered.invalidDates : 0, aggregation), trendResult.warning, breakdownResult.warning, scopeNote, dateRangeQuality, missingRequired].filter((note): note is string => Boolean(note)),
    observations,
    rowsInScope: rows,
  }
}

export function displayCell(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toLocaleDateString()
  if (value === null || value === undefined) return ''
  return String(value)
}
