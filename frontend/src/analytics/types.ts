export type CategoryId = 'retail' | 'ecommerce' | 'restaurant' | 'manufacturing' | 'marketing' | 'logistics'

export type FieldId =
  | 'date'
  | 'item'
  | 'amount'
  | 'cost'
  | 'quantity'
  | 'profit'
  | 'category'
  | 'region'
  | 'customer'
  | 'discount'
  | 'orderId'
  | 'returns'
  | 'campaignSpend'
  | 'leads'
  | 'conversions'
  | 'deliveryCost'
  | 'shipmentId'
  | 'deliveryDate'
  | 'expectedDate'
  | 'deliveryStatus'
  | 'productionQuantity'
  | 'waste'

export type CellValue = string | number | boolean | Date | null
export type DataRow = Record<string, CellValue>
export type Mappings = Partial<Record<FieldId, string>>
export type AmountAggregation = 'row' | 'order'
export type DateRange = 'all' | '30' | '90'

export interface Dataset {
  fileName: string
  columns: string[]
  rows: DataRow[]
  emptyRows: number
  duplicateRows: number
  missingValues: number
  warnings: string[]
  inferredTypes?: Record<string, string>
}

export interface BusinessCategory {
  id: CategoryId
  name: string
  shortName: string
  description: string
  accent: string
  fields: FieldId[]
}

export interface FieldDefinition {
  id: FieldId
  label: string
  description: string
  aliases: string[]
}

export interface Metric {
  label: string
  value: string
  rawValue?: number
  detail?: string
  unavailable?: boolean
}

export interface ChartPoint {
  label: string
  value: number
}

export interface AnalyticsResult {
  metrics: Metric[]
  trend: ChartPoint[]
  breakdown: ChartPoint[]
  trendLabel: string
  breakdownLabel: string
  qualityNotes: string[]
  observations: string[]
  rowsInScope: DataRow[]
}
