import type { AmountAggregation, DataRow, Metric } from '../types'
import type { Mappings } from '../types'
import { fieldDetail, metric, profitSummary, sumField, sumMappedAmount, totalCost } from './shared'

export function calculateManufacturingMetrics(rows: DataRow[], mappings: Mappings, aggregation: AmountAggregation = 'row'): Metric[] {
  const profit = profitSummary(rows, mappings, aggregation)
  const quantityColumn = mappings.productionQuantity ?? mappings.quantity
  const revenue = sumMappedAmount(rows, mappings.amount, mappings.orderId, aggregation)
  const cost = totalCost(rows, mappings, aggregation)
  return [
    metric('Production quantity', sumField(rows, quantityColumn), fieldDetail(quantityColumn, 'production quantity', rows)),
    metric('Production cost', cost.value, cost.detail),
    metric('Revenue', revenue.value, revenue.detail),
    metric('Profit', profit.profit, profit.profitDetail),
    metric('Profit margin', profit.margin, profit.marginDetail, (value) => `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`),
    metric('Recorded waste', sumField(rows, mappings.waste), fieldDetail(mappings.waste, 'waste', rows)),
  ]
}
