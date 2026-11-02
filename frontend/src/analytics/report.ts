import { parseDate } from './metrics/shared'
import { formatExactNumber, formatMetricExactValue, inferCurrency } from './formatting'
import type { ApiAnalytics, BusinessInsight, BusinessRecommendation } from './api'
import type { BusinessCategory, Dataset, Mappings, Metric } from './types'

export interface ReportSection {
  title: string
  paragraphs?: string[]
  bullets?: string[]
  table?: { headers: string[]; rows: string[][] }
  chart?: { label: string; value: number }[]
}

export interface BusinessReport {
  title: string
  category: string
  datasetName: string
  generatedAt: string
  period: string
  rowCount: number
  rowsInPeriod: number
  columnCount: number
  metrics: Metric[]
  sections: ReportSection[]
}

function formatMoney(value: number, currency?: string): string {
  return formatExactNumber(value, currency)
}

function findPeriod(rows: Dataset['rows'], dateColumn?: string): { start?: Date; end?: Date } {
  if (!dateColumn) return {}
  let start: Date | undefined
  let end: Date | undefined
  for (const row of rows) {
    const date = parseDate(row[dateColumn])
    if (!date) continue
    if (!start || date.getTime() < start.getTime()) start = date
    if (!end || date.getTime() > end.getTime()) end = date
  }
  return { start, end }
}

function kpiTable(metrics: Metric[], currency?: string): string[][] {
  return metrics.map((metric) => {
    const value = metric.unavailable ? 'Not available' : formatMetricExactValue(metric, currency)
    return [metric.label, value, metric.detail ?? 'Calculated from the uploaded dataset.']
  })
}

function breakdownTable(analytics: ApiAnalytics, currency?: string): string[][] {
  return analytics.breakdown.map((point, index) => [
    String(index + 1),
    point.label,
    formatMoney(point.value, currency),
  ])
}

export function createBusinessReport(
  dataset: Dataset,
  category: BusinessCategory,
  mappings: Mappings,
  analytics: ApiAnalytics & { rowsInScope: Dataset['rows'] },
  businessInsights: BusinessInsight[] = [],
  businessRecommendations: BusinessRecommendation[] = [],
): BusinessReport {
  const currency = inferCurrency(dataset, mappings)
  const period = findPeriod(analytics.rowsInScope, mappings.date)
  const periodLabel = period.start && period.end
    ? `${period.start.toLocaleDateString()} – ${period.end.toLocaleDateString()}`
    : 'Not available — no valid mapped dates'
  const comparison = businessInsights.find((insight) => insight.id === 'period-over-period-change')?.explanation ?? null
  const salesRelevant = category.id === 'retail' || category.id === 'ecommerce' || category.id === 'restaurant' || category.id === 'manufacturing'
  const profitRelevant = ['retail', 'ecommerce', 'restaurant', 'manufacturing'].includes(category.id)
  const profitAvailable = analytics.metrics.some((metric) => metric.label.toLowerCase() === 'profit' && !metric.unavailable)
  const findings = businessInsights.map((insight) => `${insight.title}: ${insight.explanation}`)
  const recommendations = businessRecommendations.map((recommendation) => `${recommendation.action} Evidence: ${recommendation.basis}`)
  const mappedColumns = Object.entries(mappings).filter((entry): entry is [string, string] => Boolean(entry[1]))

  const sections: ReportSection[] = [
    {
      title: '1. Executive Summary',
      paragraphs: [
        `This ${category.name.toLowerCase()} report summarizes ${dataset.rows.length.toLocaleString()} data rows from “${dataset.fileName}”. All figures and observations below are calculated from the uploaded file and selected column mappings. No external data or AI-generated analysis is used.`,
        comparison ?? (mappings.date
          ? 'A growth comparison is unavailable because the mapped dates and values do not support comparable adjacent periods.'
          : 'A growth comparison is unavailable because no date column is mapped.'),
        findings.length ? `Key evidence: ${findings[0]}` : 'No additional trend or segment findings could be calculated from the currently mapped fields.',
      ],
    },
    {
      title: '2. Business Overview & Dataset Summary',
      paragraphs: [
        `Business category: ${category.name}. Dataset: ${dataset.fileName}. Reporting period: ${periodLabel}. Source dimensions: ${dataset.rows.length.toLocaleString()} rows and ${dataset.columns.length.toLocaleString()} columns; ${analytics.rowsInScope.length.toLocaleString()} rows are included in this report's active date range.`,
        `Mapped fields: ${mappedColumns.length ? mappedColumns.map(([field, column]) => `${field} → ${column}`).join('; ') : 'None'}. Rows are retained as uploaded; exact duplicates are not silently removed.`,
      ],
      table: {
        headers: ['Dataset detail', 'Value'],
        rows: [
          ['Business category', category.name],
          ['Dataset file', dataset.fileName],
          ['Reporting period', periodLabel],
          ['Rows / columns', `${dataset.rows.length.toLocaleString()} / ${dataset.columns.length.toLocaleString()}`],
          ['Rows included in report range', analytics.rowsInScope.length.toLocaleString()],
          ['Missing cells', dataset.missingValues.toLocaleString()],
          ['Exact duplicate rows retained', dataset.duplicateRows.toLocaleString()],
        ],
      },
    },
    {
      title: '3. Key Performance Indicators',
      paragraphs: ['KPIs below use the active dataset and available mappings. Unavailable metrics explain the fields or values needed for a calculation.'],
      table: { headers: ['Metric', 'Result', 'Calculation basis / limitation'], rows: kpiTable(analytics.metrics, currency) },
    },
  ]

  if (salesRelevant) {
    const salesMetric = analytics.metrics.find((metric) => /revenue|sales/i.test(metric.label))
    sections.push({
      title: '4. Revenue & Sales Analysis',
      paragraphs: [
        salesMetric && !salesMetric.unavailable
          ? `${salesMetric.label} is ${formatMetricExactValue(salesMetric, currency)} for the reporting period, calculated from the mapped amount field.`
          : 'Sales analysis is limited because a usable revenue or sales amount field is unavailable.',
        comparison ?? 'A month-over-month sales comparison cannot be established from the available date and amount data.',
      ],
      ...(analytics.trend.length ? { chart: analytics.trend } : {}),
      ...(analytics.trend.length ? { table: { headers: ['Month', 'Recorded sales'], rows: analytics.trend.map((point) => [point.label, formatMoney(point.value, currency)]) } } : {}),
    })
  } else if (category.id === 'marketing') {
    sections.push({
      title: '4. Campaign Performance',
      paragraphs: [
        'Campaign performance is summarized from mapped spending, lead, conversion, and attributed revenue fields where available. ROI is shown only when revenue and campaign spend are present on the same rows.',
        comparison ?? 'A month-over-month campaign spending comparison cannot be established from the available date and spend data.',
      ],
      ...(analytics.trend.length ? { chart: analytics.trend } : {}),
      ...(analytics.trend.length ? { table: { headers: ['Month', 'Campaign spending'], rows: analytics.trend.map((point) => [point.label, formatMoney(point.value, currency)]) } } : {}),
    })
  } else {
    sections.push({
      title: '4. Operations & Delivery Analysis',
      paragraphs: [
        'Operational metrics are limited to mapped shipment, delivery, cost, status, and date fields. Missing delivery times or costs are not estimated.',
        comparison ?? 'A month-over-month delivery cost comparison cannot be established from the available date and cost data.',
      ],
      ...(analytics.trend.length ? { chart: analytics.trend } : {}),
      ...(analytics.trend.length ? { table: { headers: ['Month', 'Delivery costs'], rows: analytics.trend.map((point) => [point.label, formatMoney(point.value, currency)]) } } : {}),
    })
  }

  if (profitRelevant && profitAvailable) {
    const profitMetric = analytics.metrics.find((metric) => metric.label.toLowerCase() === 'profit')
    const marginMetric = analytics.metrics.find((metric) => metric.label.toLowerCase().includes('margin'))
    sections.push({
      title: '5. Profit & Loss Analysis',
      paragraphs: [
        profitMetric && !profitMetric.unavailable
          ? `${profitMetric.label} is ${formatMetricExactValue(profitMetric, currency)}. ${profitMetric.detail ?? ''}`
          : 'Profit is not available for this period. Revenue and a compatible cost field must be mapped on the same records.',
        ...(marginMetric ? [marginMetric && !marginMetric.unavailable
          ? `Profit margin is ${marginMetric.value}. ${marginMetric.detail ?? ''}`
          : 'Profit margin cannot be calculated from the currently available mapped values.'] : []),
      ],
      table: { headers: ['Field', 'Result'], rows: [profitMetric, marginMetric].filter((metric): metric is Metric => Boolean(metric)).map((metric) => [metric.label, formatMetricExactValue(metric, currency)]) },
    })
  }

  if (analytics.breakdown.length) {
    sections.push({
      title: `${sections.length + 1}. Product, Category, or Region Analysis`,
      paragraphs: [`${analytics.breakdownLabel} is grouped from the mapped dataset columns. The breakdown is ranked by the values shown and does not imply a cause or forecast.`],
      table: { headers: ['Rank', 'Segment', 'Recorded value'], rows: breakdownTable(analytics, currency) },
    })
  }

  sections.push({
    title: `${sections.length + 1}. Data Quality, Findings & Potential Actions`,
    paragraphs: [
      dataset.missingValues
        ? `${dataset.missingValues.toLocaleString()} blank cells were detected across the uploaded dataset. Blank values are left unchanged and skipped only where a calculation requires a value.`
        : 'No blank cells were detected in the uploaded dataset.',
      dataset.duplicateRows
        ? `${dataset.duplicateRows.toLocaleString()} exact duplicate rows were detected and retained. Confirm whether they represent valid repeated transactions before interpreting totals.`
        : 'No exact duplicate rows were detected.',
      analytics.qualityNotes.length ? `Other calculation notes: ${analytics.qualityNotes.join(' ')}` : 'No additional mapped-field quality warnings were identified.',
    ],
    ...(findings.length ? { bullets: findings } : { bullets: ['No major trend or segment findings could be calculated from the available fields.'] }),
    ...(recommendations.length ? { table: { headers: ['Potential actions based on available evidence'], rows: recommendations.map((recommendation) => [recommendation]) } } : {}),
  })
  sections.push({
    title: 'Conclusion',
    paragraphs: [
      `This report describes the information available in ${dataset.fileName} for ${category.name.toLowerCase()}. Results are limited to the data and mappings listed above.`,
      'Potential actions are prompts for review, not guaranteed outcomes. Validate the underlying transactions and business context before making decisions.',
    ],
  })

  if (businessInsights.length) {
    sections.push({
      title: 'Dataset-grounded Business Insights',
      paragraphs: ['These findings are the same backend-calculated insights shown on the dashboard for the active dataset and mappings.'],
      table: {
        headers: ['Observed finding', 'Value', 'Period', 'Derivation'],
        rows: businessInsights.map((insight) => {
          const value = insight.rawValue === undefined
            ? insight.value
            : insight.valueType === 'amount'
              ? `${insight.id === 'period-over-period-change' && insight.rawValue > 0 ? '+' : ''}${formatExactNumber(insight.rawValue, currency)}${insight.percentage === null ? '' : insight.percentage !== undefined ? ` (${formatExactNumber(Math.abs(insight.percentage))}%)` : ''}`
              : insight.valueType === 'percent'
                ? `${formatExactNumber(insight.rawValue)}%`
                : formatExactNumber(insight.rawValue)
          return [`${insight.title} · ${insight.metric}`, value, insight.period, insight.explanation]
        }),
      },
    })
  }
  if (businessRecommendations.length) {
    sections.push({
      title: 'Potential Actions from Dataset Findings',
      paragraphs: ['Actions below are suggestions for review, not guaranteed outcomes. The evidence basis is included for each action.'],
      table: {
        headers: ['Suggested action', 'Evidence basis'],
        rows: businessRecommendations.map((recommendation) => [recommendation.action, recommendation.basis]),
      },
    })
  }

  return {
    title: `${category.name} Business Report`,
    category: category.name,
    datasetName: dataset.fileName,
    generatedAt: new Date().toLocaleString(),
    period: periodLabel,
    rowCount: dataset.rows.length,
    rowsInPeriod: analytics.rowsInScope.length,
    columnCount: dataset.columns.length,
    metrics: analytics.metrics,
    sections,
  }
}
