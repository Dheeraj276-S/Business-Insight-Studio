export interface FormatMetric {
  label: string
  value: string
  rawValue?: number
  unavailable?: boolean
  detail?: string
}

export interface MonetaryMappings {
  amount?: string
  campaignSpend?: string
  deliveryCost?: string
  cost?: string
}

export interface CurrencyDataset {
  rows: Record<string, unknown>[]
}

const CURRENCY_SYMBOLS = /[$€£¥₹]/
const MONETARY_METRIC = /revenue|sales|profit|cost|spend|discount|order value|per lead/i

function currencyPrefix(currency?: string): string {
  return currency ?? ''
}

export function formatExactNumber(value: number, currency?: string, maximumFractionDigits = 2): string {
  const sign = value < 0 ? '-' : ''
  return `${sign}${currencyPrefix(currency)}${new Intl.NumberFormat('en-IN', { maximumFractionDigits }).format(Math.abs(value))}`
}

export function formatCompactNumber(value: number, currency?: string): string {
  const absolute = Math.abs(value)
  let divisor = 1
  let suffix = ''
  if (absolute >= 10_000_000) {
    divisor = 10_000_000
    suffix = ' Cr'
  } else if (absolute >= 100_000) {
    divisor = 100_000
    suffix = ' L'
  } else if (absolute >= 1_000) {
    divisor = 1_000
    suffix = ' K'
  }
  if ((suffix === ' K' || suffix === ' L') && Number((absolute / divisor).toFixed(2)) >= 100) {
    divisor *= 100
    suffix = suffix === ' K' ? ' L' : ' Cr'
  }
  const amount = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: suffix === ' Cr' ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(absolute / divisor)
  return `${value < 0 ? '-' : ''}${currencyPrefix(currency)}${amount}${suffix}`
}

export function formatNumberWithExactValue(value: number, currency?: string): { display: string; exact: string } {
  return {
    display: formatCompactNumber(value, currency),
    exact: formatExactNumber(value, currency),
  }
}

export function inferCurrency(dataset: CurrencyDataset, mappings: MonetaryMappings): string | undefined {
  const columns = [mappings.amount, mappings.campaignSpend, mappings.deliveryCost, mappings.cost].filter((column): column is string => Boolean(column))
  for (const column of columns) {
    for (const row of dataset.rows) {
      const match = String(row[column] ?? '').match(CURRENCY_SYMBOLS)
      if (match) return match[0]
    }
  }
  return undefined
}

export function isMonetaryMetric(label: string): boolean {
  return MONETARY_METRIC.test(label)
}

function numericValue(metric: FormatMetric): number | null {
  if (metric.rawValue !== undefined && Number.isFinite(metric.rawValue)) return metric.rawValue
  const value = metric.value.replace(/,/g, '').replace(/%$/, '').trim()
  if (!value || value === 'Not available') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function formatMetricExactValue(metric: FormatMetric, currency?: string): string {
  if (metric.unavailable || metric.value === 'Not available') return 'Not available'
  const value = numericValue(metric)
  if (value === null) return metric.value
  const amount = isMonetaryMetric(metric.label) ? formatExactNumber(value, currency) : formatExactNumber(value)
  return /%$/.test(metric.value) || /margin|rate|roi/i.test(metric.label) ? `${formatExactNumber(value)}%` : amount
}

export function formatMetricCompactValue(metric: FormatMetric, currency?: string): string {
  if (metric.unavailable || metric.value === 'Not available') return 'Not available'
  const value = numericValue(metric)
  if (value === null) return metric.value
  if (/%$/.test(metric.value) || /margin|rate|roi/i.test(metric.label)) {
    return `${formatExactNumber(value)}%`
  }
  return isMonetaryMetric(metric.label) ? formatCompactNumber(value, currency) : formatExactNumber(value)
}

export function formatMetricTooltip(metric: FormatMetric, currency?: string): string {
  const exactValue = formatMetricExactValue(metric, currency)
  return [exactValue !== 'Not available' ? `Exact value: ${exactValue}` : '', metric.detail].filter(Boolean).join('\n')
}
