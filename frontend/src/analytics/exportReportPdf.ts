import type { jsPDF } from 'jspdf'
import type { BusinessReport, ReportSection } from './report'

const pageWidth = 210
const margin = 17
const contentWidth = pageWidth - margin * 2
const pageHeight = 297

function safeFilename(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'business-report'
}

function drawHeader(doc: jsPDF, report: BusinessReport): void {
  doc.setFillColor(36, 48, 76)
  doc.rect(0, 0, pageWidth, 24, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('BUSINESS INSIGHT STUDIO', margin, 10)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text(report.category, pageWidth - margin, 10, { align: 'right' })
  doc.setDrawColor(230, 234, 244)
  doc.line(margin, 28, pageWidth - margin, 28)
}

function addFooter(doc: jsPDF, report: BusinessReport, page: number, total: number): void {
  doc.setDrawColor(230, 234, 244)
  doc.line(margin, pageHeight - 14, pageWidth - margin, pageHeight - 14)
  doc.setTextColor(130, 142, 162)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text(`${report.datasetName} · Reporting period: ${report.period}`, margin, pageHeight - 9, { maxWidth: contentWidth - 30 })
  doc.text(`${page} / ${total}`, pageWidth - margin, pageHeight - 9, { align: 'right' })
}

function sectionTitle(doc: jsPDF, title: string, y: number): number {
  doc.setTextColor(38, 51, 76)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(title, margin, y, { maxWidth: contentWidth })
  doc.setDrawColor(99, 112, 235)
  doc.setLineWidth(0.7)
  doc.line(margin, y + 3, margin + 24, y + 3)
  doc.setLineWidth(0.2)
  return y + 11
}

function addParagraphs(doc: jsPDF, paragraphs: string[], y: number): number {
  doc.setTextColor(78, 91, 112)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  for (const paragraph of paragraphs) {
    const lines = doc.splitTextToSize(paragraph, contentWidth)
    if (y + lines.length * 4.5 > pageHeight - 23) {
      doc.addPage()
      y = 38
    }
    doc.text(lines, margin, y)
    y += lines.length * 4.5 + 4
  }
  return y
}

function addBullets(doc: jsPDF, bullets: string[], y: number): number {
  doc.setTextColor(78, 91, 112)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  for (const bullet of bullets) {
    const lines = doc.splitTextToSize(bullet, contentWidth - 7)
    if (y + lines.length * 4.4 > pageHeight - 22) {
      doc.addPage()
      y = 38
    }
    doc.setFillColor(101, 114, 232)
    doc.circle(margin + 1.1, y - 1, 0.8, 'F')
    doc.text(lines, margin + 5, y)
    y += lines.length * 4.4 + 3
  }
  return y
}

function addTable(doc: jsPDF, section: ReportSection, y: number, autoTable: typeof import('jspdf-autotable').default): number {
  if (!section.table) return y
  autoTable(doc, {
    startY: y,
    head: [section.table.headers],
    body: section.table.rows,
    margin: { left: margin, right: margin, bottom: 20 },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2.5, textColor: [74, 87, 107], lineColor: [230, 234, 242], lineWidth: 0.15, overflow: 'linebreak' },
    headStyles: { fillColor: [242, 244, 255], textColor: [58, 70, 111], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 251, 253] },
    columnStyles: section.table.headers.length === 3 ? { 0: { cellWidth: 39 }, 1: { cellWidth: 42 } } : undefined,
  })
  return (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
}

function addChart(doc: jsPDF, points: NonNullable<ReportSection['chart']>, y: number): number {
  if (points.length < 2) return y
  const chartWidth = contentWidth
  const chartHeight = 38
  const values = points.map((point) => point.value)
  const min = Math.min(0, ...values)
  const max = Math.max(...values)
  const span = max - min || 1
  doc.setFillColor(249, 250, 254)
  doc.roundedRect(margin, y, chartWidth, chartHeight + 9, 2, 2, 'F')
  doc.setDrawColor(229, 233, 242)
  for (let grid = 1; grid <= 2; grid += 1) {
    const gy = y + 5 + grid * chartHeight / 3
    doc.line(margin + 7, gy, margin + chartWidth - 7, gy)
  }
  const coords = points.map((point, index) => {
    const x = margin + 8 + (points.length === 1 ? chartWidth / 2 : index * (chartWidth - 16) / (points.length - 1))
    const py = y + 5 + chartHeight - (point.value - min) / span * chartHeight
    return { x, y: py }
  })
  doc.setDrawColor(97, 111, 235)
  doc.setLineWidth(0.8)
  for (let index = 1; index < coords.length; index += 1) {
    doc.line(coords[index - 1].x, coords[index - 1].y, coords[index].x, coords[index].y)
  }
  doc.setFillColor(97, 111, 235)
  for (const point of coords) doc.circle(point.x, point.y, 1.2, 'F')
  doc.setLineWidth(0.2)
  doc.setTextColor(119, 132, 153)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  const labelStep = Math.max(1, Math.ceil(points.length / 7))
  points.forEach((point, index) => {
    if (index % labelStep === 0 || index === points.length - 1) doc.text(point.label, coords[index].x, y + chartHeight + 8, { align: 'center' })
  })
  return y + chartHeight + 18
}

function addSection(doc: jsPDF, section: ReportSection, y: number, autoTable: typeof import('jspdf-autotable').default): number {
  if (y > pageHeight - 43) {
    doc.addPage()
    y = 38
  }
  y = sectionTitle(doc, section.title, y)
  if (section.paragraphs) y = addParagraphs(doc, section.paragraphs, y)
  if (section.chart) y = addChart(doc, section.chart, y)
  if (section.table?.rows.length) y = addTable(doc, section, y, autoTable)
  if (section.bullets) y = addBullets(doc, section.bullets, y)
  return y + 3
}

export async function exportBusinessReportPdf(report: BusinessReport): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  doc.setProperties({
    title: report.title,
    subject: `Data-driven report for ${report.category}`,
    author: 'Business Insight Studio',
    creator: 'Business Insight Studio',
  })

  const executive = report.sections.find((section) => section.title.includes('Executive Summary'))
  const overview = report.sections.find((section) => section.title.includes('Dataset Summary'))
  const kpis = report.sections.find((section) => section.title.includes('Performance Indicators'))
  const sales = report.sections.find((section) => /Revenue & Sales|Campaign Performance|Operations & Delivery/.test(section.title))
  const profit = report.sections.find((section) => section.title.includes('Profit & Loss'))
  const segment = report.sections.find((section) => section.title.includes('Product, Category, or Region Analysis'))
  const quality = report.sections.find((section) => section.title.includes('Data Quality'))
  const insights = report.sections.find((section) => section.title === 'Dataset-grounded Business Insights')
  const recommendations = report.sections.find((section) => section.title === 'Potential Actions from Dataset Findings')
  const conclusion = report.sections.find((section) => section.title === 'Conclusion')

  doc.setTextColor(42, 54, 80)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  const titleLines = doc.splitTextToSize(report.title, contentWidth)
  doc.text(titleLines, margin, 47)
  let y = 47 + titleLines.length * 8 + 4
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(113, 127, 149)
  doc.text(`Prepared ${report.generatedAt}`, margin, y)
  y += 7
  doc.text(`Dataset: ${report.datasetName}`, margin, y, { maxWidth: contentWidth })
  y += 6
  doc.text(`Reporting period: ${report.period}`, margin, y, { maxWidth: contentWidth })
  y += 15
  if (executive) y = addSection(doc, executive, y, autoTable)

  doc.addPage()
  y = 39
  if (overview) y = addSection(doc, overview, y, autoTable)
  if (kpis) y = addSection(doc, kpis, y, autoTable)

  doc.addPage()
  y = 39
  if (sales) y = addSection(doc, sales, y, autoTable)

  if (profit || segment) {
    doc.addPage()
    y = 39
    if (profit) y = addSection(doc, profit, y, autoTable)
    if (segment) y = addSection(doc, segment, y, autoTable)
  }

  if (insights || recommendations) {
    doc.addPage()
    y = 39
    if (insights) y = addSection(doc, insights, y, autoTable)
    if (recommendations) y = addSection(doc, recommendations, y, autoTable)
  }

  if (quality || conclusion) {
    doc.addPage()
    y = 39
    if (quality) y = addSection(doc, quality, y, autoTable)
    if (conclusion) addSection(doc, conclusion, y, autoTable)
  }

  const total = doc.getNumberOfPages()
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page)
    drawHeader(doc, report)
    addFooter(doc, report, page, total)
  }
  doc.save(`${safeFilename(report.category)}-${safeFilename(report.datasetName.replace(/\.[^.]+$/, ''))}-business-report.pdf`)
}
