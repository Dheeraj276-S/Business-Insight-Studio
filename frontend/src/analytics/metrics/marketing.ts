import type { DataRow, Metric } from '../types'
import type { Mappings } from '../types'
import { fieldDetail, formatNumber, matchedTotals, metric, percentage, sumField } from './shared'

export function calculateMarketingMetrics(rows: DataRow[], mappings: Mappings): Metric[] {
  const spend = sumField(rows, mappings.campaignSpend)
  const leads = sumField(rows, mappings.leads)
  const conversions = sumField(rows, mappings.conversions)
  const spendLeadPair = matchedTotals(rows, mappings.campaignSpend, mappings.leads)
  const conversionLeadPair = matchedTotals(rows, mappings.conversions, mappings.leads)
  const revenueSpendPair = matchedTotals(rows, mappings.amount, mappings.campaignSpend)
  const costPerLead = spendLeadPair.count && spendLeadPair.right !== 0 ? spendLeadPair.left / spendLeadPair.right : null
  const conversionRate = conversionLeadPair.count ? percentage(conversionLeadPair.left, conversionLeadPair.right) : null
  const roi = revenueSpendPair.count && revenueSpendPair.right !== 0
    ? (revenueSpendPair.left - revenueSpendPair.right) / revenueSpendPair.right * 100
    : null
  const costPerLeadDetail = !spendLeadPair.count
    ? 'Requires campaign spend and leads on the same rows, with non-zero leads.'
    : spendLeadPair.right === 0
      ? 'Cannot calculate because the matched lead total is zero.'
      : 'Total campaign spend divided by leads on rows with both values.'
  const conversionRateDetail = !conversionLeadPair.count
    ? 'Requires conversions and leads on the same rows, with non-zero leads.'
    : conversionLeadPair.right === 0
      ? 'Cannot calculate because the matched lead total is zero.'
      : 'Conversions divided by leads on rows with both values.'
  const roiDetail = !revenueSpendPair.count
    ? 'Requires revenue and campaign spend on the same rows, with non-zero spend.'
    : revenueSpendPair.right === 0
      ? 'Cannot calculate because the matched campaign spend is zero.'
      : 'Revenue less campaign spend, divided by spend on rows with both values.'
  return [
    metric('Campaign spending', spend, fieldDetail(mappings.campaignSpend, 'spend', rows)),
    metric('Leads', leads, fieldDetail(mappings.leads, 'lead count', rows)),
    metric('Conversions', conversions, fieldDetail(mappings.conversions, 'conversion count', rows)),
    metric('Attributed revenue', sumField(rows, mappings.amount), fieldDetail(mappings.amount, 'attributed revenue', rows)),
    metric('Cost per lead', costPerLead, costPerLeadDetail),
    metric('Conversion rate', conversionRate, conversionRateDetail, (value) => `${formatNumber(value)}%`),
    metric('Campaign ROI', roi, roiDetail, (value) => `${formatNumber(value)}%`),
  ]
}
