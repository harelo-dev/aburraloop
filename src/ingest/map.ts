import places from '../data/places.json'
import travel from '../data/travel.json'
import { mulberry32, nearestCell, nearestMunicipality, type DataDay, type DataFailure, type Dataset, type Grade } from '../sim/simulate'
import type { Cell, Table } from './table'

export type FieldId = 'lat' | 'lon' | 'municipio' | 'resultado' | 'cod' | 'hora' | 'fecha' | 'grado'

export const FIELDS: { id: FieldId; label: string; hint: string }[] = [
  { id: 'resultado', label: 'Resultado de la entrega', hint: 'Entregado, fallido, devuelto… Sin esta columna se asume que todas las filas son fallidas.' },
  { id: 'lat', label: 'Latitud', hint: 'Con latitud y longitud la ubicación es exacta.' },
  { id: 'lon', label: 'Longitud', hint: '' },
  { id: 'municipio', label: 'Municipio', hint: 'Se usa si no hay coordenadas.' },
  { id: 'cod', label: 'Valor a cobrar (COD)', hint: 'Opcional. Si falta se usa un rango sintético.' },
  { id: 'hora', label: 'Hora del intento', hint: 'Opcional. Acepta 14:30, 2:30 pm o fecha y hora.' },
  { id: 'fecha', label: 'Fecha', hint: 'Opcional. Separa los días; sin ella todo cuenta como un solo día.' },
  { id: 'grado', label: 'Grado (A, B, C)', hint: 'Opcional. Si falta se usa la mezcla supuesta.' },
]

export type Mapping = Partial<Record<FieldId, number>>
export type Outcome = 'failed' | 'delivered' | 'ignore'

export const normalize = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// ── Values ────────────────────────────────────────────────────────────────

/** Coordinates: a decimal comma is read as a point. */
export function parseCoord(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const t = v.trim().replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}

/** Pesos. Dots or commas that group thousands are dropped, a trailing decimal part is kept: $1.250.000 · 1,250,000 · 1.250,50 · 1250.5 */
export function parseMoney(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const t = v.replace(/[^\d.,-]/g, '')
  if (!/\d/.test(t)) return null
  const lastDot = t.lastIndexOf('.'), lastComma = t.lastIndexOf(',')
  let out: string
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ','
    out = t.split(dec === '.' ? ',' : '.').join('').replace(dec, '.')
  } else {
    const sep = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : ''
    if (!sep) out = t
    else {
      const parts = t.split(sep)
      // 1.250 or 1.250.000 group thousands; 1250.5 or 1,5 is a decimal part.
      const grouped = parts.length > 2 || parts[parts.length - 1].length === 3
      out = grouped ? parts.join('') : parts.join('.')
    }
  }
  const n = Number(out)
  return Number.isFinite(n) ? n : null
}

export interface Moment { hour: number | null; date: string | null }

const pad = (n: number) => String(n).padStart(2, '0')

function dateKey(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/** Dates and times in the formats a spreadsheet or an export is likely to hold. Day first for d/m/y, as is usual in Colombia. */
export function parseMoment(v: Cell): Moment {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { hour: null, date: null }
    // Spreadsheet cells carry no time zone, so the reader builds them in UTC.
    const midnight = v.getUTCHours() === 0 && v.getUTCMinutes() === 0
    return { hour: midnight ? null : v.getUTCHours() + v.getUTCMinutes() / 60, date: dateKey(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()) }
  }
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) { // Excel serial date, with the time as the fraction
      const d = new Date(Math.round((v - 25569) * 86400000))
      return parseMoment(d)
    }
    if (v >= 0 && v < 1) return { hour: v * 24, date: null }
    if (Number.isInteger(v) && v >= 0 && v <= 24) return { hour: v, date: null }
    return { hour: null, date: null }
  }
  if (typeof v !== 'string') return { hour: null, date: null }
  const t = v.trim()
  let date: string | null = null
  let rest = t
  const iso = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  const dmy = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (iso) { date = dateKey(+iso[1], +iso[2], +iso[3]); rest = t.slice(iso[0].length) }
  else if (dmy) { date = dateKey(+dmy[3], +dmy[2], +dmy[1]); rest = t.slice(dmy[0].length) }
  const hm = rest.match(/(\d{1,2})\s*[:h.]\s*(\d{2})(?:\s*[:.]\s*\d{2})?\s*([ap])?\.?\s*m?\.?/i) ?? rest.match(/^\s*[T ]?(\d{1,2})\s*([ap])\.?\s*m\.?\s*$/i)
  let hour: number | null = null
  if (hm) {
    const withMinutes = hm[2] !== undefined && /^\d{2}$/.test(hm[2])
    let h = +hm[1] + (withMinutes ? +hm[2] / 60 : 0)
    const mer = (withMinutes ? hm[3] : hm[2])?.toLowerCase()
    if (mer === 'p' && h < 12) h += 12
    if (mer === 'a' && h >= 12 && h < 13) h -= 12
    hour = h >= 0 && h < 24 ? h : null
  } else if (!date && /^\d{1,2}$/.test(t) && +t <= 24) hour = +t
  return { hour, date }
}

const GRADE_RE = /^(?:grado|grade|clase|categoria|cat)?\s*([abc])$/
export function parseGrade(v: Cell): Grade | null {
  const m = normalize(v).match(GRADE_RE)
  return m ? (m[1].toUpperCase() as Grade) : null
}

// ── Places ────────────────────────────────────────────────────────────────

const ALIASES: Record<string, string> = { 'la estrella': 'laestrella', estrella: 'laestrella', 'ciudad de medellin': 'medellin', 'medellin antioquia': 'medellin' }

/** Finds the Aburrá Valley municipality a free-text place refers to ("Itagüí - Antioquia", "ITAGUI"). */
export function matchMunicipality(v: Cell): (typeof places.municipalities)[number] | null {
  const t = normalize(v)
  if (!t) return null
  const alias = ALIASES[t]
  if (alias) return places.municipalities.find((m) => m.id === alias) ?? null
  const tokens = ` ${t} `
  // Longest names first, so "la estrella" is tried before shorter ones.
  const byLength = [...places.municipalities].sort((a, b) => b.name.length - a.name.length)
  return byLength.find((m) => tokens.includes(` ${normalize(m.name)} `)) ?? null
}

// ── Detection ─────────────────────────────────────────────────────────────

const SYNONYMS: Record<FieldId, string[]> = {
  lat: ['latitud', 'lat', 'latitude', 'coord y'],
  lon: ['longitud', 'lon', 'lng', 'long', 'longitude', 'coord x'],
  municipio: ['municipio', 'ciudad', 'city', 'localidad', 'municipality', 'ciudad destino', 'municipio destino', 'destino'],
  resultado: ['resultado', 'estado', 'estatus', 'status', 'novedad', 'entregado', 'result', 'estado envio', 'estado entrega', 'estado del envio', 'estado de entrega'],
  cod: ['valor a cobrar', 'valor a recaudar', 'recaudo', 'cod', 'contraentrega', 'valor cod', 'monto', 'valor', 'precio', 'importe', 'amount', 'total a cobrar', 'valor declarado'],
  hora: ['hora', 'hora intento', 'hora entrega', 'hora de entrega', 'time', 'fecha hora', 'timestamp', 'datetime', 'fecha y hora'],
  fecha: ['fecha', 'date', 'dia', 'fecha entrega', 'fecha de entrega', 'fecha despacho', 'fecha envio'],
  grado: ['grado', 'grade', 'categoria', 'clase', 'calidad'],
}

function headerScore(field: FieldId, header: string): number {
  const h = normalize(header)
  let best = 0
  for (const s of SYNONYMS[field]) {
    if (h === s) best = Math.max(best, 3)
    else if (` ${h} `.includes(` ${s} `)) best = Math.max(best, 2)
  }
  return best
}

const sampleOf = (t: Table, col: number, n = 200) => t.rows.slice(0, n).map((r) => r[col]).filter((c) => c !== null && String(c).trim() !== '')
const share = (xs: Cell[], f: (c: Cell) => boolean) => (xs.length ? xs.filter(f).length / xs.length : 0)

const inRange = (v: number | null, lo: number, hi: number) => v !== null && v >= lo && v <= hi
const LAT = [travel.cells.reduce((m, c) => Math.min(m, c.lat), 90) - 0.1, travel.cells.reduce((m, c) => Math.max(m, c.lat), -90) + 0.1] as const
const LON = [travel.cells.reduce((m, c) => Math.min(m, c.lon), 180) - 0.1, travel.cells.reduce((m, c) => Math.max(m, c.lon), -180) + 0.1] as const

/** Picks a column for each field from header names first, then from what the values look like. */
export function detectMapping(t: Table): Mapping {
  const m: Mapping = {}
  const taken = new Set<number>()
  const claim = (f: FieldId, col: number) => { m[f] = col; taken.add(col) }

  // Coordinates are recognised by their values, which also catches swapped columns and headers like "X" and "Y".
  const asLat = (c: number) => share(sampleOf(t, c), (v) => inRange(parseCoord(v), LAT[0], LAT[1])) > 0.8
  const asLon = (c: number) => share(sampleOf(t, c), (v) => inRange(parseCoord(v), LON[0], LON[1])) > 0.8
  const cols = t.headers.map((_, i) => i)
  const lat = cols.find((c) => asLat(c))
  const lon = cols.find((c) => asLon(c))
  if (lat !== undefined && lon !== undefined) { claim('lat', lat); claim('lon', lon) }

  const fields = (Object.keys(SYNONYMS) as FieldId[]).filter((f) => m[f] === undefined)
  const scored = fields.flatMap((f) => cols.map((c) => ({ f, c, s: headerScore(f, t.headers[c]) }))).filter((x) => x.s > 0)
  scored.sort((a, b) => b.s - a.s || a.c - b.c)
  for (const { f, c } of scored) {
    if (m[f] !== undefined || taken.has(c)) continue
    claim(f, c)
  }

  // Fall back on content: a column whose values are place names, or A/B/C.
  if (m.municipio === undefined) {
    const c = cols.find((i) => !taken.has(i) && share(sampleOf(t, i), (v) => matchMunicipality(v) !== null) > 0.6)
    if (c !== undefined) claim('municipio', c)
  }
  if (m.grado === undefined) {
    const c = cols.find((i) => !taken.has(i) && share(sampleOf(t, i), (v) => parseGrade(v) !== null) > 0.9)
    if (c !== undefined) claim('grado', c)
  }
  // A header match can be wrong when the values say otherwise; drop what clearly does not parse.
  if (m.cod !== undefined && share(sampleOf(t, m.cod), (v) => parseMoney(v) !== null) < 0.6) delete m.cod
  if (m.grado !== undefined && share(sampleOf(t, m.grado), (v) => parseGrade(v) !== null) < 0.6) delete m.grado
  if (m.hora !== undefined && share(sampleOf(t, m.hora), (v) => parseMoment(v).hour !== null) < 0.5) delete m.hora
  if (m.fecha !== undefined && share(sampleOf(t, m.fecha), (v) => parseMoment(v).date !== null) < 0.5) delete m.fecha
  if (m.lat === undefined || m.lon === undefined) { delete m.lat; delete m.lon }
  return m
}

// ── Outcome ───────────────────────────────────────────────────────────────

const FAILED_RE = /\b(no entreg\w*|fall\w*|devuel\w*|devol\w*|novedad|rechaz\w*|cancel\w*|ausente|reagend\w*|reprogram\w*|sin exito|no efectiv\w*|undeliver\w*|failed|return\w*|incident\w*|no|0|false|n)\b/
const DELIVERED_RE = /\b(entreg\w*|exito\w*|efectiv\w*|deliver\w*|complet\w*|cerrad\w*|si|1|true|ok|s)\b/

/** A first reading of what each distinct value in the result column means. */
export function guessOutcome(value: string): Outcome {
  const v = normalize(value)
  if (!v) return 'ignore'
  if (FAILED_RE.test(v)) return 'failed'
  if (DELIVERED_RE.test(v)) return 'delivered'
  return 'ignore'
}

export interface Distinct { value: string; count: number }

/** Distinct values of a column with their counts, most frequent first. */
export function distinctValues(t: Table, col: number, limit = 40): Distinct[] {
  const counts = new Map<string, number>()
  for (const r of t.rows) {
    const c = r[col]
    const v = c === null || c === undefined ? '' : String(c).trim()
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, limit)
}

// ── Build ─────────────────────────────────────────────────────────────────

export interface BuildOptions {
  /** value (as written in the file) -> meaning. Required when `resultado` is mapped. */
  outcomes: Record<string, Outcome>
  /** Without a result column every row is a failure and the day's total dispatches come from here. */
  volumePerDay?: number
}

export interface Report {
  rows: number
  used: number
  failed: number
  delivered: number
  ignored: number
  discarded: Record<string, number>
  /** Place names that could not be matched, most frequent first. */
  unknownPlaces: string[]
  days: number
  /** What the file did not carry and so is drawn from the assumptions. */
  filled: string[]
  warnings: string[]
}

export const MIN_FAILURES = 10
export const MAX_FAILURES = 20000

const keyOf = (v: Cell) => (v === null || v === undefined ? '' : String(v).trim())

export function buildDataset(t: Table, m: Mapping, o: BuildOptions, id = `ds${Date.now()}`): { dataset: Dataset | null; report: Report } {
  const report: Report = { rows: t.rows.length, used: 0, failed: 0, delivered: 0, ignored: 0, discarded: {}, unknownPlaces: [], days: 0, filled: [], warnings: [] }
  const drop = (why: string) => { report.discarded[why] = (report.discarded[why] ?? 0) + 1 }
  const hasCoords = m.lat !== undefined && m.lon !== undefined
  const hasPlace = m.municipio !== undefined
  const unknown = new Map<string, number>()

  interface DayAcc { delivered: number; failures: DataFailure[] }
  const days = new Map<string, DayAcc>()

  t.rows.forEach((row, n) => {
    let failed = true
    if (m.resultado !== undefined) {
      const out = o.outcomes[keyOf(row[m.resultado])] ?? 'ignore'
      if (out === 'ignore') { report.ignored++; return }
      failed = out === 'failed'
    }
    const hora = m.hora !== undefined ? parseMoment(row[m.hora]) : { hour: null, date: null }
    const fecha = m.fecha !== undefined ? parseMoment(row[m.fecha]) : { hour: null, date: null }
    const date = fecha.date ?? hora.date ?? 'todo'
    const day = days.get(date) ?? { delivered: 0, failures: [] }
    days.set(date, day)
    if (!failed) { day.delivered++; report.delivered++; return }

    let lat: number | null = null, lon: number | null = null, muni: string | null = null
    if (hasCoords) {
      lat = parseCoord(row[m.lat!]); lon = parseCoord(row[m.lon!])
      if (lat !== null && lon !== null && !(inRange(lat, LAT[0], LAT[1]) && inRange(lon, LON[0], LON[1]))) {
        // Swapped columns in this row are not guessed at: a point outside the valley is not simulated.
        if (!hasPlace) { drop('Coordenadas fuera del Valle de Aburrá'); return }
        lat = lon = null
      }
    }
    if (lat === null || lon === null) {
      lat = lon = null
      if (hasPlace) {
        const place = matchMunicipality(row[m.municipio!])
        if (!place) {
          const name = keyOf(row[m.municipio!])
          unknown.set(name, (unknown.get(name) ?? 0) + 1)
          drop(name ? 'Municipio fuera del Valle de Aburrá o no reconocido' : 'Sin ubicación'); return
        }
        // Without coordinates the package lands around the municipality's centre, as in the synthetic days.
        const r = mulberry32(n * 7919 + 17)
        const g = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
        lat = place.lat + (g() * place.sigmaKm) / 111.2
        lon = place.lon + (g() * place.sigmaKm) / (111.2 * Math.cos((place.lat * Math.PI) / 180))
        muni = place.name
      } else { drop('Sin ubicación'); return }
    }
    const cell = nearestCell(lat, lon)
    day.failures.push({
      lat, lon, cell, municipality: muni ?? nearestMunicipality(lat, lon),
      hour: hora.hour,
      cod: m.cod !== undefined ? (() => { const c = parseMoney(row[m.cod!]); return c !== null && c > 0 ? c : null })() : null,
      grade: m.grado !== undefined ? parseGrade(row[m.grado]) : null,
    })
    report.failed++
  })

  const entries = [...days].filter(([, d]) => d.delivered + d.failures.length > 0).sort(([a], [b]) => a.localeCompare(b))
  const out: DataDay[] = []
  for (const [date, d] of entries) {
    const count = d.failures.length
    const volume = m.resultado !== undefined ? d.delivered + count : Math.max(o.volumePerDay ?? 0, count)
    if (count === 0 && m.resultado === undefined) continue
    out.push({ label: date === 'todo' ? 'Todos los registros' : date, volume, failures: d.failures })
  }
  report.days = out.length
  report.used = report.failed + report.delivered
  report.unknownPlaces = [...unknown].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k).filter(Boolean)

  if (m.cod === undefined) report.filled.push('el valor a cobrar')
  if (m.hora === undefined) report.filled.push('la hora')
  if (m.grado === undefined) report.filled.push('el grado A/B/C')
  const failedTotal = out.reduce((s, d) => s + d.failures.length, 0)
  if (failedTotal < MIN_FAILURES) { report.warnings.push(`Solo hay ${failedTotal} paquetes fallidos con ubicación válida. Hacen falta al menos ${MIN_FAILURES}.`); return { dataset: null, report } }
  if (failedTotal > MAX_FAILURES) { report.warnings.push(`Hay ${failedTotal} fallidos y el máximo es ${MAX_FAILURES}. Filtra el archivo a menos días.`); return { dataset: null, report } }
  if (out.length > 62) report.warnings.push(`El archivo cubre ${out.length} días; el análisis promedia 8 de ellos, repartidos a lo largo del archivo.`)
  if (out.length === 1) report.warnings.push('Con un solo día, "según fallos de días previos" ve el mismo día que se simula, así que da un resultado optimista.')
  const small = out.filter((d) => d.volume < 100).length
  if (m.fecha !== undefined && small > out.length / 2) report.warnings.push('Muchos días tienen menos de 100 despachos. ¿La columna de fecha es la correcta?')
  return { dataset: { id, days: out }, report }
}
