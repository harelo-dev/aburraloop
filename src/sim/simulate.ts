import places from '../data/places.json'
import travel from '../data/travel.json'

export type Grade = 'A' | 'B' | 'C'
export type CediId = 'sur' | 'centro' | 'gir'

export interface Params {
  cedi: CediId
  volume: number
  fleet: number
  failureRate: number // 0..1
  vans: 0 | 1 | 2 | 3
  maxMinutes: number // max road time van -> package
  secondAttemptSuccess: number // Grade A, 0..1
  seed: number
}

export interface Incident {
  lat: number
  lon: number
  hour: number
  cod: number
  grade: Grade
  municipality: string
  saved: boolean
  vanIndex: number | null
  cediKm: number
  vanMinutes: number | null
  /** Pre-drawn outcome of the second attempt, so sliders change results monotonically. */
  roll: number
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
  vans: { name: string; lat: number; lon: number; handled: number }[]
}

export const ASSUMPTIONS = {
  gradeShare: { A: 0.45, B: 0.25, C: 0.3 },
  gradeBSuccess: 0.8,
  marginA: 0.28,
  marginB: 0.12,
  freightCopPerKm: 900,
  handlingCop: 4000,
  vanCostCopPerDay: 320_000,
  vanCapacity: 80,
  codRange: [85_000, 150_000] as const,
  hours: [8, 16.5] as const,
}

const VAN_LAYOUT: Record<number, string[]> = { 0: [], 1: ['centro'], 2: ['norte', 'sur'], 3: ['norte', 'centro', 'sur'] }

const originIndex = (key: string) => travel.origins.indexOf(key)

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

/** Nearest grid cell of the precomputed road matrix. */
export function nearestCell(lat: number, lon: number) {
  let best = travel.cells[0]
  let bd = Infinity
  for (const c of travel.cells) {
    const d = (c.lat - lat) ** 2 + ((c.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2
    if (d < bd) { bd = d; best = c }
  }
  return best
}

export function simulate(p: Params): Result {
  const r = mulberry32(p.seed)
  const failed = Math.round(p.volume * p.failureRate)
  const totalWeight = places.municipalities.reduce((s, m) => s + m.weight, 0)
  const cediIdx = originIndex(`cedi:${p.cedi}`)
  const vanSpecs = VAN_LAYOUT[p.vans].map((id) => ({ id, anchor: places.vanAnchors.find((v) => v.id === id)!, idx: originIndex(`van:${id}`), handled: 0 }))

  const incidents: Incident[] = []
  for (let i = 0; i < failed; i++) {
    let u = r() * totalWeight
    const m = places.municipalities.find((mm) => (u -= mm.weight) < 0) ?? places.municipalities[0]
    const dLat = (gauss(r) * m.sigmaKm) / 111.2
    const dLon = (gauss(r) * m.sigmaKm) / (111.2 * Math.cos((m.lat * Math.PI) / 180))
    const cell = nearestCell(m.lat + dLat, m.lon + dLon)
    const g = r()
    const grade: Grade = g < ASSUMPTIONS.gradeShare.A ? 'A' : g < ASSUMPTIONS.gradeShare.A + ASSUMPTIONS.gradeShare.B ? 'B' : 'C'
    const hour = ASSUMPTIONS.hours[0] + r() * (ASSUMPTIONS.hours[1] - ASSUMPTIONS.hours[0])
    const cod = ASSUMPTIONS.codRange[0] + r() * (ASSUMPTIONS.codRange[1] - ASSUMPTIONS.codRange[0])
    const roll = r()
    incidents.push({
      lat: cell.lat, lon: cell.lon, hour, cod, grade, municipality: m.name,
      saved: false, vanIndex: null, cediKm: cell.km[cediIdx], vanMinutes: null, roll,
    })
  }

  let recovered = 0
  const order = incidents.map((_, i) => i).sort((a, b) => incidents[a].hour - incidents[b].hour)
  for (const i of order) {
    const q = incidents[i]
    const cell = nearestCell(q.lat, q.lon)
    let best = -1
    let bestMin = Infinity
    vanSpecs.forEach((v, k) => {
      const min = cell.min[v.idx]
      if (min < bestMin) { bestMin = min; best = k }
    })
    if (best < 0) continue
    q.vanMinutes = bestMin
    const van = vanSpecs[best]
    if (bestMin > p.maxMinutes || q.grade === 'C' || van.handled >= ASSUMPTIONS.vanCapacity) continue
    van.handled++
    q.vanIndex = best
    const success = q.grade === 'A' ? p.secondAttemptSuccess : ASSUMPTIONS.gradeBSuccess
    if (q.roll < success) {
      q.saved = true
      const margin = q.grade === 'A' ? ASSUMPTIONS.marginA : ASSUMPTIONS.marginB
      recovered += 2 * q.cediKm * ASSUMPTIONS.freightCopPerKm + ASSUMPTIONS.handlingCop + q.cod * margin
    }
  }

  const saved = incidents.filter((q) => q.saved).length
  return {
    incidents, failed, saved, returned: failed - saved, recovered,
    vanCost: vanSpecs.length * ASSUMPTIONS.vanCostCopPerDay,
    deadWeightTraditional: failed / p.fleet,
    deadWeightWithVans: (failed - saved) / p.fleet,
    vans: vanSpecs.map((v) => ({ name: v.anchor.name, lat: v.anchor.lat, lon: v.anchor.lon, handled: v.handled })),
  }
}

export const defaultParams: Params = {
  cedi: 'centro', volume: 600, fleet: 24, failureRate: 0.15, vans: 2, maxMinutes: 25, secondAttemptSuccess: 0.6, seed: 7,
}
