import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react'
import {
  ArrowDown,
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  CloudUpload,
  Database,
  Download,
  FileText,
  FileSpreadsheet,
  Factory,
  LayoutDashboard,
  Megaphone,
  Menu,
  MapPin,
  MessageCircle,
  Search,
  Send,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Store,
  Truck,
  TriangleAlert,
  Utensils,
  type LucideIcon,
} from 'lucide-react'
import { displayCell, rowsInDateRange, type DateRange, type Mappings } from './analytics/calculate'
import { categories, detectMappings, fieldDefinitions, getCategory, getFieldsForCategory, requiredFieldsFor } from './analytics/categories'
import { analyzeUpload, askBusinessAssistant, fetchBusinessReportPdf, getApiHealth, previewUpload, saveBusinessReportPdf, type ApiAnalytics, type DatasetPreview } from './analytics/api'
import { createBusinessReport, type ReportSection } from './analytics/report'
import { parseDate, parseNumber } from './analytics/metrics/shared'
import { formatCompactNumber, formatExactNumber, formatMetricCompactValue, formatMetricTooltip, inferCurrency } from './analytics/formatting'
import { parseUploadedFile } from './analytics/parseFile'
import type { AmountAggregation, BusinessCategory, CategoryId, Dataset, DataRow, FieldId, Metric } from './analytics/types'

type Stage = 'category' | 'upload' | 'preview' | 'mapping' | 'dashboard'
type SortDirection = 'asc' | 'desc'

const categoryIcons: Record<CategoryId, LucideIcon> = {
  retail: Store,
  ecommerce: ShoppingBag,
  restaurant: Utensils,
  manufacturing: Factory,
  marketing: Megaphone,
  logistics: Truck,
}

const stepItems: { stage: Stage; label: string; icon: LucideIcon }[] = [
  { stage: 'category', label: 'Business category', icon: LayoutDashboard },
  { stage: 'upload', label: 'Upload data', icon: CloudUpload },
  { stage: 'preview', label: 'Data preview', icon: Database },
  { stage: 'mapping', label: 'Map columns', icon: SlidersHorizontal },
  { stage: 'dashboard', label: 'Analytics', icon: BarChart3 },
]

function stepIndex(stage: Stage): number {
  return stepItems.findIndex((step) => step.stage === stage)
}

function CategoryMark({ category, size = 20 }: { category: BusinessCategory; size?: number }) {
  const Icon = categoryIcons[category.id]
  return <span className={`bis-category-icon ${category.accent}`}><Icon size={size} strokeWidth={1.8} /></span>
}

function AppHeader({ stage, category, dataset, onMenuClick }: { stage: Stage; category?: BusinessCategory; dataset?: Dataset; onMenuClick: () => void }) {
  const currentStep = stepItems.find((step) => step.stage === stage)
  return <header className="bis-topbar">
    <button className="bis-mobile-menu" onClick={onMenuClick} aria-label="Open navigation"><Menu size={20} /></button>
    <div className="bis-breadcrumb"><span>Business Insight Studio</span><ChevronRight size={14} /><strong>{stage === 'category' ? 'Get started' : currentStep?.label}</strong></div>
    <div className="bis-top-right">
      {category && <span className="bis-top-chip"><CategoryMark category={category} size={13} />{category.shortName}</span>}
      {dataset && <span className="bis-local-chip"><span />Local API analysis</span>}
      <div className="bis-user-avatar" title="Business owner">BI</div>
    </div>
  </header>
}

function Sidebar({ stage, category, dataset, mobileOpen, closeMobile, navigate, reset }: {
  stage: Stage
  category?: BusinessCategory
  dataset?: Dataset
  mobileOpen: boolean
  closeMobile: () => void
  navigate: (stage: Stage) => void
  reset: () => void
}) {
  const activeIndex = stepIndex(stage)
  return <>
    <aside className={`bis-sidebar ${mobileOpen ? 'is-open' : ''}`}>
      <a className="bis-brand" href="#" onClick={(event) => { event.preventDefault(); navigate('category') }}>
        <span className="bis-brand-mark"><BarChart3 size={20} strokeWidth={2.5} /></span>
        <span>business insight<small>STUDIO</small></span>
      </a>
      <div className="bis-workspace-card">
        <span className="bis-workspace-mark">{category ? <CategoryMark category={category} size={17} /> : <Sparkles size={17} />}</span>
        <span><strong>{category?.name ?? 'Your workspace'}</strong><small>{dataset?.fileName ?? (category ? 'Waiting for a dataset' : 'Select a business type')}</small></span>
        <ChevronDown size={14} />
      </div>
      <div className="bis-side-label">YOUR WORKFLOW</div>
      <nav className="bis-nav" aria-label="Business analytics workflow">
        {stepItems.map(({ stage: itemStage, label, icon: Icon }, index) => {
          const locked = index > 0 && !category || index > 1 && !dataset
          return <button key={itemStage} className={`bis-nav-item ${itemStage === stage ? 'active' : ''} ${index < activeIndex ? 'complete' : ''}`} disabled={locked} onClick={() => { navigate(itemStage); closeMobile() }}>
            <span className="bis-nav-icon">{index < activeIndex ? <Check size={16} /> : <Icon size={17} />}</span>
            <span>{label}</span>
            {itemStage === stage && <i />}
          </button>
        })}
      </nav>
      <div className="bis-sidebar-foot">
        <div className="bis-privacy-card"><span><Database size={16} /></span><strong>Local API processing</strong><p>Uploads go to the configured API. The default backend runs on localhost; check its URL before sending sensitive files.</p></div>
        {dataset && <button className="bis-reset-button" onClick={reset}><CloudUpload size={15} /> Upload another dataset</button>}
        <div className="bis-sidebar-owner"><div className="bis-owner-avatar">BI</div><span><strong>Business owner</strong><small>Local workspace</small></span><span className="bis-owner-menu">•••</span></div>
      </div>
    </aside>
    {mobileOpen && <button className="bis-mobile-scrim" aria-label="Close navigation" onClick={closeMobile} />}
  </>
}

function PageTitle({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: React.ReactNode }) {
  return <div className="bis-page-title"><div><div className="bis-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{children && <div className="bis-title-actions">{children}</div>}</div>
}

function StageProgress({ stage }: { stage: Stage }) {
  const current = stepIndex(stage)
  return <div className="bis-progress" aria-label={`Step ${current + 1} of ${stepItems.length}`}>
    {stepItems.map((step, index) => <div className={`bis-progress-step ${index <= current ? 'done' : ''} ${index === current ? 'current' : ''}`} key={step.stage}>
      <span>{index < current ? <Check size={12} /> : `0${index + 1}`}</span><small>{step.label}</small>
      {index < stepItems.length - 1 && <i />}
    </div>)}
  </div>
}

function CategorySelection({ onSelect }: { onSelect: (id: CategoryId) => void }) {
  return <div className="bis-page-wrap">
    <PageTitle eyebrow="LET'S GET TO KNOW YOUR BUSINESS" title="What kind of business do you run?" description="Choose a category to tailor your analytics. You can change it at any time." />
    <StageProgress stage="category" />
    <section className="bis-category-grid" aria-label="Business categories">
      {categories.map((category, index) => <button key={category.id} className={`bis-category-card ${category.accent}`} onClick={() => onSelect(category.id)}>
        <div className="bis-category-card-top"><CategoryMark category={category} size={21} /><span>0{index + 1}</span></div>
        <h2>{category.name}</h2><p>{category.description}</p>
        <span className="bis-category-choose">Select category <ArrowRight size={15} /></span>
      </button>)}
    </section>
    <div className="bis-how-note"><span><Sparkles size={16} /></span><p><strong>Your numbers, not ours.</strong> Dashboards are calculated only from the data you upload. No sample figures or live AI analysis are used.</p></div>
  </div>
}

function UploadScreen({ category, dataset, busy, error, onFile, onBack, onViewDataset }: {
  category: BusinessCategory
  dataset?: Dataset
  busy: boolean
  error: string
  onFile: (file?: File) => void
  onBack: () => void
  onViewDataset: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    onFile(event.dataTransfer.files[0])
  }
  const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      inputRef.current?.click()
    }
  }
  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    onFile(event.target.files?.[0])
    event.target.value = ''
  }
  return <div className="bis-page-wrap">
    <PageTitle eyebrow="STEP 02 · ADD YOUR BUSINESS DATA" title="Upload a sales dataset" description={`We'll use the columns in your file to build analytics for ${category.name.toLowerCase()}.`}>
      <button className="bis-button bis-button-quiet" onClick={onBack}><ArrowLeft size={15} /> Change category</button>
    </PageTitle>
    <StageProgress stage="upload" />
    <div className="bis-upload-layout">
      <section className="bis-card bis-upload-card">
        {dataset && <div className="bis-existing-dataset"><span className="bis-file-badge"><FileSpreadsheet size={18} /></span><span><strong>{dataset.fileName}</strong><small>{dataset.rows.length.toLocaleString()} rows · {dataset.columns.length} columns · currently loaded</small></span><button className="bis-link-button" onClick={onViewDataset}>View current data</button></div>}
        <div className={`bis-dropzone ${dragging ? 'dragging' : ''} ${error ? 'has-error' : ''} ${busy ? 'is-loading' : ''}`} role="button" tabIndex={0} aria-label="Choose a CSV or Excel file" onClick={() => !busy && inputRef.current?.click()} onKeyDown={handleKeyboard} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
          <input ref={inputRef} type="file" accept=".csv,.xlsx" hidden onChange={handleInput} />
          {busy ? <span className="bis-upload-glyph spinning"><CloudUpload size={26} /></span> : <span className="bis-upload-glyph"><CloudUpload size={26} /></span>}
          <h2>{busy ? 'Reading your file…' : dragging ? 'Drop your file to get started' : 'Drag and drop your file here'}</h2>
          <p>{busy ? 'Validating the file with the configured backend.' : <>or <button className="bis-inline-link" onClick={(event) => { event.stopPropagation(); inputRef.current?.click() }}>browse files</button> from your device</>}</p>
          <div className="bis-format-tags"><span>CSV</span><span>XLSX</span><span>UP TO 20 MB</span></div>
        </div>
        {error && <div className="bis-alert bis-alert-error" role="alert"><CircleAlert size={17} /><span>{error}</span></div>}
        <div className="bis-upload-foot"><span><Database size={15} /> Sent to configured local API</span><span>Original file is never changed</span></div>
      </section>
      <aside className="bis-upload-aside">
        <div className="bis-card bis-file-guide"><div className="bis-mini-heading"><span><FileSpreadsheet size={17} /></span><strong>File requirements</strong></div>
          <div className="bis-requirement"><Check size={14} /><span>CSV or Excel <strong>.xlsx</strong> file</span></div>
          <div className="bis-requirement"><Check size={14} /><span>First row contains column headers</span></div>
          <div className="bis-requirement"><Check size={14} /><span>Maximum file size: 20 MB</span></div>
          <p className="bis-guide-note">Column names and order can vary. You'll review a preview and choose how the columns map to your business data.</p>
        </div>
        <div className="bis-tip-card"><span><MapPin size={16} /></span><div><strong>Local backend processing</strong><p>The file is sent to your configured API endpoint for validation and analysis. No external AI or third-party service is connected by default.</p></div></div>
      </aside>
    </div>
  </div>
}

function PreviewScreen({ dataset, category, apiPreview, onContinue, onBack }: { dataset: Dataset; category: BusinessCategory; apiPreview?: DatasetPreview; onContinue: () => void; onBack: () => void }) {
  const previewColumns = dataset.columns
  const previewRows = dataset.rows.slice(0, 8)
  return <div className="bis-page-wrap bis-wide-wrap">
    <PageTitle eyebrow="STEP 03 · CHECK YOUR DATA" title="Your data, at a glance" description="Review the actual headers and rows read from your file before mapping them.">
      <button className="bis-button bis-button-quiet" onClick={onBack}><ArrowLeft size={15} /> Choose another file</button>
    </PageTitle>
    <StageProgress stage="preview" />
    <div className="bis-preview-summary">
      <div className="bis-file-summary"><span className="bis-file-badge"><FileSpreadsheet size={19} /></span><span><strong>{dataset.fileName}</strong><small>Local file · {category.name}</small></span><span className="bis-read-status"><Check size={14} /> Read successfully</span></div>
      <div className="bis-stat-strip"><PreviewStat label="Total rows" value={(apiPreview?.rowCount ?? dataset.rows.length).toLocaleString()} /><PreviewStat label="Total columns" value={(apiPreview?.columnCount ?? dataset.columns.length).toLocaleString()} /><PreviewStat label="Missing values" value={(apiPreview?.missingValues ?? dataset.missingValues).toLocaleString()} /><PreviewStat label="Exact duplicates" value={(apiPreview?.duplicateRows ?? dataset.duplicateRows).toLocaleString()} /></div>
    </div>
    {dataset.warnings.length > 0 && <QualityAlert warnings={dataset.warnings} title="Data quality notes" />}
    <section className="bis-card bis-table-card">
      <div className="bis-section-title"><div><h2>Sample rows</h2><p>First {previewRows.length.toLocaleString()} of {dataset.rows.length.toLocaleString()} records · all columns are retained</p></div><span className="bis-local-chip"><span />Actual uploaded data</span></div>
      <div className="bis-table-outer"><table className="bis-data-table"><thead><tr>{previewColumns.map((column) => <th key={column}>{column}{dataset.inferredTypes?.[column] && <small className="bis-inferred-type">{dataset.inferredTypes[column]}</small>}</th>)}</tr></thead><tbody>
        {previewRows.map((row, index) => <tr key={index}>{previewColumns.map((column) => <td key={column} title={displayCell(row[column])}>{displayCell(row[column]) || <span className="bis-empty-cell">—</span>}</td>)}</tr>)}
      </tbody></table></div>
    </section>
    <div className="bis-page-actions"><span><Database size={15} /> Your original file is not modified</span><button className="bis-button bis-button-primary" onClick={onContinue}>Review column mappings <ArrowRight size={16} /></button></div>
  </div>
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return <div className="bis-preview-stat"><span>{label}</span><strong>{value}</strong></div>
}

function QualityAlert({ warnings, title }: { warnings: string[]; title: string }) {
  return <div className="bis-quality-alert"><span className="bis-quality-icon"><TriangleAlert size={17} /></span><div><strong>{title}</strong><ul>{warnings.slice(0, 5).map((warning) => <li key={warning}>{warning}</li>)}</ul>{warnings.length > 5 && <small>And {warnings.length - 5} additional note{warnings.length - 5 === 1 ? '' : 's'}.</small>}</div></div>
}

function MappingScreen({ dataset, category, mappings, amountAggregation, onMappingChange, onAggregationChange, onContinue, onBack }: {
  dataset: Dataset
  category: BusinessCategory
  mappings: Mappings
  amountAggregation: AmountAggregation
  onMappingChange: (field: FieldId, column: string) => void
  onAggregationChange: (aggregation: AmountAggregation) => void
  onContinue: () => void
  onBack: () => void
}) {
  const required = requiredFieldsFor(category)
  const missingRequired = required.filter((field) => !mappings[field])
  const fields = getFieldsForCategory(category)
  return <div className="bis-page-wrap">
    <PageTitle eyebrow="STEP 04 · TELL US WHAT EACH COLUMN MEANS" title="Map your columns" description="We suggested a few matches from your headers. Review or change them to make your analytics accurate.">
      <button className="bis-button bis-button-quiet" onClick={onBack}><ArrowLeft size={15} /> Back to preview</button>
    </PageTitle>
    <StageProgress stage="mapping" />
    <div className="bis-mapping-layout">
      <section className="bis-card bis-mapping-card">
        <div className="bis-section-title"><div><h2>Columns for {category.name}</h2><p>Choose the matching uploaded column, or leave it unmapped.</p></div><span className="bis-mapping-count">{Object.values(mappings).filter(Boolean).length} mapped</span></div>
        <div className="bis-mapping-list">{fields.map((field) => <label className="bis-mapping-row" key={field.id}>
          <span className="bis-field-description"><strong>{field.label}</strong><small>{field.description}</small></span>
          <span className={`bis-mapping-select-wrap ${mappings[field.id] ? 'mapped' : ''}`}><select value={mappings[field.id] ?? ''} onChange={(event) => onMappingChange(field.id, event.target.value)} aria-label={`Map ${field.label}`}>
            <option value="">Not mapped</option>{dataset.columns.map((column) => <option value={column} key={column}>{column}</option>)}
          </select><ChevronDown size={14} /></span>
          {required.includes(field.id) && <span className="bis-required-tag">KEY FIELD</span>}
        </label>)}</div>
        {fields.some((field) => field.id === 'amount') && fields.some((field) => field.id === 'orderId') && <label className="bis-aggregation-setting">
          <span><strong>Revenue / sales amount granularity</strong><small>Choose how repeated order values should be counted. This does not change your uploaded file.</small></span>
          <span className="bis-mapping-select-wrap"><select value={amountAggregation} disabled={!mappings.orderId} onChange={(event) => onAggregationChange(event.target.value === 'order' ? 'order' : 'row')} aria-label="Revenue amount granularity">
            <option value="row">Amounts are per row or line item (sum rows)</option>
            <option value="order">Order totals repeat across rows (count each order once)</option>
          </select><ChevronDown size={14} /></span>
          {!mappings.orderId && <small className="bis-aggregation-help">Map an Order ID column to enable order-total deduplication.</small>}
        </label>}
        <div className="bis-map-foot"><span>Optional fields can be mapped whenever they exist in your file.</span><button className="bis-button bis-button-primary" onClick={onContinue}>Generate analytics <ArrowRight size={16} /></button></div>
      </section>
      <aside className="bis-mapping-aside">
        <div className="bis-card bis-source-columns"><div className="bis-mini-heading"><span><Database size={16} /></span><strong>Detected columns</strong><small>{dataset.columns.length}</small></div><div className="bis-column-chip-list">{dataset.columns.map((column) => <span key={column}>{column}</span>)}</div><p>Column suggestions are based on header names. Confirm them against your data.</p></div>
        {missingRequired.length > 0
          ? <div className="bis-missing-note"><span><CircleAlert size={16} /></span><div><strong>Some key fields aren't mapped</strong><p>{missingRequired.map((field) => fieldDefinitions[field].label).join(' and ')} is missing. Continue anyway to see only the metrics your data supports.</p></div></div>
          : <div className="bis-mapping-ready"><Check size={16} /><span><strong>Key field mapped</strong><small>Optional metrics will appear only when their data is available.</small></span></div>}
        <div className="bis-tip-card"><span><Sparkles size={16} /></span><div><strong>Calculations stay transparent</strong><p>Unavailable metrics include a reason. No values are filled in or inferred from sample data.</p></div></div>
      </aside>
    </div>
  </div>
}

function BusinessReportScreen({ dataset, category, mappings, analytics, insights, recommendations, downloading, downloadError, onDownloadPdf, onBack }: {
  dataset: Dataset
  category: BusinessCategory
  mappings: Mappings
  analytics: ApiAnalytics & { rowsInScope: DataRow[] }
  insights: ApiAnalytics['insights']
  recommendations: ApiAnalytics['recommendations']
  downloading: boolean
  downloadError: string
  onDownloadPdf: () => void
  onBack: () => void
}) {
  const report = useMemo(() => createBusinessReport(dataset, category, mappings, analytics, insights, recommendations), [dataset, category, mappings, analytics, insights, recommendations])

  return <div className="bis-page-wrap bis-wide-wrap bis-report-view">
    <PageTitle eyebrow="GENERATED FROM YOUR ACTIVE DATASET" title="Business performance report" description="Every figure below is calculated from the selected category, active mappings, and uploaded data.">
      <button className="bis-button bis-button-quiet" onClick={onBack}><ArrowLeft size={15} /> Back to dashboard</button>
      <button className="bis-button bis-button-primary" onClick={onDownloadPdf} disabled={downloading}><Download size={15} /> {downloading ? 'Preparing PDF…' : 'Download PDF Report'}</button>
    </PageTitle>
    <div className="bis-report-meta"><span className="bis-file-badge"><FileText size={18} /></span><span><strong>{report.title}</strong><small>{report.datasetName} · {report.rowsInPeriod.toLocaleString()} of {report.rowCount.toLocaleString()} source rows · {report.columnCount} columns</small></span><span className="bis-report-period"><CalendarDays size={14} />{report.period}</span></div>
    {downloadError && <div className="bis-alert bis-alert-error" role="alert"><CircleAlert size={16} /><span>{downloadError}</span></div>}
    <div className="bis-report-disclaimer"><Database size={15} /><span><strong>Dataset-grounded report.</strong> Uses only uploaded data and active mappings. Comparisons are labeled by their available periods; recommendations are potential actions, not guarantees.</span></div>
    <div className="bis-report-kpis">{report.metrics.slice(0, 4).map((metric) => <MetricCard key={metric.label} metric={metric} category={category} dataset={dataset} mappings={mappings} />)}</div>
    <div className="bis-report-sections">{report.sections.map((section) => <ReportSectionView key={section.title} section={section} currency={inferCurrency(dataset, { amount: category.id === 'marketing' ? mappings.campaignSpend : category.id === 'logistics' ? mappings.deliveryCost : mappings.amount })} />)}</div>
    <div className="bis-report-endnote"><Check size={15} /> Report generated {report.generatedAt}. Upload another dataset to generate an updated report.</div>
  </div>
}

function ReportSectionView({ section, currency }: { section: ReportSection; currency?: string }) {
  return <section className="bis-card bis-report-section">
    <div className="bis-report-section-heading"><span><FileText size={15} /></span><h2>{section.title}</h2></div>
    {section.paragraphs?.map((paragraph, index) => <p className="bis-report-paragraph" key={index}>{paragraph}</p>)}
    {section.chart && <div className="bis-report-chart"><TrendChart data={section.chart} currency={currency} /></div>}
    {section.table && section.table.rows.length > 0 && <div className="bis-table-outer bis-report-table-wrap"><table className="bis-data-table"><thead><tr>{section.table.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{section.table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} title={cell}>{cell}</td>)}</tr>)}</tbody></table></div>}
    {section.bullets && <ul className="bis-report-bullets">{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
  </section>
}

function DashboardScreen({ dataset, category, mappings, range, analytics, setRange, assistantOpen, setAssistantOpen, assistantQuestion, assistantMessages, assistantResponding, assistantError, reportDownloading, reportDownloadError, onDownloadReport, onAssistantQuestionChange, onAssistantSend, onUploadAnother, onEditMapping, onGenerateReport }: {
  dataset: Dataset
  category: BusinessCategory
  mappings: Mappings
  range: DateRange
  analytics: ApiAnalytics & { rowsInScope: DataRow[] }
  setRange: (range: DateRange) => void
  assistantOpen: boolean
  setAssistantOpen: (open: boolean) => void
  assistantQuestion: string
  assistantMessages: ChatMessage[]
  assistantResponding: boolean
  assistantError: string
  reportDownloading: boolean
  reportDownloadError: string
  onDownloadReport: () => void
  onAssistantQuestionChange: (question: string) => void
  onAssistantSend: (question: string) => void
  onUploadAnother: () => void
  onEditMapping: () => void
  onGenerateReport: () => void
}) {
  const dateAvailable = Boolean(mappings.date)
  const trendMeasureColumn = category.id === 'marketing' ? mappings.campaignSpend : category.id === 'logistics' ? mappings.deliveryCost : mappings.amount
  const breakdownMeasureColumn = category.id === 'marketing'
    ? mappings.campaignSpend
    : category.id === 'logistics'
      ? mappings.deliveryCost
      : mappings.amount ?? mappings.quantity
  const trendCurrency = trendMeasureColumn ? inferCurrency(dataset, { amount: trendMeasureColumn }) : undefined
  const breakdownCurrency = breakdownMeasureColumn && breakdownMeasureColumn !== mappings.quantity
    ? inferCurrency(dataset, { amount: breakdownMeasureColumn })
    : undefined
  return <div className="bis-page-wrap bis-wide-wrap">
    <PageTitle eyebrow={`${category.name.toUpperCase()} · YOUR DATA`} title={`${category.shortName} dashboard`} description="A focused view of the metrics your uploaded data can support.">
      <button className="bis-button bis-button-quiet" onClick={() => setAssistantOpen(!assistantOpen)} aria-expanded={assistantOpen}><MessageCircle size={15} /> {assistantOpen ? 'Hide assistant' : 'Ask assistant'}</button>
      <button className="bis-button bis-button-report" onClick={onGenerateReport}><FileText size={15} /> Generate Business Report</button>
      <button className="bis-button bis-button-primary" onClick={onDownloadReport} disabled={reportDownloading}><Download size={15} /> {reportDownloading ? 'Preparing PDF…' : 'Download PDF Report'}</button>
      <button className="bis-button bis-button-quiet" onClick={onEditMapping}><SlidersHorizontal size={15} /> Edit mappings</button>
      <button className="bis-button bis-button-primary" onClick={onUploadAnother}><CloudUpload size={15} /> Upload another</button>
    </PageTitle>
    {reportDownloadError && <div className="bis-alert bis-alert-error" role="alert"><CircleAlert size={16} /><span>{reportDownloadError}</span></div>}
    <div className="bis-dashboard-context">
      <div className="bis-context-left"><CategoryMark category={category} size={18} /><span><strong>{dataset.fileName}</strong><small>{dataset.rows.length.toLocaleString()} rows · {dataset.columns.length} columns · analyzed by local API</small></span></div>
      <div className="bis-context-actions">{dateAvailable && <label className="bis-date-select"><CalendarDays size={15} /><select value={range} onChange={(event) => setRange(event.target.value as DateRange)} aria-label="Filter dashboard by date"><option value="all">All dates</option><option value="30">Latest 30 days</option><option value="90">Latest 90 days</option></select><ChevronDown size={14} /></label>}<span className="bis-local-chip"><span />Dataset only</span></div>
    </div>
    <BusinessAssistant dataset={dataset} question={assistantQuestion} messages={assistantMessages} responding={assistantResponding} error={assistantError} open={assistantOpen} onQuestionChange={onAssistantQuestionChange} onSend={onAssistantSend} />
    {analytics.qualityNotes.length > 0 && <QualityAlert warnings={analytics.qualityNotes} title="Calculation notes" />}
    {analytics.qualityNotes.length === 0 && <div className="bis-clean-note"><Check size={15} /> No data quality issues were identified in mapped fields.</div>}
    <section className="bis-kpi-grid" aria-label={`${category.name} key metrics`}>{analytics.metrics.map((metric) => <MetricCard key={metric.label} metric={metric} category={category} dataset={dataset} mappings={mappings} />)}</section>
    <section className="bis-chart-grid">
      <ChartCard title={analytics.trendLabel} subtitle={mappings.date ? `Based on ${mappings.date} and available numeric values` : 'Map a date column and a relevant amount to see a trend'} empty={!analytics.trend.length}><TrendChart data={analytics.trend} currency={trendCurrency} /></ChartCard>
      <ChartCard title={analytics.breakdownLabel} subtitle={mappings.item || mappings.category || mappings.region ? 'Highest values from the uploaded rows' : 'Map a product, category, or region column to see a breakdown'} empty={!analytics.breakdown.length}><BreakdownChart data={analytics.breakdown} currency={breakdownCurrency} /></ChartCard>
    </section>
    <section className="bis-insights-section">
      <div className="bis-insights-heading"><div><div className="bis-eyebrow">DATA-GROUNDED ANALYSIS</div><h2>Business insights & recommendations</h2><p>Observed findings are calculated from the active dataset. Suggested actions are prompts, not guaranteed outcomes.</p></div><span className="bis-derived-pill"><Check size={12} /> Current dataset</span></div>
      {analytics.insights.length > 0
        ? <div className="bis-insight-grid">{analytics.insights.map((insight) => {
          const currency = insight.valueType === 'amount' ? inferCurrency(dataset, mappings) : undefined
          const exact = insight.rawValue === undefined
            ? insight.value
            : insight.valueType === 'amount'
              ? `${insight.id === 'period-over-period-change' && insight.rawValue > 0 ? '+' : ''}${formatExactNumber(insight.rawValue, currency)}${insight.percentage === null ? ' (percentage unavailable)' : insight.percentage !== undefined ? ` (${formatExactNumber(Math.abs(insight.percentage))}%)` : ''}`
              : insight.valueType === 'percent'
                ? `${formatExactNumber(insight.rawValue)}%`
                : formatExactNumber(insight.rawValue)
          const compact = insight.rawValue === undefined
            ? insight.value
            : insight.valueType === 'amount'
              ? `${insight.id === 'period-over-period-change' && insight.rawValue > 0 ? '+' : ''}${formatCompactNumber(insight.rawValue, currency)}${insight.percentage === null ? ' (n/a %)' : insight.percentage !== undefined ? ` (${formatExactNumber(Math.abs(insight.percentage))}%)` : ''}`
              : insight.valueType === 'percent'
                ? `${formatExactNumber(insight.rawValue)}%`
                : formatExactNumber(insight.rawValue)
          return <article className="bis-insight-card" key={insight.id} title={`Exact value: ${exact}\n${insight.explanation}`}>
            <span className="bis-insight-label"><Sparkles size={12} /> OBSERVED</span>
            <h3>{insight.title}</h3>
            <strong>{compact}</strong>
            <small>{insight.metric} · {insight.period}</small>
            <p>{insight.explanation}</p>
          </article>
        })}</div>
        : <div className="bis-insights-empty"><BarChart3 size={17} /><p>No findings can be supported by the current mappings and data coverage. Map relevant date, amount, and product/category fields, or check the calculation notes above.</p></div>}
      {analytics.recommendations.length > 0 && <div className="bis-recommendations">
        <h3>Potential actions to consider</h3>
        <div className="bis-recommendation-grid">{analytics.recommendations.map((recommendation) => <article className="bis-recommendation-card" key={recommendation.id}>
          <span>SUGGESTED ACTION</span>
          <h4>{recommendation.title}</h4>
          <p>{recommendation.action}</p>
          <small>Based on: {recommendation.basis}</small>
        </article>)}</div>
      </div>}
    </section>
    <DataTable dataset={dataset} rows={analytics.rowsInScope} mappings={mappings} />
  </div>
}

function AnalysisStatus({ loading, error, onRetry }: { loading: boolean; error: string; onRetry: () => void }) {
  return <section className="bis-page-wrap">
    <div className={`bis-card bis-analysis-status ${error ? 'has-error' : ''}`} role={error ? 'alert' : 'status'}>
      <span className="bis-analysis-status-icon">{error ? <CircleAlert size={20} /> : <Database size={20} />}</span>
      <h1>{error ? 'Analysis could not be completed' : 'Analyzing your uploaded data'}</h1>
      <p>{error || 'The configured backend is validating your mappings and calculating results from this dataset.'}</p>
      {error && <button className="bis-button bis-button-primary" onClick={onRetry}>Retry analysis</button>}
      {loading && <span className="bis-analysis-progress" aria-label="Analysis in progress" />}
    </div>
  </section>
}

interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  notice?: boolean
}

function BusinessAssistant({ dataset, question, messages, responding, error, open, onQuestionChange, onSend }: {
  dataset: Dataset
  question: string
  messages: ChatMessage[]
  responding: boolean
  error: string
  open: boolean
  onQuestionChange: (question: string) => void
  onSend: (question: string) => void
}) {
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [messages, open])

  return <section className={`bis-card bis-assistant-panel ${open ? 'is-open' : ''}`} aria-label="Dataset business assistant" hidden={!open}>
    <div className="bis-assistant-header"><span className="bis-assistant-mark"><MessageCircle size={17} /></span><span><strong>Business analytics assistant</strong><small>Deterministic answers · Current dataset only</small></span><span className="bis-assistant-local"><i /> LOCAL</span></div>
    <div className="bis-assistant-messages" ref={messagesRef} aria-live="polite">
      {messages.length === 0 && <div className="bis-assistant-welcome"><span><Sparkles size={16} /></span><p><strong>Ask a question about {dataset.fileName}.</strong><br />Answers use the active column mappings and backend analytics. No external AI service is connected; unsupported questions are clearly identified.</p></div>}
      {messages.map((message) => <div className={`bis-chat-line ${message.role} ${message.notice ? 'notice' : ''}`} key={message.id}><div className="bis-chat-bubble">{message.role === 'assistant' && <small>{message.notice ? 'NOTICE' : 'FROM YOUR DATA'}</small>}{message.text}</div></div>)}
      {responding && <div className="bis-chat-line assistant"><div className="bis-chat-bubble bis-typing" role="status">Checking the active dataset…</div></div>}
    </div>
    {messages.length === 0 && <div className="bis-assistant-prompts">{['What is my total revenue?', 'Which product has the highest revenue?', 'Which month performed best?', 'What improvements do you recommend?'].map((prompt) => <button key={prompt} onClick={() => onSend(prompt)} disabled={responding}>{prompt}<ArrowRight size={12} /></button>)}</div>}
    <form className="bis-assistant-composer" onSubmit={(event) => { event.preventDefault(); onSend(question) }}><input value={question} maxLength={500} onChange={(event) => onQuestionChange(event.target.value)} placeholder="Ask about sales, products, profit, or improvements…" aria-label="Ask about your business data" /><button type="submit" disabled={!question.trim() || responding} aria-label="Send question"><Send size={15} /></button></form>
    {error && <div className="bis-assistant-error" role="alert">{error}</div>}
    <div className="bis-assistant-disclaimer"><Database size={12} /> Replies are calculated by your local backend from this dataset; no external AI service receives your data.</div>
  </section>
}

function MetricCard({ metric, category, dataset, mappings }: { metric: Metric; category: BusinessCategory; dataset: Dataset; mappings: Mappings }) {
  const icon = metric.label.toLowerCase().includes('date') || metric.label.toLowerCase().includes('delivery') ? Clock3 : metric.label.toLowerCase().includes('region') ? MapPin : categoryIcons[category.id]
  const Icon = icon
  const currency = inferCurrency(dataset, mappings)
  const displayValue = formatMetricCompactValue(metric, currency)
  const tooltip = formatMetricTooltip(metric, currency)
  return <article className={`bis-kpi-card ${metric.unavailable ? 'unavailable' : ''}`} title={tooltip}>
    <div className="bis-kpi-top"><span>{metric.label}</span><span className="bis-kpi-icon"><Icon size={16} /></span></div>
    <strong className="bis-kpi-value">{displayValue}</strong>
    <small>{metric.detail}</small>
  </article>
}

function ChartCard({ title, subtitle, empty, children }: { title: string; subtitle: string; empty: boolean; children: React.ReactNode }) {
  return <article className="bis-card bis-chart-card"><div className="bis-section-title"><div><h2>{title}</h2><p>{subtitle}</p></div><span className="bis-chart-mark"><BarChart3 size={15} /></span></div>
    {empty ? <div className="bis-chart-empty"><span><BarChart3 size={20} /></span><strong>No chart data available</strong><p>Map the relevant columns to calculate this chart. No values are estimated.</p></div> : children}
  </article>
}

function TrendChart({ data, currency }: { data: { label: string; value: number }[]; currency?: string }) {
  if (!data.length) return null
  const width = 620
  const height = 190
  const left = 43
  const right = 10
  const top = 14
  const bottom = 25
  const values = data.map((point) => point.value)
  const min = Math.min(0, ...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const points = data.map((point, index) => ({
    ...point,
    x: data.length === 1 ? left + plotWidth / 2 : left + index * plotWidth / (data.length - 1),
    y: top + plotHeight - ((point.value - min) / span) * plotHeight,
  }))
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const fill = `${left},${height - bottom} ${line} ${width - right},${height - bottom}`
  return <div className="bis-trend-wrap"><div className="bis-trend-y"><span>{formatCompactNumber(max, currency)}</span><span>{formatCompactNumber((max + min) / 2, currency)}</span><span>{formatCompactNumber(min, currency)}</span></div><svg className="bis-trend-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly trend from uploaded data">
    {[top, top + plotHeight / 2, top + plotHeight].map((y) => <line key={y} x1={left} x2={width - right} y1={y} y2={y} className="bis-chart-gridline" />)}
    <polygon points={fill} className="bis-trend-area" /><polyline points={line} className="bis-trend-line" />
    {points.map((point) => <circle key={point.label} cx={point.x} cy={point.y} r="4" className="bis-trend-point"><title>{point.label}: {formatExactNumber(point.value, currency)}</title></circle>)}
    <g className="bis-trend-labels">{points.map((point) => <text key={point.label} x={point.x} y={height - 5} textAnchor="middle">{point.label}</text>)}</g>
  </svg></div>
}

function BreakdownChart({ data, currency }: { data: { label: string; value: number }[]; currency?: string }) {
  const max = Math.max(...data.map((point) => Math.abs(point.value)), 1)
  return <div className="bis-breakdown-list">{data.map((point, index) => <div className="bis-breakdown-item" key={point.label} title={`${point.label}: ${formatExactNumber(point.value, currency)}`}>
    <div className="bis-breakdown-label"><span>{point.label}</span><strong>{formatCompactNumber(point.value, currency)}</strong></div>
    <div className="bis-breakdown-track"><i style={{ width: `${Math.max(3, Math.abs(point.value) / max * 100)}%`, '--bar-index': index } as React.CSSProperties} /></div>
  </div>)}</div>
}

function DataTable({ dataset, rows, mappings }: { dataset: Dataset; rows: DataRow[]; mappings: Mappings }) {
  const [query, setQuery] = useState('')
  const [sortColumn, setSortColumn] = useState('')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [page, setPage] = useState(0)
  const pageSize = 10
  const filtered = useMemo(() => rows.filter((row) => !query.trim() || dataset.columns.some((column) => displayCell(row[column]).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))), [rows, dataset.columns, query])
  const sorted = useMemo(() => {
    if (!sortColumn) return filtered
    return [...filtered].sort((a, b) => {
      const left = a[sortColumn]
      const right = b[sortColumn]
      const leftDate = parseDate(left)
      const rightDate = parseDate(right)
      if (leftDate && rightDate) return sortDirection === 'asc' ? leftDate.getTime() - rightDate.getTime() : rightDate.getTime() - leftDate.getTime()
      const leftNumber = parseNumber(left)
      const rightNumber = parseNumber(right)
      const leftValue = left instanceof Date ? left.getTime() : leftNumber
      const rightValue = right instanceof Date ? right.getTime() : rightNumber
      let order: number
      if (leftValue !== null && rightValue !== null) order = leftValue - rightValue
      else order = displayCell(left).localeCompare(displayCell(right), undefined, { numeric: true, sensitivity: 'base' })
      return sortDirection === 'asc' ? order : -order
    })
  }, [filtered, sortColumn, sortDirection])
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const currentRows = sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const mappedColumns = new Set(Object.values(mappings).filter((value): value is string => Boolean(value)))
  const changeSort = (column: string) => {
    if (column === sortColumn) setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc')
    else { setSortColumn(column); setSortDirection('asc') }
    setPage(0)
  }
  return <section className="bis-card bis-table-card bis-dashboard-table">
    <div className="bis-section-title"><div><h2>Uploaded records</h2><p>{filtered.length.toLocaleString()} of {rows.length.toLocaleString()} records in the current view · all source columns shown</p></div>
      <label className="bis-search"><Search size={15} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder="Search rows" aria-label="Search uploaded records" /></label>
    </div>
    <div className="bis-table-outer"><table className="bis-data-table bis-sortable-table"><thead><tr>{dataset.columns.map((column) => <th key={column}><button onClick={() => changeSort(column)} title={`Sort by ${column}`}><span>{column}</span>{mappedColumns.has(column) && <i title="Mapped field"><Check size={11} /></i>}{sortColumn === column ? sortDirection === 'asc' ? <ArrowDown size={13} /> : <ArrowDownUp size={13} /> : <ArrowDownUp size={13} className="bis-sort-muted" />}</button></th>)}</tr></thead><tbody>
      {currentRows.map((row, rowIndex) => <tr key={`${currentPage}-${rowIndex}`}>{dataset.columns.map((column) => <td key={column} title={displayCell(row[column])}>{displayCell(row[column]) || <span className="bis-empty-cell">—</span>}</td>)}</tr>)}
    </tbody></table>
      {filtered.length === 0 && <div className="bis-table-no-results">No records match “{query}”. Try a different search.</div>}
    </div>
    <div className="bis-table-footer"><span>Showing {filtered.length ? currentPage * pageSize + 1 : 0}–{Math.min((currentPage + 1) * pageSize, filtered.length)} of {filtered.length.toLocaleString()} rows</span><div><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} aria-label="Previous page"><ArrowLeft size={14} /> Previous</button><span>Page {currentPage + 1} of {pageCount}</span><button disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} aria-label="Next page">Next <ArrowRight size={14} /></button></div></div>
  </section>
}

function BusinessInsightStudio() {
  const [stage, setStage] = useState<Stage>('category')
  const [categoryId, setCategoryId] = useState<CategoryId>()
  const [dataset, setDataset] = useState<Dataset>()
  const [sourceFile, setSourceFile] = useState<File>()
  const [apiPreview, setApiPreview] = useState<DatasetPreview>()
  const [apiAnalyticsState, setApiAnalyticsState] = useState<{ key: string; result: ApiAnalytics & { rowsInScope: DataRow[] } }>()
  const [datasetRevision, setDatasetRevision] = useState(0)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [analysisRetry, setAnalysisRetry] = useState(0)
  const [mappings, setMappings] = useState<Mappings>({})
  const [amountAggregation, setAmountAggregation] = useState<AmountAggregation>('row')
  const [range, setRange] = useState<DateRange>('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportDownloading, setReportDownloading] = useState(false)
  const [reportDownloadError, setReportDownloadError] = useState('')
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantQuestion, setAssistantQuestion] = useState('')
  const [assistantMessages, setAssistantMessages] = useState<ChatMessage[]>([])
  const [assistantResponding, setAssistantResponding] = useState(false)
  const [assistantError, setAssistantError] = useState('')
  const assistantMessageId = useRef(0)
  const assistantController = useRef<AbortController | undefined>(undefined)
  const assistantContextRef = useRef('')
  const reportDownloadController = useRef<AbortController | undefined>(undefined)
  const category = getCategory(categoryId ?? null)
  const analysisKey = JSON.stringify([datasetRevision, categoryId, mappings, range, amountAggregation])
  const analysisKeyRef = useRef(analysisKey)
  analysisKeyRef.current = analysisKey
  assistantContextRef.current = analysisKey
  const apiAnalytics = apiAnalyticsState?.key === analysisKey ? apiAnalyticsState.result : undefined

  useEffect(() => {
    reportDownloadController.current?.abort()
    reportDownloadController.current = undefined
    setReportDownloading(false)
    setReportDownloadError('')
  }, [analysisKey, sourceFile, stage])

  useEffect(() => () => reportDownloadController.current?.abort(), [])
  useEffect(() => () => assistantController.current?.abort(), [])

  useEffect(() => {
    if (stage !== 'dashboard' || !sourceFile || !dataset || !category) {
      setApiAnalyticsState(undefined)
      setAnalysisLoading(false)
      setAnalysisError('')
      return
    }
    const controller = new AbortController()
    setApiAnalyticsState(undefined)
    setAnalysisError('')
    setAnalysisLoading(true)
    analyzeUpload(sourceFile, category.id, mappings, range, amountAggregation, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setApiAnalyticsState({ key: analysisKey, result: { ...result, rowsInScope: rowsInDateRange(dataset, mappings, range) } })
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setAnalysisError(error instanceof Error ? error.message : 'The backend could not analyze this dataset.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setAnalysisLoading(false)
      })
    return () => controller.abort()
  }, [stage, sourceFile, dataset, category, mappings, range, amountAggregation, analysisRetry, analysisKey])

  useEffect(() => {
    assistantController.current?.abort()
    assistantController.current = undefined
    setAssistantOpen(false)
    setAssistantQuestion('')
    setAssistantMessages([])
    setAssistantResponding(false)
    setAssistantError('')
    assistantMessageId.current = 0
  }, [analysisKey, sourceFile])

  const sendAssistantQuestion = async (question: string) => {
    const text = question.trim()
    if (!text || assistantResponding || !sourceFile || !category) return
    const requestContext = analysisKey
    const controller = new AbortController()
    assistantController.current?.abort()
    assistantController.current = controller
    setAssistantMessages((current) => [...current, { id: assistantMessageId.current++, role: 'user', text }])
    setAssistantQuestion('')
    setAssistantError('')
    setAssistantResponding(true)
    try {
      const response = await askBusinessAssistant(sourceFile, category.id, mappings, range, amountAggregation, text, controller.signal)
      if (!controller.signal.aborted && assistantContextRef.current === requestContext) {
        setAssistantMessages((current) => [...current, { id: assistantMessageId.current++, role: 'assistant', text: response.answer, notice: response.kind === 'notice' }])
      }
    } catch (error) {
      if (!controller.signal.aborted && assistantContextRef.current === requestContext) {
        setAssistantError(error instanceof Error ? `${error.message} Your question is available to send again.` : 'The assistant could not reach the backend. Your question is available to send again.')
        setAssistantQuestion(text)
      }
    } finally {
      if (assistantController.current === controller) {
        assistantController.current = undefined
        setAssistantResponding(false)
      }
    }
  }

  const downloadReport = async () => {
    if (!sourceFile || !category || !apiAnalytics || reportDownloading) return
    const requestKey = analysisKey
    const controller = new AbortController()
    reportDownloadController.current?.abort()
    reportDownloadController.current = controller
    setReportDownloading(true)
    setReportDownloadError('')
    try {
      const pdf = await fetchBusinessReportPdf(sourceFile, category.id, mappings, range, amountAggregation, controller.signal)
      if (!controller.signal.aborted && analysisKeyRef.current === requestKey) saveBusinessReportPdf(pdf)
    } catch (error) {
      if (!controller.signal.aborted) {
        setReportDownloadError(error instanceof Error ? error.message : 'The business report could not be generated. Please try again.')
      }
    } finally {
      if (reportDownloadController.current === controller) {
        reportDownloadController.current = undefined
        setReportDownloading(false)
      }
    }
  }

  const navigate = (next: Stage) => {
    if (next === 'category' || category) {
      if (next === 'preview' || next === 'mapping' || next === 'dashboard') {
        if (!dataset) return
      }
      if ((next === 'upload' || next === 'preview' || next === 'mapping' || next === 'dashboard') && !category) return
      setError('')
      setReportOpen(false)
      setStage(next)
    }
  }

  const selectCategory = (id: CategoryId) => {
    setCategoryId(id)
    setDataset(undefined)
    setSourceFile(undefined)
    setApiPreview(undefined)
    setApiAnalyticsState(undefined)
    setMappings({})
    setAmountAggregation('row')
    setRange('all')
    setError('')
    setReportOpen(false)
    setStage('upload')
  }

  const acceptFile = async (file?: File) => {
    if (!file || !category) return
    setBusy(true)
    setError('')
    try {
      await getApiHealth()
      const preview = await previewUpload(file)
      const parsed = await parseUploadedFile(file)
      if (preview.rowCount !== parsed.rows.length || preview.columns.map((column) => column.name).join('\u0000') !== parsed.columns.join('\u0000')) {
        throw new Error('The local preview and backend parsed different rows or columns. Save the file as a standard UTF-8 CSV or XLSX workbook and try again.')
      }
      setDataset({
        ...parsed,
        emptyRows: preview.emptyRows,
        duplicateRows: preview.duplicateRows,
        missingValues: preview.missingValues,
        inferredTypes: Object.fromEntries(preview.columns.map((column) => [column.name, column.inferredType])),
        warnings: [...new Set([...parsed.warnings, ...preview.warnings])],
      })
      setSourceFile(file)
      setApiPreview(preview)
      setDatasetRevision((revision) => revision + 1)
      setMappings({})
      setAmountAggregation('row')
      setRange('all')
      setReportOpen(false)
      setStage('preview')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The file could not be read. Check the format and try again.')
    } finally {
      setBusy(false)
    }
  }

  const enterMapping = () => {
    if (!dataset || !category) return
    const detected = detectMappings(dataset.columns, getFieldsForCategory(category))
    setMappings(detected)
    setStage('mapping')
  }

  const changeMapping = (field: FieldId, column: string) => {
    setMappings((current) => ({ ...current, [field]: column || undefined }))
    if (field === 'orderId' && !column) setAmountAggregation('row')
  }

  const reset = () => {
    setCategoryId(undefined)
    setDataset(undefined)
    setSourceFile(undefined)
    setApiPreview(undefined)
    setApiAnalyticsState(undefined)
    setMappings({})
    setAmountAggregation('row')
    setRange('all')
    setError('')
    setReportOpen(false)
    setStage('category')
  }

  return <div className="bis-app-shell">
    <Sidebar stage={stage} category={category} dataset={dataset} mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)} navigate={(next) => next === 'category' ? reset() : navigate(next)} reset={reset} />
    <main className="bis-main">
      <AppHeader stage={stage} category={category} dataset={dataset} onMenuClick={() => setMobileOpen(true)} />
      <div className="bis-content">
        {!category && stage === 'category' && <CategorySelection onSelect={selectCategory} />}
        {category && stage === 'upload' && <UploadScreen category={category} dataset={dataset} busy={busy} error={error} onFile={acceptFile} onBack={reset} onViewDataset={() => setStage('preview')} />}
        {category && dataset && stage === 'preview' && <PreviewScreen dataset={dataset} category={category} apiPreview={apiPreview} onContinue={enterMapping} onBack={() => setStage('upload')} />}
        {category && dataset && stage === 'mapping' && <MappingScreen dataset={dataset} category={category} mappings={mappings} amountAggregation={amountAggregation} onMappingChange={changeMapping} onAggregationChange={setAmountAggregation} onContinue={() => setStage('dashboard')} onBack={() => setStage('preview')} />}
        {category && dataset && stage === 'dashboard' && <>
          {apiAnalytics
            ? <div hidden={reportOpen}><DashboardScreen dataset={dataset} category={category} mappings={mappings} range={range} analytics={apiAnalytics} setRange={setRange} assistantOpen={assistantOpen} setAssistantOpen={setAssistantOpen} assistantQuestion={assistantQuestion} assistantMessages={assistantMessages} assistantResponding={assistantResponding} assistantError={assistantError} reportDownloading={reportDownloading} reportDownloadError={reportDownloadError} onDownloadReport={downloadReport} onAssistantQuestionChange={(value) => { setAssistantQuestion(value); setAssistantError('') }} onAssistantSend={sendAssistantQuestion} onUploadAnother={() => { setReportOpen(false); setStage('upload') }} onEditMapping={() => setStage('mapping')} onGenerateReport={() => setReportOpen(true)} /></div>
            : <AnalysisStatus loading={analysisLoading} error={analysisError} onRetry={() => setAnalysisRetry((attempt) => attempt + 1)} />}
          {reportOpen && apiAnalytics && <BusinessReportScreen dataset={dataset} category={category} mappings={mappings} analytics={apiAnalytics} insights={apiAnalytics.insights} recommendations={apiAnalytics.recommendations} downloading={reportDownloading} downloadError={reportDownloadError} onDownloadPdf={downloadReport} onBack={() => setReportOpen(false)} />}
        </>}
        <footer className="bis-footer"><span><Database size={13} /> Local-first data workspace</span><i /> Business Insight Studio <i /> Local API analysis</footer>
      </div>
    </main>
  </div>
}

export default BusinessInsightStudio
