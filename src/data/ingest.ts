import places from './places.json'
import { locateCell, nearestMunicipality, type Grade, type PoolIncident, type RealData } from '../sim/simulate'

export type Field = 'lat' | 'lon' | 'coords' | 'address' | 'municipality' | 'date' | 'time' | 'cod' | 'reason' | 'retry' | 'courier'
export type Mapping = Partial<Record<Field, string>>
export type Row = Record<string, string>

export const FIELD_LABELS: Record<Field, string> = {
  lat: 'Latitud',
  lon: 'Longitud',
  coords: 'Coordenadas en una sola columna',
  address: 'Dirección escrita',
  municipality: 'Municipio o ciudad',
  date: 'Fecha',
  time: 'Hora del intento fallido',
  cod: 'Valor del pedido (COD)',
  reason: 'Motivo de la novedad',
  retry: '¿Se entregó en el reintento?',
  courier: 'Mensajero o moto',
}

export const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const ALIASES: Record<Field, string[]> = {
  lat: ['lat', 'latitud', 'latitude'],
  lon: ['lon', 'lng', 'long', 'longitud', 'longitude'],
  coords: ['coordenadas', 'coords', 'coordinates', 'gps', 'latlon', 'lat lon', 'lat lng', 'ubicacion gps'],
  address: ['direccion', 'direccion entrega', 'direccion de entrega', 'dir', 'address', 'domicilio', 'destino'],
  municipality: ['municipio', 'ciudad', 'city', 'localidad', 'municipality'],
  date: ['fecha', 'fecha novedad', 'fecha entrega', 'date', 'dia', 'fecha hora', 'timestamp', 'datetime'],
  time: ['hora', 'hora novedad', 'hora intento', 'time', 'horario', 'fecha hora', 'timestamp', 'datetime'],
  cod: ['valor cod', 'cod', 'valor', 'monto', 'recaudo', 'valor a cobrar', 'precio', 'amount', 'value'],
  reason: ['motivo', 'causal', 'novedad', 'tipo novedad', 'razon', 'reason', 'observacion'],
  retry: ['reintento', 'segundo intento', 'resultado reintento', 'entregado reintento', 'reentrega', 'retry', 'recuperado'],
  courier: ['mensajero', 'courier', 'motorizado', 'repartidor', 'conductor', 'placa', 'driver'],
}
const PRIORITY: Field[] = ['lat', 'lon', 'coords', 'address', 'municipality', 'time', 'date', 'cod', 'reason', 'retry', 'courier']

/** Guesses which column holds each field from the header names. Columns can be reassigned by hand afterwards. */
export function detectMapping(headers: string[]): Mapping {
  const norm = headers.map(normalize)
  const mapping: Mapping = {}
  const used = new Set<number>()
  const wordIn = (h: string, alias: string) => ` ${h} `.includes(` ${alias} `)
  for (const field of PRIORITY) {
    for (const exact of [true, false]) {
      const i = norm.findIndex((h, k) => (field === 'date' || field === 'time' ? true : !used.has(k)) && ALIASES[field].some((al) => (exact ? h === al : wordIn(h, al))))
      if (i >= 0) { mapping[field] = headers[i]; if (field !== 'date' && field !== 'time') used.add(i); break }
    }
  }
  // A coordinates column makes separate lat/lon redundant, but never the other way around.
  if (mapping.lat && mapping.lon && mapping.coords) delete mapping.coords
  return mapping
}

/** Money: handles "$ 120.000", "120,000", "1.234,56", "85000". */
export function parseMoney(s: string | undefined): number | null {
  if (!s) return null
  let t = s.replace(/[^\d.,-]/g, '')
  if (!t) return null
  const dots = (t.match(/\./g) ?? []).length
  const commas = (t.match(/,/g) ?? []).length
  if (dots && commas) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  else if (commas) t = commas > 1 || /,\d{3}$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.')
  else if (dots) t = dots > 1 || /\.\d{3}$/.test(t) ? t.replace(/\./g, '') : t
  const v = Number(t)
  return Number.isFinite(v) && v > 0 ? v : null
}

const coordNumber = (s: string) => {
  const v = Number(s.trim().replace(',', '.'))
  return s.trim() && Number.isFinite(v) ? v : null
}

/** A latitude and longitude, fixing an inverted pair. Colombia sits at about 4-12 N and 67-79 W. */
export function parseLatLon(latText: string | undefined, lonText: string | undefined): { lat: number; lon: number } | null {
  if (latText === undefined || lonText === undefined) return null
  let lat = coordNumber(latText)
  let lon = coordNumber(lonText)
  if (lat === null || lon === null) return null
  if (Math.abs(lat) > 20 && Math.abs(lon) <= 20) [lat, lon] = [lon, lat]
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null
  return { lat, lon }
}

/** "6.2442, -75.5812", "6.2442 -75.5812" or "6,2442; -75,5812". */
export function parseCombinedCoords(text: string | undefined): { lat: number; lon: number } | null {
  if (!text) return null
  const t = text.trim().replace(/[()[\]]/g, '')
  const parts = t.includes(';') ? t.split(';') : t.split(/[\s,]+/).filter(Boolean)
  return parts.length === 2 ? parseLatLon(parts[0], parts[1]) : null
}

/** Hour of day as a decimal (14:30 -> 14.5) from "14:30", "2:30 PM" or "2026-03-10 14:32:00". */
export function parseHour(text: string | undefined): number | null {
  if (!text) return null
  const m = text.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?m?\.?/i)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2])
  if (m[3]) { const pm = m[3].toLowerCase() === 'p'; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0 }
  return h <= 23 && min <= 59 ? h + min / 60 : null
}

/** ISO date from "2026-03-10", "2026/03/10" or, day first as is usual in Colombia, "10/03/2026". */
export function parseDate(text: string | undefined): string | null {
  if (!text) return null
  const ymd = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  const dmy = text.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
  const [y, mo, d] = ymd ? [+ymd[1], +ymd[2], +ymd[3]] : dmy ? [+dmy[3], +dmy[2], +dmy[1]] : [0, 0, 0]
  const real = y > 0 && new Date(Date.UTC(y, mo - 1, d))
  return real && real.getUTCFullYear() === y && real.getUTCMonth() === mo - 1 && real.getUTCDate() === d ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null
}

export function parseBool(text: string | undefined): boolean | null {
  if (!text) return null
  const t = normalize(text)
  if (['si', 's', '1', 'true', 'yes', 'y', 'entregado', 'entregada', 'exitoso', 'exito', 'ok', 'recuperado'].includes(t)) return true
  if (['no', 'n', '0', 'false', 'fallido', 'fallo', 'devuelto', 'devuelta', 'rechazado', 'no entregado', 'cancelado'].includes(t)) return false
  return null
}

const GRADE_WORDS: [Grade, string[]][] = [
  ['C', ['averi', 'dano', 'roto', 'defect', 'equivoc', 'cambiazo', 'fraude', 'robo', 'perdid', 'extravi', 'mal estado', 'no corresponde', 'falsific']],
  ['B', ['rechaz', 'no quiere', 'no lo quiere', 'arrepent', 'cambio de opinion', 'desiste', 'sin dinero', 'no tiene dinero', 'no tiene plata', 'sin efectivo', 'precio', 'no pidio', 'no lo pidio', 'no solicito', 'cancel']],
  ['A', ['ausent', 'no contesta', 'no responde', 'no estaba', 'nadie', 'cerrado', 'direccion', 'no ubicad', 'no encontr', 'reprogram', 'otro dia', 'fuera de zona', 'telefono', 'no atiende', 'no hay quien']],
]

/** A first guess of the triage grade from the reason text. Null when no keyword matches. */
export function classifyReason(text: string | undefined): Grade | null {
  if (!text) return null
  const t = normalize(text)
  for (const [grade, words] of GRADE_WORDS) if (words.some((w) => t.includes(w))) return grade
  return null
}

const ABBREVIATIONS: [RegExp, string][] = [
  [/\b(cra|cr|kr|carr|k)\.?(?=\s*\d)/gi, 'Carrera'],
  [/\b(cl|cll|cale)\.?(?=\s*\d)/gi, 'Calle'],
  [/\b(av|avda|avd)\.?\s/gi, 'Avenida '],
  [/\b(dg|diag)\.?(?=\s*\d)/gi, 'Diagonal'],
  [/\b(tv|trans|transv)\.?(?=\s*\d)/gi, 'Transversal'],
  [/\b(cir|circ)\.?(?=\s*\d)/gi, 'Circular'],
]
const UNIT_TAIL = /[\s,]+(apto|apartamento|apt|int|interior|casa|torre|bloque|bl|of|oficina|local|piso|etapa|manzana|mz|bodega|conjunto|cj|urbanizacion|edificio|ed)\b.*$/i

/** Cleans a Colombian address and returns up to two search texts: the full one, then the street alone. */
export function addressQueries(address: string, municipality?: string | null): string[] {
  let t = address.trim().replace(/\s+/g, ' ')
  for (const [re, word] of ABBREVIATIONS) t = t.replace(re, word)
  t = t.replace(UNIT_TAIL, '').replace(/\s*(#|no\.?|nro\.?|n°)\s*/gi, ' ').replace(/\s+/g, ' ').trim()
  const where = municipality ? `, ${municipality}` : ''
  const out = [`${t}${where}`]
  const street = t.match(/^(Calle|Carrera|Avenida|Diagonal|Transversal|Circular|Autopista)\s+\d+[A-Za-z]?(\s+(Sur|Norte|Este|Oeste))?/i)
  if (street && street[0].length < t.length) out.push(`${street[0]}${where}`)
  return out
}

/** The municipality of places.json that a free-text name refers to, ignoring accents and case. */
export function matchMunicipality(text: string | undefined): string | null {
  if (!text) return null
  const t = normalize(text)
  const hit = places.municipalities.find((m) => normalize(m.name) === t || ` ${t} `.includes(` ${normalize(m.name)} `))
  return hit ? hit.name : null
}

export type Quality = 'coordinates' | 'house' | 'street' | 'neighbourhood' | 'municipality'

export const QUALITY_LABEL: Record<Quality, string> = {
  coordinates: 'Coordenadas del archivo',
  house: 'Dirección ubicada con número',
  street: 'Calle ubicada, sin número exacto',
  neighbourhood: 'Barrio o zona',
  municipality: 'Solo el municipio',
}

/** What a row needs in order to be placed on the map. */
export type Locator =
  | { kind: 'point'; lat: number; lon: number }
  | { kind: 'address'; queries: string[]; municipality: string | null }
  | { kind: 'municipality'; municipality: string }
  | { kind: 'none' }

export interface Prepared {
  locator: Locator
  date: string | null
  hour: number | null
  cod: number | null
  reason: string
  grade: Grade | null
  retry: boolean | null
  courier: string | null
}

export function reasonOf(row: Row, mapping: Mapping) {
  return (mapping.reason ? row[mapping.reason] ?? '' : '').trim()
}

/** Reads every row according to the column mapping. Which rows need a geocoder is decided here. */
export function prepareRows(rows: Row[], mapping: Mapping, gradeOfReason: Record<string, Grade>, defaultGrade: Grade): Prepared[] {
  const get = (row: Row, f: Field) => (mapping[f] ? row[mapping[f]!] : undefined)
  return rows.map((row) => {
    const muni = matchMunicipality(get(row, 'municipality'))
    const point = parseLatLon(get(row, 'lat'), get(row, 'lon')) ?? parseCombinedCoords(get(row, 'coords')) ?? (mapping.coords ? null : parseCombinedCoords(get(row, 'address')))
    const address = (get(row, 'address') ?? '').trim()
    const locator: Locator = point
      ? { kind: 'point', ...point }
      : address && !parseCombinedCoords(address)
        ? { kind: 'address', queries: addressQueries(address, get(row, 'municipality')?.trim() || null), municipality: muni }
        : muni
          ? { kind: 'municipality', municipality: muni }
          : { kind: 'none' }
    const reason = reasonOf(row, mapping)
    const timeText = get(row, 'time')
    return {
      locator,
      date: parseDate(get(row, 'date')),
      hour: parseHour(timeText),
      cod: parseMoney(get(row, 'cod')),
      reason,
      grade: mapping.reason ? gradeOfReason[reason] ?? defaultGrade : defaultGrade,
      retry: parseBool(get(row, 'retry')),
      courier: (get(row, 'courier') ?? '').trim() || null,
    }
  })
}

export interface GeoPoint { lat: number; lon: number; quality: Exclude<Quality, 'coordinates' | 'municipality'> }

export interface Report {
  rows: number
  used: number
  excluded: { noLocation: number; outsideValley: number }
  quality: Record<Quality, number>
  days: number
  datesFound: boolean
  hoursFound: number
  codFound: number
  gradeShare: Record<Grade, number>
  reasonsClassified: number
  couriers: number | null
  retry: { A: { n: number; rate: number | null }; B: { n: number; rate: number | null } }
  codMean: number | null
  municipalityShare: { name: string; share: number }[]
}

const muniByName = (name: string) => places.municipalities.find((m) => m.name === name)!

/**
 * Turns the prepared rows and the geocoder's answers into the pool the simulator draws from. A row that could not be
 * placed precisely falls back to its municipality (spread over it like the synthetic data) and is counted as such.
 */
export function buildData(
  fileName: string,
  prepared: Prepared[],
  geo: (GeoPoint | null)[],
  opts: { daysOverride: number | null; defaultGrade: Grade },
): { data: RealData; report: Report } {
  const incidents: PoolIncident[] = []
  const quality: Record<Quality, number> = { coordinates: 0, house: 0, street: 0, neighbourhood: 0, municipality: 0 }
  const excluded = { noLocation: 0, outsideValley: 0 }
  const dates = new Set<string>()
  const couriers = new Set<string>()
  const retryTally = { A: { n: 0, ok: 0 }, B: { n: 0, ok: 0 } }
  let hoursFound = 0
  let codFound = 0
  let codSum = 0

  prepared.forEach((row, i) => {
    let lat: number | null = null
    let lon: number | null = null
    let q: Quality | null = null
    let sigmaKm = 0
    let municipality: string | null = null
    const loc = row.locator
    if (loc.kind === 'point') { lat = loc.lat; lon = loc.lon; q = 'coordinates' }
    else if (loc.kind === 'address' && geo[i]) { lat = geo[i]!.lat; lon = geo[i]!.lon; q = geo[i]!.quality }
    const fallback = loc.kind === 'municipality' ? loc.municipality : loc.kind === 'address' ? loc.municipality : null
    if (lat === null && fallback) {
      const m = muniByName(fallback)
      lat = m.lat; lon = m.lon; q = 'municipality'; sigmaKm = m.sigmaKm; municipality = m.name
    }
    if (lat === null || lon === null || q === null) { excluded.noLocation++; return }
    const cell = locateCell(lat, lon)
    if (cell === null) { excluded.outsideValley++; return }
    municipality = municipality ?? nearestMunicipality(lat, lon)
    quality[q]++
    incidents.push({ lat, lon, cell, sigmaKm, hour: row.hour, cod: row.cod, grade: row.grade ?? opts.defaultGrade, municipality })
    if (row.date) dates.add(row.date)
    if (row.courier) couriers.add(row.courier)
    if (row.hour !== null) hoursFound++
    if (row.cod !== null) { codFound++; codSum += row.cod }
    const g = row.grade ?? opts.defaultGrade
    if (row.retry !== null && (g === 'A' || g === 'B')) { retryTally[g].n++; if (row.retry) retryTally[g].ok++ }
  })

  const total = incidents.length || 1
  const gradeShare = { A: 0, B: 0, C: 0 }
  incidents.forEach((x) => { gradeShare[x.grade] += 1 / total })
  const counts = places.municipalities.map((m) => incidents.filter((x) => x.municipality === m.name).length)
  const days = opts.daysOverride ?? (dates.size || 1)
  const rate = (t: { n: number; ok: number }) => (t.n ? t.ok / t.n : null)
  const report: Report = {
    rows: prepared.length,
    used: incidents.length,
    excluded,
    quality,
    days,
    datesFound: dates.size > 0,
    hoursFound,
    codFound,
    gradeShare,
    reasonsClassified: prepared.filter((r) => r.reason && r.grade !== null).length,
    couriers: couriers.size || null,
    retry: { A: { n: retryTally.A.n, rate: rate(retryTally.A) }, B: { n: retryTally.B.n, rate: rate(retryTally.B) } },
    codMean: codFound ? codSum / codFound : null,
    municipalityShare: places.municipalities.map((m, k) => ({ name: m.name, share: counts[k] / total })).filter((x) => x.share > 0).sort((a, b) => b.share - a.share),
  }
  const data: RealData = { id: `${fileName}:${incidents.length}:${Math.round(codSum)}:${hoursFound}`, incidents, municipalityWeights: counts.map((c) => c + 1e-9) }
  return { data, report }
}

export interface Suggestion {
  failuresPerDay: number
  failureRate: number | null
  secondAttemptSuccess: number | null
  gradeBSuccess: number | null
  fleet: number | null
  warnings: string[]
}

const MIN_RETRY_SAMPLE = 15

/** What the file says about the simulator's parameters. Dispatches per day is not in a list of failures, so it is asked for. */
export function suggest(report: Report, dispatchesPerDay: number | null): Suggestion {
  const failuresPerDay = report.used / report.days
  const warnings: string[] = []
  if (report.used < 100) warnings.push(`Solo ${report.used} fallos ubicados: la distribución espacial es poco confiable.`)
  if (report.days < 10) warnings.push(`El archivo cubre ${report.days} día${report.days === 1 ? '' : 's'}: con tan pocos días las vans se ajustan a esa muestra y el resultado se ve mejor de lo que sería.`)
  if (report.quality.municipality / Math.max(1, report.used) > 0.3) warnings.push('Más de 30% de los fallos solo se ubicó por municipio: los resultados por ubicación son aproximados.')
  if (report.hoursFound < report.used * 0.5) warnings.push('Faltan horas en más de la mitad de las filas: se completan al azar entre las 8:00 y las 16:30, y la hora decide si el reintento funciona.')
  if (report.codFound < report.used * 0.5) warnings.push('Faltan valores de pedido en más de la mitad de las filas: se completan con el rango por defecto.')
  const okRate = (t: { n: number; rate: number | null }) => (t.n >= MIN_RETRY_SAMPLE ? t.rate : null)
  return {
    failuresPerDay,
    failureRate: dispatchesPerDay ? failuresPerDay / dispatchesPerDay : null,
    secondAttemptSuccess: okRate(report.retry.A),
    gradeBSuccess: okRate(report.retry.B),
    fleet: report.couriers,
    warnings,
  }
}
