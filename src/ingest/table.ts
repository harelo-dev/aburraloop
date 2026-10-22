export type Cell = string | number | boolean | Date | null

export interface Table {
  headers: string[]
  rows: Cell[][]
}

/** Splits CSV text into rows. Handles quoted fields with delimiters, doubled quotes and line breaks inside quotes. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === delimiter) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

/** The delimiter that appears most often, outside quotes, in the first non-empty lines. */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 8000).split(/\r?\n/).filter((l) => l.trim()).slice(0, 5)
  let best = ','
  let bestScore = 0
  for (const d of [',', ';', '\t', '|']) {
    let total = 0
    for (const line of sample) {
      let quoted = false
      for (const c of line) {
        if (c === '"') quoted = !quoted
        else if (c === d && !quoted) total++
      }
    }
    if (total > bestScore) { best = d; bestScore = total }
  }
  return best
}

const isEmptyRow = (r: Cell[]) => r.every((c) => c === null || c === undefined || (typeof c === 'string' && c.trim() === ''))

/** First row with at least two filled cells is the header (the first filled row for a one-column file); empty rows are dropped. */
export function toTable(raw: Cell[][]): Table {
  const rows = raw.filter((r) => !isEmptyRow(r))
  const filled = (r: Cell[]) => r.filter((c) => c !== null && String(c).trim() !== '').length
  const wide = rows.findIndex((r) => filled(r) >= 2)
  const headerAt = wide >= 0 ? wide : 0
  if (!rows.length) throw new Error('El archivo no tiene filas con datos.')
  const width = Math.max(...rows.slice(headerAt).map((r) => r.length))
  const headers = Array.from({ length: width }, (_, i) => {
    const h = rows[headerAt][i]
    const t = h === null || h === undefined ? '' : String(h).trim()
    return t || `Columna ${i + 1}`
  })
  const body = rows.slice(headerAt + 1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? null))
  if (!body.length) throw new Error('El archivo solo tiene la fila de encabezados.')
  return { headers, rows: body }
}

async function decode(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const utf8 = new TextDecoder('utf-8').decode(buf)
  // Spreadsheets in Spanish often export CSV as Windows-1252, which is not valid UTF-8.
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8
}

export const MAX_BYTES = 25 * 1024 * 1024

export async function readTable(file: File): Promise<Table> {
  if (file.size > MAX_BYTES) throw new Error('El archivo pesa más de 25 MB.')
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx')) {
    // Loaded on demand so the reader is not part of the first page load.
    const { readSheet } = await import('read-excel-file/browser')
    const raw = (await readSheet(file)) as Cell[][]
    return toTable(raw)
  }
  if (name.endsWith('.xls')) throw new Error('El formato .xls antiguo no se puede leer. Guárdalo como .xlsx o .csv.')
  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv') || file.type.startsWith('text/')) {
    return toTable(parseCsv(await decode(file)))
  }
  throw new Error('Formato no soportado. Sube un archivo .csv o .xlsx.')
}
