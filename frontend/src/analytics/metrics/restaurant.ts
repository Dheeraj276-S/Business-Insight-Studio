import type { AmountAggregation, DataRow, Metric } from '../types'
import type { Mappings } from '../types'
import { averageOrderValue, fieldDetail, metric, profitSummary, sumField, sumMappedAmount, totalCost } from './shared'

export function calculateRestaurantMetrics(rows: DataRow[], mappings: Mappings, aggregation: AmountAggregation = 'row'): Metric[] {
  const profit = profitSummary(rows, mappings, aggregation)
  const averageOrder = averageOrderValue(rows, mappings.orderId, mappings.amount, aggregation)
  const sales = sumMappedAmount(rows, mappings.amount, mappings.orderId, aggregation)
  const cost = totalCost(rows, mappings, aggregation)
  return [
    metric('Total sales', sales.value, sales.detail),
    metric('Items sold', sumField(rows, mappings.quantity), fieldDetail(mappings.quantity, 'quantity', rows)),
    metric('Average order value', averageOrder.value, averageOrder.detail ?? (averageOrder.orders ? `Average of ${averageOrder.orders.toLocaleString()} order totals, using rows with both an order ID and sales amount.` : 'Requires valid sales amounts and order IDs on the same rows.')),
    metric('Food / product cost', cost.value, cost.detail),
    metric('Profit', profit.profit, profit.profitDetail),
    metric('Profit margin', profit.margin, profit.marginDetail, (value) => `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`),
  ]
}
