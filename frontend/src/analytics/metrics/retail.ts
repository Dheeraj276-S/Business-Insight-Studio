import type { AmountAggregation, DataRow, Metric } from '../types'
import type { Mappings } from '../types'
import { fieldDetail, metric, profitSummary, sumField, sumMappedAmount, totalCost, uniqueCount } from './shared'

export function calculateRetailMetrics(rows: DataRow[], mappings: Mappings, aggregation: AmountAggregation = 'row'): Metric[] {
  const profit = profitSummary(rows, mappings, aggregation)
  const revenue = sumMappedAmount(rows, mappings.amount, mappings.orderId, aggregation)
  const cost = totalCost(rows, mappings, aggregation)
  return [
    metric('Total revenue', revenue.value, revenue.detail),
    metric('Total orders', uniqueCount(rows, mappings.orderId), mappings.orderId ? 'Unique non-empty order IDs in this range.' : 'Map an order ID column; rows are not assumed to be unique orders.'),
    metric('Total cost', cost.value, cost.detail),
    metric('Profit', profit.profit, profit.profitDetail),
    metric('Profit margin', profit.margin, profit.marginDetail, (value) => `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`),
    metric('Returns', sumField(rows, mappings.returns), fieldDetail(mappings.returns, 'returns', rows)),
    metric('Discounts', sumField(rows, mappings.discount), fieldDetail(mappings.discount, 'discount', rows)),
  ]
}
