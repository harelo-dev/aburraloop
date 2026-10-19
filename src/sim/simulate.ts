import places from '../data/places.json'
import travel from '../data/travel.json'
import cellMinutes from '../data/cell-minutes.json'

export type Grade = 'A' | 'B' | 'C'
export type CediId = 'sur' | 'centro' | 'gir'
/**
 * zones: fixed anchors (Norte, Centro, Sur).
 * concentration: greedy max-coverage over where failures landed on 10 previous simulated days.
 * hindsight: same greedy, but fed the failures of the day itself. Not achievable, kept as a ceiling.
 */
export type Placement = 'zones' | 'concentration' | 'hindsight'

export interface Params {
  cedi: CediId
  volume: number
  fleet: number
  failureRate: number // 0..1
  vans: 0 | 1 | 2 | 3
  maxMinutes: number // max road time van -> package
  secondAttemptSuccess: number // Grade A, 0..1
  placement: Placement
  seed: number
}

export interface Assumptions {
  gradeShare: { A: number; B: number; C: number }
  gradeBSuccess: number
  marginA: number
  marginB: number
  freightCopPerKm: number
  handlingCop: number
  vanCostCopPerDay: number
  vanCapacity: number
  codRange: readonly [number, number]
  hours: readonly [number, number]
}

export const ASSUMPTIONS: Assumptions = {
  gradeShare: { A: 0.45, B: 0.25, C: 0.3 },
  gradeBSuccess: 0.8,
  marginA: 0.28,
  marginB: 0.12,
  freightCopPerKm: 900,
  handlingCop: 4000,
  vanCostCopPerDay: 320_000,
  vanCapacity: 80,
  codRange: [85_000, 150_000],
  hours: [8, 16.5],
}

export interface Incident {
  lat: number
  lon: number
  cell: number
  hour: number
  cod: number
  grade: Grade
  municipality: string
  saved: boolean
  vanIndex: number | null
  cediKm: number
  /** Road minutes from the nearest van, whether or not it was within reach. */
  vanMinutes: number | null
  /** Pre-drawn outcome of the second attempt, so sliders change results monotonically. */
  roll: number
}

export interface VanPlacement {
  name: string
  lat: number
  lon: number
  cell: number
  municipality: string
  handled: number
}

export interface Result {
  incidents: Incident[]
  failed: number
  saved: number
  returned: number
  recovered: number
  vanCost: number
  deadWeightTraditional: number
  deadWeightWithVans: number
  vans: VanPlacement[]
}

const CELLS = travel.cells
const N = CELLS.length
const MINUTES = cellMinutes.minutes
const UNREACHABLE = cellMinutes.unreachable

const ZONE_ANCHORS: Record<number, string[]> = { 0: [], 1: ['centro'], 2: ['norte', 'sur'], 3: ['norte', 'centro', 'sur'] }
const TRAINING_DAYS = 10
const TRAINING_SEED = 5000

const cellByKey = new Map<string, number>()
CELLS.forEach((c, i) => cellByKey.set(`${Math.round(c.lat * 100)},${Math.round(c.lon * 100)}`, i))

/** Road minutes between two cells; unreachable pairs are Infinity. */
export function minutesBetween(from: number, to: number) {
  const m = MINUTES[from][to]
  return m >= UNREACHABLE ? Infinity : m
}

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())

/** Index of the nearest grid cell. Cells sit on a regular 0.01° grid, so the common case is a lookup. */
export function nearestCell(lat: number, lon: number): number {
  const hit = cellByKey.get(`${Math.round(lat * 100)},${Math.round(lon * 100)}`)
  if (hit !== undefined) return hit
  let best = 0
  let bd = Infinity
  const k = Math.cos((lat * Math.PI) / 180)
  for (let i = 0; i < N; i++) {
    const d = (CELLS[i].lat - lat) ** 2 + ((CELLS[i].lon - lon) * k) ** 2
    if (d < bd) { bd = d; best = i }
  }
  return best
}

export function nearestMunicipality(lat: number, lon: number) {
  const k = Math.cos((lat * Math.PI) / 180)
  let best = places.municipalities[0]
  let bd = Infinity
  for (const m of places.municipalities) {
    const d = (m.lat - lat) ** 2 + ((m.lon - lon) * k) ** 2
    if (d < bd) { bd = d; best = m }
  }
  return best.name
}

export function generateIncidents(p: Params, a: Assumptions, seed: number): Incident[] {
  const r = mulberry32(seed)
  const failed = Math.round(p.volume * p.failureRate)
  const totalWeight = places.municipalities.reduce((s, m) => s + m.weight, 0)
  const cediIdx = travel.origins.indexOf(`cedi:${p.cedi}`)
  const out: Incident[] = []
  for (let i = 0; i < failed; i++) {
    let u = r() * totalWeight
    const m = places.municipalities.find((mm) => (u -= mm.weight) < 0) ?? places.municipalities[0]
    const dLat = (gauss(r) * m.sigmaKm) / 111.2
    const dLon = (gauss(r) * m.sigmaKm) / (111.2 * Math.cos((m.lat * Math.PI) / 180))
    const cell = nearestCell(m.lat + dLat, m.lon + dLon)
    const g = r()
    const grade: Grade = g < a.gradeShare.A ? 'A' : g < a.gradeShare.A + a.gradeShare.B ? 'B' : 'C'
    const hour = a.hours[0] + r() * (a.hours[1] - a.hours[0])
    const cod = a.codRange[0] + r() * (a.codRange[1] - a.codRange[0])
    out.push({
      lat: CELLS[cell].lat, lon: CELLS[cell].lon, cell, hour, cod, grade, municipality: m.name,
      saved: false, vanIndex: null, cediKm: CELLS[cell].km[cediIdx], vanMinutes: null, roll: r(),
    })
  }
  return out
}

/** Expected pesos recovered if this failure is intercepted: the odds the second attempt works times what it recovers. */
function expectedValue(q: Incident, p: Params, a: Assumptions) {
  if (q.grade === 'C') return 0
  const success = q.grade === 'A' ? p.secondAttemptSuccess : a.gradeBSuccess
  const margin = q.grade === 'A' ? a.marginA : a.marginB
  return success * (2 * q.cediKm * a.freightCopPerKm + a.handlingCop + q.cod * margin)
}

/**
 * Greedy maximum coverage: each new van goes where it reaches the most not-yet-covered expected value
 * within maxMinutes. Ties go to the cell with the lowest weighted travel time.
 */
export function greedyPlacement(count: number, weight: number[], maxMinutes: number): number[] {
  const chosen: number[] = []
  const covered = new Array<boolean>(N).fill(false)
  for (let k = 0; k < count; k++) {
    let best = -1
    let bestScore = -Infinity
    for (let c = 0; c < N; c++) {
      if (chosen.includes(c)) continue
      let gain = 0
      let time = 0
      const row = MINUTES[c]
      for (let j = 0; j < N; j++) {
        if (weight[j] === 0 || row[j] > maxMinutes) continue
        time += weight[j] * row[j]
        if (!covered[j]) gain += weight[j]
      }
      const score = gain - 1e-6 * time
      if (score > bestScore) { bestScore = score; best = c }
    }
    if (best < 0) break
    chosen.push(best)
    for (let j = 0; j < N; j++) if (MINUTES[best][j] <= maxMinutes) covered[j] = true
  }
  return chosen
}

const weightsFrom = (incidents: Incident[], p: Params, a: Assumptions) => {
  const w = new Array<number>(N).fill(0)
  for (const q of incidents) w[q.cell] += expectedValue(q, p, a)
  return w
}

const trainingCache = new Map<string, number[]>()

function trainingPlacement(p: Params, a: Assumptions): number[] {
  const key = JSON.stringify([p.cedi, p.volume, p.failureRate, p.secondAttemptSuccess, p.maxMinutes, p.vans, a])
  const hit = trainingCache.get(key)
  if (hit) return hit
  const w = new Array<number>(N).fill(0)
  for (let d = 0; d < TRAINING_DAYS; d++) {
    const day = generateIncidents(p, a, TRAINING_SEED + d)
    const dw = weightsFrom(day, p, a)
    for (let j = 0; j < N; j++) w[j] += dw[j] / TRAINING_DAYS
  }
  const cells = greedyPlacement(p.vans, w, p.maxMinutes)
  if (trainingCache.size > 400) trainingCache.clear()
  trainingCache.set(key, cells)
  return cells
}

export function vanCells(p: Params, a: Assumptions, incidents: Incident[]): number[] {
  if (p.vans === 0) return []
  if (p.placement === 'zones') {
    return ZONE_ANCHORS[p.vans].map((id) => {
      const an = places.vanAnchors.find((v) => v.id === id)!
      return nearestCell(an.lat, an.lon)
    })
  }
  if (p.placement === 'hindsight') return greedyPlacement(p.vans, weightsFrom(incidents, p, a), p.maxMinutes)
  return trainingPlacement(p, a)
}

export function simulate(p: Params, a: Assumptions = ASSUMPTIONS): Result {
  const incidents = generateIncidents(p, a, p.seed)
  const cells = vanCells(p, a, incidents)
  const vans: VanPlacement[] = cells.map((cell, i) => ({
    name: `V${i + 1}`, lat: CELLS[cell].lat, lon: CELLS[cell].lon, cell,
    municipality: nearestMunicipality(CELLS[cell].lat, CELLS[cell].lon), handled: 0,
  }))

  let recovered = 0
  const order = incidents.map((_, i) => i).sort((x, y) => incidents[x].hour - incidents[y].hour)
  for (const i of order) {
    const q = incidents[i]
    let nearest = Infinity
    let pick = -1
    let pickMin = Infinity
    vans.forEach((v, k) => {
      const min = minutesBetween(v.cell, q.cell)
      if (min < nearest) nearest = min
      if (min <= p.maxMinutes && v.handled < a.vanCapacity && min < pickMin) { pickMin = min; pick = k }
    })
    q.vanMinutes = Number.isFinite(nearest) ? nearest : null
    if (pick < 0 || q.grade === 'C') continue
    vans[pick].handled++
    q.vanIndex = pick
    const success = q.grade === 'A' ? p.secondAttemptSuccess : a.gradeBSuccess
    if (q.roll < success) {
      q.saved = true
      const margin = q.grade === 'A' ? a.marginA : a.marginB
      recovered += 2 * q.cediKm * a.freightCopPerKm + a.handlingCop + q.cod * margin
    }
  }

  const failed = incidents.length
  const saved = incidents.filter((q) => q.saved).length
  return {
    incidents, failed, saved, returned: failed - saved, recovered,
    vanCost: vans.length * a.vanCostCopPerDay,
    deadWeightTraditional: failed / p.fleet,
    deadWeightWithVans: (failed - saved) / p.fleet,
    vans,
  }
}

export const defaultParams: Params = {
  cedi: 'centro', volume: 600, fleet: 24, failureRate: 0.15, vans: 2, maxMinutes: 25,
  secondAttemptSuccess: 0.6, placement: 'concentration', seed: 7,
}
