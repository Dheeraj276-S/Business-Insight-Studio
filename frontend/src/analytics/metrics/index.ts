import type { AmountAggregation, BusinessCategory, DataRow, Metric } from '../types'
import type { Mappings } from '../types'
import { calculateLogisticsMetrics } from './logistics'
import { calculateManufacturingMetrics } from './manufacturing'
import { calculateMarketingMetrics } from './marketing'
import { calculateRestaurantMetrics } from './restaurant'
import { calculateRetailMetrics } from './retail'

export function calculateCategoryMetrics(category: BusinessCategory, rows: DataRow[], mappings: Mappings, aggregation: AmountAggregation = 'row'): Metric[] {
  switch (category.id) {
    case 'retail':
    case 'ecommerce':
      return calculateRetailMetrics(rows, mappings, aggregation)
    case 'restaurant':
      return calculateRestaurantMetrics(rows, mappings, aggregation)
    case 'manufacturing':
      return calculateManufacturingMetrics(rows, mappings, aggregation)
    case 'marketing':
      return calculateMarketingMetrics(rows, mappings)
    case 'logistics':
      return calculateLogisticsMetrics(rows, mappings)
  }
}
