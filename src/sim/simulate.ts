import places from '../data/places.json'
import travel from '../data/travel.json'
import cellMinutes from '../data/cell-minutes.json'

export type Grade = 'A' | 'B' | 'C'
export type CediId = 'sur' | 'centro' | 'gir'
/**
 * zones: fixed anchors (Norte, Centro, Sur).
 * history: where failures landed on 10 previous simulated days.
 * hindsight: the failures of the day itself. Not achievable, kept as a ceiling.
 */
export type Placement = 'zones' | 'history' | 'hindsight'
/**
 * reach: each van goes where it covers the most value not yet covered by another (maximum coverage).
 * value: each van goes where it adds the most net pesos, given van capacity and the courier's detour.
 * density: vans go where failures concentrate, minimising the total road time to them (p-median).
 */
export type Objective = 'reach' | 'value' | 'density'
/**
 * intercept: a van sits on a cell and takes the failures that happen within reach during the day.
 * rounds: the van visits every courier of its group once in the morning and once in the afternoon and picks up
 * what failed; at closing the couriers go to the van instead of going back to the CEDI.
 */
export type Mode = 'intercept' | 'rounds'

export interface Params {
  cedi: CediId
  volume: number
  fleet: number
  failureRate: number // 0..1
  vans: 0 | 1 | 2 | 3
  maxMinutes: number // max road time van -> package
  secondAttemptSuccess: number // Grade A, 0..1
  /** A van must sit at least this many road minutes from the CEDI: next to it, it intercepts nothing the CEDI would not receive anyway. */
  minCediMinutes: number
  /** Share of the product margin that is really lost when a failed package goes back to the CEDI (it can be offered again). */
  marginLossShare: number
  /** Courier time and fuel spent going to the van and back, per road minute. */
  detourCopPerMin: number
  placement: Placement
  objective: Objective
  mode: Mode
  /** Rounds mode: the van visits only couriers that have a failure waiting, instead of every courier every round. */
  skipEmptyVisits: boolean
  seed: number
  /** Uploaded operation. When present the failures come from it and `seed` picks the day (modulo the number of days). */
  data?: Dataset
}

/** A failed package from an uploaded file. Fields the file did not carry are null and get a seeded default. */
export interface DataFailure {
  lat: number
  lon: number
  cell: number
  municipality: string
  hour: number | null
  cod: number | null
  grade: Grade | null
}

export interface DataDay {
  label: string
  /** Packages dispatched that day, delivered or not. */
  volume: number
  failures: DataFailure[]
}

export interface Dataset {
  /** Distinguishes datasets in the caches. */
  id: string
  days: DataDay[]
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
  /** Rounds mode: hours in which the van does its morning and afternoon visits. */
  amWindow: readonly [number, number]
  pmWindow: readonly [number, number]
  /** Minutes the van spends with each courier on a visit (handing packages over, paperwork). */
  handoffMinutes: number
  /** A second attempt works at full odds if the package reaches the van before this hour and has no chance from the later hour; in between it falls linearly. */
  attemptFullUntil: number
  attemptNoneFrom: number
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
  amWindow: [9, 12],
  pmWindow: [13, 16],
  handoffMinutes: 6,
  attemptFullUntil: 12,
  attemptNoneFrom: 17,
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
  /** Couriers' detours to reach the vans, for every package handed to one. */
  detourCost: number
  /** Rounds mode: pesos of courier time saved by dropping at the van instead of going back to the CEDI. */
  tripSaving: number
  /** recovered + tripSaving - vanCost - detourCost */
  net: number
  deadWeightTraditional: number
  deadWeightWithVans: number
  vans: VanPlacement[]
  /** Rounds mode: where the couriers work and how many scheduled visits the vans could make. */
  couriers: { lat: number; lon: number }[]
  visits: { done: number; skipped: number }
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

/** The failures of one uploaded day. Missing hour, value or grade are drawn from a generator seeded by day and row. */
function incidentsFromData(p: Params, a: Assumptions, data: Dataset, day: number): Incident[] {
  const cediIdx = travel.origins.indexOf(`cedi:${p.cedi}`)
  return data.days[day].failures.map((f, i) => {
    const r = mulberry32(day * 100003 + i + 1)
    const hour0 = r(), cod0 = r(), grade0 = r(), roll = r()
    const hour = f.hour ?? a.hours[0] + hour0 * (a.hours[1] - a.hours[0])
    const cod = f.cod ?? a.codRange[0] + cod0 * (a.codRange[1] - a.codRange[0])
    const grade: Grade = f.grade ?? (grade0 < a.gradeShare.A ? 'A' : grade0 < a.gradeShare.A + a.gradeShare.B ? 'B' : 'C')
    return {
      lat: CELLS[f.cell].lat, lon: CELLS[f.cell].lon, cell: f.cell, hour, cod, grade, municipality: f.municipality,
      saved: false, vanIndex: null, cediKm: CELLS[f.cell].km[cediIdx], vanMinutes: null, roll,
    }
  })
}

export function generateIncidents(p: Params, a: Assumptions, seed: number): Incident[] {
  if (p.data) return incidentsFromData(p, a, p.data, Math.abs(Math.trunc(seed)) % p.data.days.length)
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

/** Share of the second-attempt odds left when a package reaches the van at `hour`: the later in the day, the less time to redeliver. */
export function attemptFactor(hour: number, a: Assumptions) {
  return Math.min(1, Math.max(0, (a.attemptNoneFrom - hour) / (a.attemptNoneFrom - a.attemptFullUntil)))
}

/** Expected pesos recovered if this failure is intercepted: the odds the second attempt works times what it recovers. */
function expectedValue(q: Incident, p: Params, a: Assumptions) {
  if (q.grade === 'C') return 0
  const success = q.grade === 'A' ? p.secondAttemptSuccess : a.gradeBSuccess
  const margin = (q.grade === 'A' ? a.marginA : a.marginB) * p.marginLossShare
  return success * attemptFactor(q.hour, a) * (2 * q.cediKm * a.freightCopPerKm + a.handlingCop + q.cod * margin)
}

/**
 * Greedy maximum coverage: each new van goes where it reaches the most not-yet-covered expected value
 * within maxMinutes. Ties go to the cell with the lowest weighted travel time. `allowed` limits the
 * candidate cells and `initial` are vans already placed (returned first).
 */
export function greedyPlacement(count: number, weight: number[], maxMinutes: number, allowed?: boolean[], initial: number[] = []): number[] {
  const chosen = [...initial]
  const covered = new Array<boolean>(N).fill(false)
  for (const c of chosen) for (let j = 0; j < N; j++) if (MINUTES[c][j] <= maxMinutes) covered[j] = true
  while (chosen.length < count) {
    let best = -1
    let bestScore = -Infinity
    for (let c = 0; c < N; c++) {
      if (chosen.includes(c) || (allowed && !allowed[c])) continue
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

/** Cells where a van may sit: far enough from the CEDI. If none qualifies the rule is dropped. */
export function allowedCells(p: Pick<Params, 'cedi' | 'minCediMinutes'>): boolean[] {
  const idx = travel.origins.indexOf(`cedi:${p.cedi}`)
  const ok = CELLS.map((c) => c.min[idx] >= p.minCediMinutes)
  return ok.some(Boolean) ? ok : ok.map(() => true)
}

/** Per cell: expected recovered value of the savable failures (Grade A or B) and how many there are. */
interface Demand { ev: number[]; count: number[]; all: number[] }

const demandFrom = (incidents: Incident[], p: Params, a: Assumptions): Demand => {
  const d: Demand = { ev: new Array<number>(N).fill(0), count: new Array<number>(N).fill(0), all: new Array<number>(N).fill(0) }
  for (const q of incidents) {
    d.all[q.cell] += 1
    if (q.grade === 'C') continue
    d.ev[q.cell] += expectedValue(q, p, a)
    d.count[q.cell] += 1
  }
  return d
}

/**
 * Value placement. A fluid model of the day: each cell's savable failures go to the nearest vans that
 * reach it, richest cells first, up to each van's capacity, and every package pays the courier's detour.
 * Vans are added one at a time wherever that raises the total the most, so a second van lands where the
 * first one runs out of capacity or is far from the demand, not on the thin periphery.
 */
export function valuePlacement(count: number, d: Demand, maxMinutes: number, capacity: number, detourCopPerMin: number, allowed?: boolean[], initial: number[] = []): number[] {
  const cells: number[] = []
  for (let j = 0; j < N; j++) if (d.count[j] > 0) cells.push(j)
  cells.sort((x, y) => d.ev[y] / d.count[y] - d.ev[x] / d.count[x])
  const per = cells.map((j) => d.ev[j] / d.count[j])
  const capLeft = new Float64Array(count)
  const times = new Float64Array(count)
  const idx = new Int32Array(count)

  const total = (vans: number[]) => {
    capLeft.fill(capacity)
    let sum = 0
    for (let n = 0; n < cells.length; n++) {
      const j = cells[n]
      let m = 0
      for (let k = 0; k < vans.length; k++) {
        const t = MINUTES[vans[k]][j]
        if (t > maxMinutes) continue
        let i = m++
        while (i > 0 && times[i - 1] > t) { times[i] = times[i - 1]; idx[i] = idx[i - 1]; i-- }
        times[i] = t; idx[i] = k
      }
      let remaining = d.count[j]
      for (let i = 0; i < m && remaining > 0; i++) {
        const take = Math.min(remaining, capLeft[idx[i]])
        if (take <= 0) continue
        sum += take * (per[n] - 2 * times[i] * detourCopPerMin)
        capLeft[idx[i]] -= take
        remaining -= take
      }
    }
    return sum
  }

  const chosen = [...initial]
  while (chosen.length < count) {
    let best = -1
    let bestValue = -Infinity
    for (let c = 0; c < N; c++) {
      if (chosen.includes(c) || (allowed && !allowed[c])) continue
      const v = total([...chosen, c])
      if (v > bestValue) { bestValue = v; best = c }
    }
    if (best < 0) break
    chosen.push(best)
  }
  return chosen
}

/**
 * Density placement (greedy p-median): each van is added where it cuts the most total road time to the
 * savable failures, counting packages and not pesos. A package no van reaches counts as twice maxMinutes,
 * so coverage still matters, but once the dense core is covered a new van splits it instead of heading for
 * a thin periphery.
 */
export function densityPlacement(count: number, packages: number[], maxMinutes: number, allowed?: boolean[], initial: number[] = []): number[] {
  const unreached = 2 * maxMinutes
  const best = new Float64Array(N).fill(unreached)
  const chosen = [...initial]
  const apply = (c: number) => { for (let j = 0; j < N; j++) if (MINUTES[c][j] <= maxMinutes && MINUTES[c][j] < best[j]) best[j] = MINUTES[c][j] }
  chosen.forEach(apply)
  while (chosen.length < count) {
    let pick = -1
    let pickGain = -Infinity
    for (let c = 0; c < N; c++) {
      if (chosen.includes(c) || (allowed && !allowed[c])) continue
      let gain = 0
      const row = MINUTES[c]
      for (let j = 0; j < N; j++) {
        if (packages[j] === 0 || row[j] > maxMinutes || row[j] >= best[j]) continue
        gain += packages[j] * (best[j] - row[j])
      }
      if (gain > pickGain) { pickGain = gain; pick = c }
    }
    if (pick < 0) break
    chosen.push(pick)
    apply(pick)
  }
  return chosen
}

const trainingCache = new Map<string, Demand>()

/** Demand per cell averaged over previous simulated days (the operation's "history"). */
function trainingDemand(p: Params, a: Assumptions): Demand {
  const key = JSON.stringify([p.cedi, p.volume, p.failureRate, p.secondAttemptSuccess, p.marginLossShare, p.data?.id, a])
  const hit = trainingCache.get(key)
  if (hit) return hit
  const avg: Demand = { ev: new Array<number>(N).fill(0), count: new Array<number>(N).fill(0), all: new Array<number>(N).fill(0) }
  // With uploaded data the history is every uploaded day; with a single day it equals that day.
  const days = p.data ? p.data.days.length : TRAINING_DAYS
  for (let day = 0; day < days; day++) {
    const d = demandFrom(generateIncidents(p, a, p.data ? day : TRAINING_SEED + day), p, a)
    for (let j = 0; j < N; j++) { avg.ev[j] += d.ev[j] / days; avg.count[j] += d.count[j] / days; avg.all[j] += d.all[j] / days }
  }
  if (trainingCache.size > 400) trainingCache.clear()
  trainingCache.set(key, avg)
  return avg
}

const placementCache = new Map<string, number[]>()

function cached(key: string, build: () => number[]) {
  const hit = placementCache.get(key)
  if (hit) return hit
  const cells = build()
  if (placementCache.size > 400) placementCache.clear()
  placementCache.set(key, cells)
  return cells
}

export function vanCells(p: Params, a: Assumptions, incidents: Incident[]): number[] {
  if (p.vans === 0) return []
  const allowed = allowedCells(p)
  const choose = (d: Demand, initial: number[] = []) =>
    p.mode === 'rounds'
      ? densityPlacement(p.vans, d.all, p.maxMinutes, allowed, initial)
      : p.objective === 'value'
      ? valuePlacement(p.vans, d, p.maxMinutes, a.vanCapacity, p.detourCopPerMin, allowed, initial)
      : p.objective === 'density'
        ? densityPlacement(p.vans, d.count, p.maxMinutes, allowed, initial)
        : greedyPlacement(p.vans, d.ev, p.maxMinutes, allowed, initial)
  if (p.placement === 'hindsight') return choose(demandFrom(incidents, p, a))
  const key = (tag: string) => JSON.stringify([tag, p.mode, p.objective, p.cedi, p.minCediMinutes, p.vans, p.volume, p.failureRate, p.data?.id, p.secondAttemptSuccess, p.marginLossShare, p.detourCopPerMin, p.maxMinutes, a])
  if (p.placement === 'zones') {
    const anchors = ZONE_ANCHORS[p.vans]
      .map((id) => places.vanAnchors.find((v) => v.id === id)!)
      .map((an) => nearestCell(an.lat, an.lon))
      .filter((c) => allowed[c])
    // Anchors too close to the CEDI are dropped; the remaining vans go where the history says.
    return cached(key('zones'), () => choose(trainingDemand(p, a), anchors))
  }
  return cached(key('history'), () => choose(trainingDemand(p, a)))
}

export function simulate(p: Params, a: Assumptions = ASSUMPTIONS): Result {
  const incidents = generateIncidents(p, a, p.seed)
  return simulateAt(p, a, incidents, vanCells(p, a, incidents))
}

/** Runs the day with the vans on the given cells. */
export function simulateAt(p: Params, a: Assumptions, incidents: Incident[], cells: number[]): Result {
  if (p.mode === 'rounds') return simulateRounds(p, a, incidents, cells)
  const vans: VanPlacement[] = cells.map((cell, i) => ({
    name: `V${i + 1}`, lat: CELLS[cell].lat, lon: CELLS[cell].lon, cell,
    municipality: nearestMunicipality(CELLS[cell].lat, CELLS[cell].lon), handled: 0,
  }))

  let recovered = 0
  let detourCost = 0
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
    detourCost += 2 * pickMin * p.detourCopPerMin
    const success = (q.grade === 'A' ? p.secondAttemptSuccess : a.gradeBSuccess) * attemptFactor(q.hour + pickMin / 60, a)
    if (q.roll < success) {
      q.saved = true
      const margin = (q.grade === 'A' ? a.marginA : a.marginB) * p.marginLossShare
      recovered += 2 * q.cediKm * a.freightCopPerKm + a.handlingCop + q.cod * margin
    }
  }

  const failed = incidents.length
  const saved = incidents.filter((q) => q.saved).length
  return {
    incidents, failed, saved, returned: failed - saved, recovered,
    vanCost: vans.length * a.vanCostCopPerDay,
    detourCost,
    tripSaving: 0,
    net: recovered - vans.length * a.vanCostCopPerDay - detourCost,
    deadWeightTraditional: failed / p.fleet,
    deadWeightWithVans: (failed - saved) / p.fleet,
    vans,
    couriers: [],
    visits: { done: 0, skipped: 0 },
  }
}

const COURIER_SEED = 424242
const courierCache = new Map<number, { municipality: string; cell: number }[]>()

/** The same couriers every day: spread over the municipalities by share of shipments (largest remainder), each with a home cell. */
function couriersFor(fleet: number) {
  const hit = courierCache.get(fleet)
  if (hit) return hit
  const r = mulberry32(COURIER_SEED)
  const total = places.municipalities.reduce((sum, m) => sum + m.weight, 0)
  const quota = places.municipalities.map((m) => (fleet * m.weight) / total)
  const counts = quota.map(Math.floor)
  let left = fleet - counts.reduce((x, y) => x + y, 0)
  quota.map((q, i) => ({ i, f: q - Math.floor(q) })).sort((x, y) => y.f - x.f).forEach(({ i }) => { if (left-- > 0) counts[i]++ })
  const out: { municipality: string; cell: number }[] = []
  places.municipalities.forEach((m, i) => {
    for (let k = 0; k < counts[i]; k++) {
      const dLat = (gauss(r) * m.sigmaKm * 0.7) / 111.2
      const dLon = (gauss(r) * m.sigmaKm * 0.7) / (111.2 * Math.cos((m.lat * Math.PI) / 180))
      out.push({ municipality: m.name, cell: nearestCell(m.lat + dLat, m.lon + dLon) })
    }
  })
  courierCache.set(fleet, out)
  return out
}

/**
 * Rounds mode. Every courier belongs to the nearest van within reach. Each van visits its couriers (nearest first)
 * once in the morning window and once in the afternoon window; couriers it cannot reach before the window closes
 * wait for the next round. A failure is handed over at the first visit after it happened; later ones go to the
 * van at closing. Packages handed over in a round can get a second attempt the same day, up to the van's capacity.
 * At closing, a courier with failures drops at the van instead of going back to the CEDI and saves the difference.
 */
function simulateRounds(p: Params, a: Assumptions, incidents: Incident[], cells: number[]): Result {
  const vans: VanPlacement[] = cells.map((cell, i) => ({
    name: `V${i + 1}`, lat: CELLS[cell].lat, lon: CELLS[cell].lon, cell,
    municipality: nearestMunicipality(CELLS[cell].lat, CELLS[cell].lon), handled: 0,
  }))
  const couriers = couriersFor(p.fleet)
  const cediIdx = travel.origins.indexOf(`cedi:${p.cedi}`)

  const group = couriers.map((c) => {
    let best = -1
    let bt = Infinity
    vans.forEach((v, k) => { const t = minutesBetween(v.cell, c.cell); if (t <= p.maxMinutes && t < bt) { bt = t; best = k } })
    return best
  })

  const owner = incidents.map((q) => {
    const mine = couriers.map((_, i) => i).filter((i) => couriers[i].municipality === q.municipality)
    const pool = mine.length ? mine : couriers.map((_, i) => i)
    let best = pool[0]
    let bd = Infinity
    for (const i of pool) {
      const d = (CELLS[couriers[i].cell].lat - q.lat) ** 2 + (CELLS[couriers[i].cell].lon - q.lon) ** 2
      if (d < bd) { bd = d; best = i }
    }
    return best
  })

  let done = 0
  let skipped = 0
  const visitTimes = (window: readonly [number, number], since: (number | undefined)[]) => {
    const at = new Array<number | undefined>(couriers.length).fill(undefined)
    const waiting = (i: number) => incidents.some((q, n) => owner[n] === i && q.hour > (since[i] ?? 0) && q.hour <= window[1])
    vans.forEach((v, k) => {
      const pending = couriers.map((_, i) => i).filter((i) => group[i] === k && (!p.skipEmptyVisits || waiting(i)))
      let pos = v.cell
      let t = window[0] * 60
      while (pending.length) {
        let pick = 0
        for (let n = 1; n < pending.length; n++) if (minutesBetween(pos, couriers[pending[n]].cell) < minutesBetween(pos, couriers[pending[pick]].cell)) pick = n
        const i = pending[pick]
        const arrive = t + minutesBetween(pos, couriers[i].cell) + a.handoffMinutes
        if (arrive > window[1] * 60) break
        t = arrive
        at[i] = t / 60
        pos = couriers[i].cell
        pending.splice(pick, 1)
        done++
      }
      skipped += pending.length
    })
    return at
  }
  const am = visitTimes(a.amWindow, [])
  const pm = visitTimes(a.pmWindow, am)

  let recovered = 0
  let atClosing = 0
  const withFailures = new Set<number>()
  const order = incidents.map((_, i) => i).sort((x, y) => incidents[x].hour - incidents[y].hour)
  for (const idx of order) {
    const q = incidents[idx]
    const c = owner[idx]
    withFailures.add(c)
    const k = group[c]
    const handoff = am[c] !== undefined && q.hour <= am[c]! ? am[c]! : pm[c] !== undefined && q.hour <= pm[c]! ? pm[c]! : null
    if (k >= 0) q.vanIndex = k
    if (handoff === null || k < 0) { atClosing++; continue }
    if (q.grade === 'C' || vans[k].handled >= a.vanCapacity) continue
    vans[k].handled++
    const success = (q.grade === 'A' ? p.secondAttemptSuccess : a.gradeBSuccess) * attemptFactor(handoff, a)
    if (q.roll < success) {
      q.saved = true
      const margin = (q.grade === 'A' ? a.marginA : a.marginB) * p.marginLossShare
      recovered += 2 * q.cediKm * a.freightCopPerKm + a.handlingCop + q.cod * margin
    }
  }

  let tripSaving = 0
  withFailures.forEach((c) => {
    if (group[c] < 0) return
    const toCedi = CELLS[couriers[c].cell].min[cediIdx]
    const toVan = minutesBetween(couriers[c].cell, vans[group[c]].cell)
    tripSaving += Math.max(0, toCedi - toVan) * p.detourCopPerMin
  })

  const failed = incidents.length
  const saved = incidents.filter((q) => q.saved).length
  const vanCost = vans.length * a.vanCostCopPerDay
  return {
    incidents, failed, saved, returned: failed - saved, recovered, vanCost, detourCost: 0, tripSaving,
    net: recovered + tripSaving - vanCost,
    deadWeightTraditional: failed / p.fleet,
    deadWeightWithVans: atClosing / p.fleet,
    vans,
    couriers: couriers.map((c) => ({ lat: CELLS[c.cell].lat, lon: CELLS[c.cell].lon })),
    visits: { done, skipped },
  }
}

export const defaultParams: Params = {
  cedi: 'centro', volume: 600, fleet: 24, failureRate: 0.15, vans: 2, maxMinutes: 25,
  secondAttemptSuccess: 0.6, minCediMinutes: 10, marginLossShare: 0.5, detourCopPerMin: 300, placement: 'history', objective: 'value', mode: 'intercept', skipEmptyVisits: false, seed: 7,
}
