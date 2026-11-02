import { readSheet } from 'read-excel-file/browser'
import type { CellValue, Dataset, DataRow } from './types'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_ROWS = 100_000

function parseCsvText(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let endedRow = false
  const delimiter = detectDelimiter(source)

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += character
      }
      endedRow = false
      continue
    }

    if (character === '"' && cell.length === 0) {
      quoted = true
      endedRow = false
    } else if (character === delimiter) {
      row.push(cell)
      cell = ''
      endedRow = false
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      endedRow = true
    } else {
      cell += character
      endedRow = false
    }
  }

  if (quoted) throw new Error('A quoted value is not closed. Check the CSV file and try again.')
  if (!endedRow || row.length > 0 || cell.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function detectDelimiter(source: string): string {
  const candidates = [',', ';', '\t', '|']
  const counts = new Map(candidates.map((candidate) => [candidate, 0]))
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '"') {
      if (quoted && source[index + 1] === '"') index += 1
      else quoted = !quoted
    } else if (!quoted && (character === '\n' || character === '\r')) {
      break
    } else if (!quoted && counts.has(character)) {
      counts.set(character, (counts.get(character) ?? 0) + 1)
    }
  }
  return candidates.reduce((best, candidate) => (counts.get(candidate) ?? 0) > (counts.get(best) ?? 0) ? candidate : best, ',')
}

function normalizeCell(value: unknown): CellValue {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}

function normalizeHeaders(rawHeaders: CellValue[], width: number, warnings: string[]): string[] {
  const seen = new Map<string, number>()
  const used = new Set<string>()
  return Array.from({ length: width }, (_, index) => {
    const raw = rawHeaders[index]
    const base = raw === null || raw === undefined || String(raw).trim() === '' ? `Column ${index + 1}` : String(raw).trim()
    if (base !== String(raw ?? '').trim()) warnings.push(`Column ${index + 1} has no header; it is labeled “${base}”.`)
    let count = (seen.get(base) ?? 0) + 1
    let label = count === 1 ? base : `${base} (${count})`
    while (used.has(label)) {
      count += 1
      label = `${base} (${count})`
    }
    seen.set(base, count)
    if (label !== base) {
      warnings.push(`Duplicate header “${base}” was renamed “${label}” so both columns remain available.`)
    }
    used.add(label)
    return label
  })
}

function buildDataset(fileName: string, rawRows: CellValue[][]): Dataset {
  if (rawRows.length === 0 || !rawRows[0]?.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '')) {
    throw new Error('No column headers were found. Add a header row and try again.')
  }

  const warnings: string[] = []
  const width = rawRows.reduce((maximum, row) => Math.max(maximum, row.length), 0)
  const headerWidth = rawRows[0]?.length ?? 0
  if (width > 512) throw new Error('This file has more than 512 columns. Remove unused columns and try again.')
  const columns = normalizeHeaders(rawRows[0] ?? [], width, warnings)
  const sourceRows = rawRows.slice(1)
  if (sourceRows.length > MAX_ROWS) throw new Error(`This file has more than ${MAX_ROWS.toLocaleString()} data rows. Split it into smaller files to avoid incomplete results.`)
  const malformedRows = sourceRows.filter((cells) => cells.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '') && cells.length !== headerWidth).length

  const rows: DataRow[] = sourceRows.map((cells) => Object.fromEntries(
    columns.map((column, index) => [column, normalizeCell(cells[index])]),
  ))
  const emptyRows = rows.filter((row) => columns.every((column) => String(row[column] ?? '').trim() === '')).length
  const duplicateRows = rows.length - new Set(rows.map((row) => JSON.stringify(columns.map((column) => row[column])))).size
  const missingValues = rows.reduce((total, row) => total + columns.filter((column) => String(row[column] ?? '').trim() === '').length, 0)

  if (rows.length === 0 || emptyRows === rows.length) throw new Error('This file has column headers but no data rows to analyze.')
  if (emptyRows > 0) warnings.push(`${emptyRows} completely blank row${emptyRows === 1 ? '' : 's'} retained in the preview and excluded from calculations that need values.`)
  if (malformedRows > 0) warnings.push(`${malformedRows.toLocaleString()} non-empty row${malformedRows === 1 ? '' : 's'} do not match the ${headerWidth.toLocaleString()} header columns. Short rows are padded with blanks, and extra cells are retained in generated columns.`)
  if (duplicateRows > 0) warnings.push(`${duplicateRows} exact duplicate row${duplicateRows === 1 ? '' : 's'} detected. Duplicates are retained and included in calculations.`)
  return { fileName, columns, rows, emptyRows, duplicateRows, missingValues, warnings: [...new Set(warnings)] }
}

export async function parseUploadedFile(file: File): Promise<Dataset> {
  if (file.size === 0) throw new Error('This file is empty. Choose a CSV or Excel file with column headers and data rows.')
  if (file.size > MAX_FILE_BYTES) throw new Error('This file is larger than 20 MB. Choose a smaller file to continue.')

  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'csv') {
    const text = await file.text()
    return buildDataset(file.name, parseCsvText(text).map((row) => row.map((cell) => cell as CellValue)))
  }
  if (extension === 'xlsx') {
    try {
      const sheetRows = await readSheet(file)
      return buildDataset(file.name, sheetRows.map((row) => row.map(normalizeCell)))
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('This file has')) throw error
      throw new Error('The spreadsheet could not be read. Check that the first sheet contains a valid table and try again.')
    }
  }
  throw new Error('Unsupported file format. Choose a CSV or XLSX file.')
}
