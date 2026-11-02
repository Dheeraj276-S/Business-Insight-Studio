import type { BusinessCategory, FieldDefinition, FieldId } from './types'

export const categories: BusinessCategory[] = [
  {
    id: 'retail',
    name: 'Retail & Supermarkets',
    shortName: 'Retail',
    description: 'Track store sales, product performance, and returns.',
    accent: 'violet',
    fields: ['date', 'item', 'amount', 'cost', 'quantity', 'profit', 'category', 'region', 'customer', 'discount', 'orderId', 'returns'],
  },
  {
    id: 'ecommerce',
    name: 'E-commerce',
    shortName: 'E-commerce',
    description: 'Understand orders, revenue, products, and discounts.',
    accent: 'blue',
    fields: ['date', 'item', 'amount', 'cost', 'quantity', 'profit', 'category', 'region', 'customer', 'discount', 'orderId', 'returns'],
  },
  {
    id: 'restaurant',
    name: 'Restaurants & Cafes',
    shortName: 'Restaurants',
    description: 'See menu item sales, order values, and food costs.',
    accent: 'orange',
    fields: ['date', 'item', 'amount', 'cost', 'quantity', 'profit', 'category', 'region', 'customer', 'orderId', 'discount'],
  },
  {
    id: 'manufacturing',
    name: 'Manufacturing & Wholesale',
    shortName: 'Manufacturing',
    description: 'Review production, product revenue, and recorded waste.',
    accent: 'green',
    fields: ['date', 'item', 'amount', 'cost', 'quantity', 'profit', 'category', 'region', 'productionQuantity', 'waste'],
  },
  {
    id: 'marketing',
    name: 'Digital Marketing',
    shortName: 'Marketing',
    description: 'Measure campaign spending, leads, and conversions.',
    accent: 'pink',
    fields: ['date', 'item', 'campaignSpend', 'leads', 'conversions', 'amount', 'region'],
  },
  {
    id: 'logistics',
    name: 'Logistics & Delivery',
    shortName: 'Logistics',
    description: 'Analyze shipments, delivery times, costs, and regions.',
    accent: 'teal',
    fields: ['date', 'shipmentId', 'deliveryDate', 'expectedDate', 'deliveryStatus', 'deliveryCost', 'region', 'quantity'],
  },
]

export const fieldDefinitions: Record<FieldId, FieldDefinition> = {
  date: { id: 'date', label: 'Date', description: 'Transaction or campaign date', aliases: ['date', 'order date', 'sale date', 'transaction date', 'created at', 'timestamp', 'campaign date', 'ship date', 'shipped at'] },
  item: { id: 'item', label: 'Product or service', description: 'Product, menu item, service, or campaign name', aliases: ['product', 'product name', 'item', 'item name', 'sku name', 'service', 'menu item', 'dish', 'campaign', 'campaign name', 'ad group', 'shipment', 'tracking number'] },
  amount: { id: 'amount', label: 'Revenue / sales amount', description: 'Revenue or sales value per row', aliases: ['revenue', 'sales', 'sales amount', 'net sales', 'amount', 'total', 'total sales', 'total revenue', 'order total', 'gross sales', 'conversion revenue'] },
  cost: { id: 'cost', label: 'Cost', description: 'Cost amount; unit costs require a mapped quantity', aliases: ['cost', 'total cost', 'product cost', 'unit cost', 'food cost', 'production cost', 'cost of goods', 'cogs'] },
  quantity: { id: 'quantity', label: 'Quantity', description: 'Units sold or recorded per row', aliases: ['quantity', 'qty', 'unit count', 'units', 'units sold', 'items sold', 'volume', 'count'] },
  profit: { id: 'profit', label: 'Profit', description: 'Existing profit value for reference; calculated profit requires revenue and cost mappings', aliases: ['profit', 'net profit', 'gross profit', 'profit amount', 'margin amount'] },
  category: { id: 'category', label: 'Category', description: 'Product or service category', aliases: ['category', 'product category', 'department', 'type', 'product type', 'menu category'] },
  region: { id: 'region', label: 'Region or location', description: 'Store, territory, or delivery region', aliases: ['region', 'location', 'store', 'store name', 'city', 'state', 'country', 'territory', 'warehouse', 'delivery region'] },
  customer: { id: 'customer', label: 'Customer', description: 'Customer name or identifier', aliases: ['customer', 'customer id', 'customer name', 'client', 'buyer', 'user id'] },
  discount: { id: 'discount', label: 'Discount', description: 'Discount amount recorded per row', aliases: ['discount', 'discount amount', 'discount value', 'promo discount', 'coupon discount'] },
  orderId: { id: 'orderId', label: 'Order ID', description: 'Unique order or transaction identifier', aliases: ['order id', 'order ref', 'order number', 'transaction id', 'invoice id', 'receipt id', 'order', 'transaction'] },
  returns: { id: 'returns', label: 'Returns', description: 'Return count or return amount recorded per row', aliases: ['returns', 'return count', 'returned', 'returned units', 'refund', 'refunds', 'refund amount'] },
  campaignSpend: { id: 'campaignSpend', label: 'Campaign spending', description: 'Ad or campaign spend per row', aliases: ['spend', 'ad spend', 'campaign spend', 'campaign cost', 'cost', 'budget spent', 'amount spent', 'advertising cost', 'media cost'] },
  leads: { id: 'leads', label: 'Leads', description: 'Leads attributed to a campaign', aliases: ['leads', 'lead count', 'lead', 'inquiries', 'enquiries', 'prospects'] },
  conversions: { id: 'conversions', label: 'Conversions', description: 'Conversions attributed to a campaign', aliases: ['conversions', 'conversion', 'purchases', 'signups', 'sign-ups', 'orders converted'] },
  deliveryCost: { id: 'deliveryCost', label: 'Delivery cost', description: 'Shipping or delivery cost per row', aliases: ['delivery cost', 'shipping cost', 'freight', 'shipping fee', 'transport cost', 'delivery fee'] },
  shipmentId: { id: 'shipmentId', label: 'Shipment ID', description: 'Unique shipment or tracking identifier', aliases: ['shipment id', 'tracking id', 'tracking number', 'consignment number', 'shipment', 'waybill', 'order id'] },
  deliveryDate: { id: 'deliveryDate', label: 'Delivered date', description: 'Date the shipment was delivered', aliases: ['delivery date', 'delivered date', 'delivered at', 'actual delivery date', 'arrival date'] },
  expectedDate: { id: 'expectedDate', label: 'Expected delivery date', description: 'Promised or expected delivery date', aliases: ['expected date', 'estimated delivery', 'expected delivery', 'due date', 'promised date', 'delivery due'] },
  deliveryStatus: { id: 'deliveryStatus', label: 'Delivery status', description: 'Status such as on time, delayed, or late', aliases: ['delivery status', 'status', 'shipment status', 'on time', 'delivery result'] },
  productionQuantity: { id: 'productionQuantity', label: 'Production quantity', description: 'Units produced per row', aliases: ['production quantity', 'quantity', 'qty', 'unit count', 'produced', 'units produced', 'production volume', 'output quantity'] },
  waste: { id: 'waste', label: 'Waste', description: 'Waste quantity explicitly recorded in the file', aliases: ['waste', 'waste quantity', 'scrap', 'scrap quantity', 'spoilage', 'defects', 'defective quantity'] },
}

export function getCategory(id: string | null): BusinessCategory | undefined {
  return categories.find((category) => category.id === id)
}

export function getFieldsForCategory(category: BusinessCategory): FieldDefinition[] {
  return category.fields.map((id) => fieldDefinitions[id])
}

export function detectMappings(columns: string[], fields: FieldDefinition[]): Partial<Record<FieldId, string>> {
  const mappings: Partial<Record<FieldId, string>> = {}
  const used = new Set<string>()
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '')
  for (const field of fields) {
    const aliases = [field.label, ...field.aliases].map(normalize)
    const match = columns.find((column) => !used.has(column) && aliases.includes(normalize(column)))
    if (match) {
      mappings[field.id] = match
      used.add(match)
    }
  }
  return mappings
}

export function requiredFieldsFor(category: BusinessCategory): FieldId[] {
  if (category.id === 'marketing') return ['campaignSpend']
  if (category.id === 'logistics') return ['shipmentId']
  return ['amount']
}
