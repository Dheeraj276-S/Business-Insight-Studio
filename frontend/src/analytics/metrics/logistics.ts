import type { DataRow, Metric } from '../types'
import type { Mappings } from '../types'
import { fieldDetail, formatNumber, metric, parseDate, sumField, uniqueCount } from './shared'

function onTimeRate(rows: DataRow[], mappings: Mappings): { rate: number | null; detail: string } {
  let onTime = 0
  let evaluated = 0
  if (mappings.expectedDate && mappings.deliveryDate) {
    for (const row of rows) {
      const expected = parseDate(row[mappings.expectedDate])
      const actual = parseDate(row[mappings.deliveryDate])
      if (!expected || !actual) continue
      evaluated += 1
      if (actual.getTime() <= expected.getTime()) onTime += 1
    }
    return {
      rate: evaluated ? onTime / evaluated * 100 : null,
      detail: evaluated ? `Compared delivered and expected dates for ${evaluated.toLocaleString()} shipments.` : 'No rows had both a valid expected date and delivered date.',
    }
  }
  if (!mappings.deliveryStatus) return { rate: null, detail: 'Map a delivery status, or expected and delivered dates, to calculate this metric.' }
  for (const row of rows) {
    const status = String(row[mappings.deliveryStatus] ?? '').toLowerCase().replace(/[^a-z]/g, '')
    if (!status) continue
    if (status.includes('ontime')) {
      onTime += 1
      evaluated += 1
    } else if (status.includes('late') || status.includes('delay') || status.includes('overdue')) {
      evaluated += 1
    }
  }
  return {
    rate: evaluated ? onTime / evaluated * 100 : null,
    detail: evaluated ? `Based on ${evaluated.toLocaleString()} rows explicitly marked on time or late.` : 'No recognized on-time or late delivery statuses were found.',
  }
}

function averageDeliveryDays(rows: DataRow[], startColumn?: string, endColumn?: string): { value: number | null; detail: string } {
  if (!startColumn || !endColumn) return { value: null, detail: 'Map both shipment and delivered dates to calculate delivery time.' }
  let totalDays = 0
  let count = 0
  for (const row of rows) {
    const start = parseDate(row[startColumn])
    const end = parseDate(row[endColumn])
    if (!start || !end || end.getTime() < start.getTime()) continue
    totalDays += (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)
    count += 1
  }
  return {
    value: count ? totalDays / count : null,
    detail: count ? `Calculated for ${count.toLocaleString()} rows with valid date pairs.` : 'No valid shipment and delivery date pairs were found.',
  }
}

export function calculateLogisticsMetrics(rows: DataRow[], mappings: Mappings): Metric[] {
  const duration = averageDeliveryDays(rows, mappings.date, mappings.deliveryDate)
  const onTime = onTimeRate(rows, mappings)
  return [
    metric('Total shipments', uniqueCount(rows, mappings.shipmentId), mappings.shipmentId ? 'Unique non-empty shipment IDs in this range.' : 'Map a shipment ID; rows are not assumed to be unique shipments.'),
    metric('Average delivery time', duration.value, duration.detail, (value) => `${formatNumber(value)} days`),
    metric('On-time delivery', onTime.rate, onTime.detail, (value) => `${formatNumber(value)}%`),
    metric('Delivery costs', sumField(rows, mappings.deliveryCost), fieldDetail(mappings.deliveryCost, 'delivery cost', rows)),
    metric('Quantity shipped', sumField(rows, mappings.quantity), fieldDetail(mappings.quantity, 'quantity', rows)),
  ]
}
