import type { AmountAggregation, AnalyticsResult, CategoryId, DateRange, Mappings } from './types'

interface ApiErrorBody {
  detail?: string | { msg?: string }[]
}

export interface DatasetPreview {
  fileName: string
  columns: { name: string; inferredType: string }[]
  sampleRows: Record<string, unknown>[]
  rowCount: number
  columnCount: number
  missingValues: number
  emptyRows: number
  duplicateRows: number
  warnings: string[]
}

export interface BusinessInsight {
  id: string
  title: string
  metric: string
  value: string
  rawValue?: number
  valueType: 'amount' | 'percent' | 'count' | 'text'
  period: string
  explanation: string
  percentage?: number | null
}

export interface BusinessRecommendation {
  id: string
  title: string
  action: string
  basis: string
}

export interface BusinessAssistantReply {
  question: string
  answer: string
  kind: 'answer' | 'notice'
}

export interface ApiAnalytics extends Omit<AnalyticsResult, 'rowsInScope'> {
  fileName: string
  rowCount: number
  columnCount: number
  rowsInScopeCount: number
  dateRange: DateRange
  aggregation: AmountAggregation
  reportingPeriod: { start: string; end: string } | null
  growth: {
    previousPeriod: string
    latestPeriod: string
    difference: number
    percentage: number | null
    direction: 'increased' | 'decreased' | 'unchanged'
  } | null
  dataQuality: DatasetPreview
  insights: BusinessInsight[]
  recommendations: BusinessRecommendation[]
}

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || 'http://127.0.0.1:8000'
const baseUrl = configuredBaseUrl.replace(/\/+$/, '')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, init)
  } catch {
    throw new Error(`Could not connect to the Business Insight Studio API at ${baseUrl}. Start the backend and check VITE_API_BASE_URL.`)
  }
  if (!response.ok) {
    let message = `The API request failed (${response.status} ${response.statusText}).`
    try {
      const body = await response.json() as ApiErrorBody
      if (typeof body.detail === 'string') message = body.detail
      else if (Array.isArray(body.detail)) message = body.detail.map((item) => item.msg).filter(Boolean).join('; ') || message
    } catch {
      // Keep the HTTP status message when the server does not return JSON.
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export function getApiHealth(signal?: AbortSignal): Promise<{ status: string; service: string }> {
  return request('/api/health', { signal })
}

export function getApiCategories(signal?: AbortSignal): Promise<{ categories: { id: string; name: string; fields: { id: string; label: string }[] }[] }> {
  return request('/api/categories', { signal })
}

export async function previewUpload(file: File, signal?: AbortSignal): Promise<DatasetPreview> {
  const form = new FormData()
  form.append('file', file, file.name)
  return request('/api/preview', { method: 'POST', body: form, signal })
}

export async function analyzeUpload(
  file: File,
  category: CategoryId,
  mappings: Mappings,
  range: DateRange,
  aggregation: AmountAggregation,
  signal?: AbortSignal,
): Promise<ApiAnalytics> {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('category', category)
  form.append('mappings', JSON.stringify(mappings))
  form.append('range', range)
  form.append('aggregation', aggregation)
  return request('/api/analyze', { method: 'POST', body: form, signal })
}

export async function askBusinessAssistant(
  file: File,
  category: CategoryId,
  mappings: Mappings,
  range: DateRange,
  aggregation: AmountAggregation,
  question: string,
  signal?: AbortSignal,
): Promise<BusinessAssistantReply> {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('category', category)
  form.append('mappings', JSON.stringify(mappings))
  form.append('range', range)
  form.append('aggregation', aggregation)
  form.append('question', question)
  return request('/api/assistant', { method: 'POST', body: form, signal })
}

export interface BusinessReportPdf {
  blob: Blob
  filename: string
}

export async function fetchBusinessReportPdf(
  file: File,
  category: CategoryId,
  mappings: Mappings,
  range: DateRange,
  aggregation: AmountAggregation,
  signal?: AbortSignal,
): Promise<BusinessReportPdf> {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('category', category)
  form.append('mappings', JSON.stringify(mappings))
  form.append('range', range)
  form.append('aggregation', aggregation)

  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/report`, { method: 'POST', body: form, signal })
  } catch {
    throw new Error(`Could not connect to the Business Insight Studio API at ${baseUrl}. Start the backend and check VITE_API_BASE_URL.`)
  }
  if (!response.ok) {
    let message = `The report request failed (${response.status} ${response.statusText}).`
    try {
      const body = await response.json() as ApiErrorBody
      if (typeof body.detail === 'string') message = body.detail
      else if (Array.isArray(body.detail)) message = body.detail.map((item) => item.msg).filter(Boolean).join('; ') || message
    } catch {
      // Keep the HTTP status message when the server does not return JSON.
    }
    throw new Error(message)
  }
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/pdf')) {
    throw new Error('The report API did not return a PDF file.')
  }

  const blob = await response.blob()
  const filename = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/i)?.[1]
  return { blob, filename: filename || 'business-performance-report.pdf' }
}

export function saveBusinessReportPdf({ blob, filename }: BusinessReportPdf): void {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}
