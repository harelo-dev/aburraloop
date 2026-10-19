import { ASSUMPTIONS, simulate, type Assumptions, type Objective, type Params, type Placement } from './simulate'

export const ANALYSIS_DAYS = 8

export interface Mean {
  failed: number
  saved: number
  recovered: number
  vanCost: number
  detourCost: number
  net: number
  savedPct: number
}

/** Average over `days` simulated days (seeds seed, seed+1, ...). */
export function meanOver(p: Params, days = ANALYSIS_DAYS, a: Assumptions = ASSUMPTIONS): Mean {
  let failed = 0, saved = 0, recovered = 0, vanCost = 0, detourCost = 0, net = 0
  for (let d = 0; d < days; d++) {
    const r = simulate({ ...p, seed: p.seed + d }, a)
    failed += r.failed; saved += r.saved; recovered += r.recovered; vanCost += r.vanCost; detourCost += r.detourCost; net += r.net
  }
  failed /= days; saved /= days; recovered /= days; vanCost /= days; detourCost /= days; net /= days
  return { failed, saved, recovered, vanCost, detourCost, net, savedPct: failed ? (saved / failed) * 100 : 0 }
}

export function vansCurve(p: Params): Mean[] {
  return ([0, 1, 2, 3] as const).map((vans) => meanOver({ ...p, vans }))
}

export const VOLUME_POINTS = Array.from({ length: 22 }, (_, i) => 150 + i * 50)

export interface VolumePoint { volume: number; failed: number; net: number[] }

/** Net per day against daily dispatches (150 to 1200), one series per van count (1 to 3). */
export function volumeCurve(p: Params): VolumePoint[] {
  return VOLUME_POINTS.map((volume) => ({
    volume,
    failed: volume * p.failureRate,
    net: ([1, 2, 3] as const).map((vans) => meanOver({ ...p, vans, volume }).net),
  }))
}

/** First daily volume where `series` reaches net >= 0, interpolated. null if never, the first volume if already there. */
export function breakEvenVolume(points: VolumePoint[], series: number): number | null {
  for (let i = 0; i < points.length; i++) {
    const n = points[i].net[series]
    if (n >= 0) {
      if (i === 0) return points[0].volume
      const prev = points[i - 1]
      const t = -prev.net[series] / (n - prev.net[series])
      return prev.volume + t * (points[i].volume - prev.volume)
    }
  }
  return null
}

/** Volume from which `series` earns more than the series before it (1 van vs 2, 2 vs 3). null if never in range. */
export function marginalVolume(points: VolumePoint[], series: number): number | null {
  for (let i = 0; i < points.length; i++) {
    if (points[i].net[series] > points[i].net[series - 1]) {
      if (i === 0) return points[0].volume
      const prev = points[i - 1]
      const d0 = prev.net[series] - prev.net[series - 1]
      const d1 = points[i].net[series] - points[i].net[series - 1]
      return prev.volume + (-d0 / (d1 - d0)) * (points[i].volume - prev.volume)
    }
  }
  return null
}

export interface PlacementRow {
  id: 'zones' | 'history-reach' | 'history-value' | 'history-density' | 'hindsight'
  mean: Mean
  sites: string[]
}

/** Fixed zones, history with each objective, and the same-day ceiling for the objective in use. */
export function placementComparison(p: Params): PlacementRow[] {
  const cases: { id: PlacementRow['id']; placement: Placement; objective: Objective }[] = [
    { id: 'zones', placement: 'zones', objective: p.objective },
    { id: 'history-reach', placement: 'history', objective: 'reach' },
    { id: 'history-value', placement: 'history', objective: 'value' },
    { id: 'history-density', placement: 'history', objective: 'density' },
    { id: 'hindsight', placement: 'hindsight', objective: p.objective },
  ]
  return cases.map(({ id, placement, objective }) => {
    const q = { ...p, placement, objective }
    return { id, mean: meanOver(q), sites: simulate(q).vans.map((v) => v.municipality) }
  })
}

export interface Sensitivity {
  label: string
  lowLabel: string
  highLabel: string
  lowDelta: number
  highDelta: number
  swing: number
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const cop = (v: number) => `$${Math.round(v / 1000)} k`

/** Each assumption moved down and up with everything else fixed. Deltas are net pesos per day against the base case. */
export function sensitivity(p: Params): { base: number; rows: Sensitivity[] } {
  const base = meanOver(p).net
  const A = ASSUMPTIONS
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  type Case = { label: string; low: [string, Params, Assumptions]; high: [string, Params, Assumptions] }
  const withA = (patch: Partial<Assumptions>): Assumptions => ({ ...A, ...patch })
  const cases: Case[] = []

  const p2lo = clamp(p.secondAttemptSuccess - 0.2, 0.1, 0.95), p2hi = clamp(p.secondAttemptSuccess + 0.2, 0.1, 0.95)
  cases.push({ label: 'Éxito del 2.º intento (Grado A)', low: [pct(p2lo), { ...p, secondAttemptSuccess: p2lo }, A], high: [pct(p2hi), { ...p, secondAttemptSuccess: p2hi }, A] })

  const rlo = clamp(p.failureRate - 0.05, 0.02, 0.4), rhi = clamp(p.failureRate + 0.05, 0.02, 0.4)
  cases.push({ label: 'Tasa de novedad', low: [pct(rlo), { ...p, failureRate: rlo }, A], high: [pct(rhi), { ...p, failureRate: rhi }, A] })

  const mlo = Math.max(5, p.maxMinutes - 10), mhi = p.maxMinutes + 10
  cases.push({ label: 'Tiempo máx. van → paquete', low: [`${mlo} min`, { ...p, maxMinutes: mlo }, A], high: [`${mhi} min`, { ...p, maxMinutes: mhi }, A] })

  const shareA = (v: number) => withA({ gradeShare: { A: v, B: A.gradeShare.B, C: 1 - v - A.gradeShare.B } })
  cases.push({ label: 'Proporción de paquetes Grado A', low: ['35%', p, shareA(0.35)], high: ['55%', p, shareA(0.55)] })

  cases.push({ label: 'Éxito Grado B (liquidación flash)', low: ['65%', p, withA({ gradeBSuccess: 0.65 })], high: ['95%', p, withA({ gradeBSuccess: 0.95 })] })
  cases.push({ label: 'Margen del producto (Grado A)', low: ['20%', p, withA({ marginA: 0.2 })], high: ['36%', p, withA({ marginA: 0.36 })] })
  cases.push({ label: 'Costo de una van por día', low: [cop(A.vanCostCopPerDay * 0.75), p, withA({ vanCostCopPerDay: A.vanCostCopPerDay * 0.75 })], high: [cop(A.vanCostCopPerDay * 1.25), p, withA({ vanCostCopPerDay: A.vanCostCopPerDay * 1.25 })] })
  cases.push({ label: 'Costo del flete por km', low: [`$${A.freightCopPerKm * 2 / 3}`, p, withA({ freightCopPerKm: A.freightCopPerKm * 2 / 3 })], high: [`$${A.freightCopPerKm * 4 / 3}`, p, withA({ freightCopPerKm: A.freightCopPerKm * 4 / 3 })] })
  const mlsLo = clamp(p.marginLossShare - 0.25, 0.1, 1), mlsHi = clamp(p.marginLossShare + 0.25, 0.1, 1)
  cases.push({ label: 'Margen que se pierde si vuelve al CEDI', low: [pct(mlsLo), { ...p, marginLossShare: mlsLo }, A], high: [pct(mlsHi), { ...p, marginLossShare: mlsHi }, A] })
  cases.push({ label: 'Costo del desvío de la moto por minuto', low: ['$150', { ...p, detourCopPerMin: 150 }, A], high: ['$450', { ...p, detourCopPerMin: 450 }, A] })
  cases.push({ label: 'Capacidad de la van', low: ['40 pq', p, withA({ vanCapacity: 40 })], high: ['120 pq', p, withA({ vanCapacity: 120 })] })
  const codScale = (s: number) => withA({ codRange: [A.codRange[0] * s, A.codRange[1] * s] })
  cases.push({ label: 'Valor COD de los paquetes', low: ['−20%', p, codScale(0.8)], high: ['+20%', p, codScale(1.2)] })

  const rows = cases.map((c) => {
    const lowDelta = meanOver(c.low[1], ANALYSIS_DAYS, c.low[2]).net - base
    const highDelta = meanOver(c.high[1], ANALYSIS_DAYS, c.high[2]).net - base
    return { label: c.label, lowLabel: c.low[0], highLabel: c.high[0], lowDelta, highDelta, swing: Math.abs(highDelta - lowDelta) }
  })
  rows.sort((x, y) => y.swing - x.swing)
  return { base, rows }
}
