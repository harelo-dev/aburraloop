import { ASSUMPTIONS, generateIncidents, simulate, type Assumptions, type Grade, type Objective, type Params, type Placement } from './simulate'

export const ANALYSIS_DAYS = 8

export interface Mean {
  failed: number
  saved: number
  recovered: number
  vanCost: number
  detourCost: number
  tripSaving: number
  net: number
  savedPct: number
}

/** Average over `days` simulated days (seeds seed, seed+1, ...). */
export function meanOver(p: Params, days = ANALYSIS_DAYS, a: Assumptions = ASSUMPTIONS): Mean {
  let failed = 0, saved = 0, recovered = 0, vanCost = 0, detourCost = 0, tripSaving = 0, net = 0
  for (let d = 0; d < days; d++) {
    const r = simulate({ ...p, seed: p.seed + d }, a)
    failed += r.failed; saved += r.saved; recovered += r.recovered; vanCost += r.vanCost; detourCost += r.detourCost; tripSaving += r.tripSaving; net += r.net
  }
  failed /= days; saved /= days; recovered /= days; vanCost /= days; detourCost /= days; tripSaving /= days; net /= days
  return { failed, saved, recovered, vanCost, detourCost, tripSaving, net, savedPct: failed ? (saved / failed) * 100 : 0 }
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
  id: 'zones' | 'history-reach' | 'history-value' | 'history-density' | 'trend' | 'hindsight'
  mean: Mean
  sites: string[]
}

/** Fixed zones, history with each objective, and the same-day ceiling for the objective in use. */
export function placementComparison(p: Params): PlacementRow[] {
  // In rounds mode the vans always follow the couriers' concentration, so the criteria collapse into one.
  const cases: { id: PlacementRow['id']; placement: Placement; objective: Objective }[] = [
    { id: 'zones', placement: 'zones', objective: p.objective },
    { id: 'history-reach', placement: 'history', objective: 'reach' },
    { id: 'history-value', placement: 'history', objective: 'value' },
    { id: 'history-density', placement: 'history', objective: 'density' },
    ...(p.data?.exposure?.length ? [{ id: 'trend' as const, placement: 'trend' as const, objective: p.objective }] : []),
    { id: 'hindsight', placement: 'hindsight', objective: p.objective },
  ]
  const used = p.mode === 'rounds' ? cases.filter((c) => c.id === 'zones' || c.id === 'history-density' || c.id === 'trend' || c.id === 'hindsight') : cases
  return used.map(({ id, placement, objective }) => {
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

  const withShare = (v: number): Params => ({ ...p, gradeShare: { A: v, B: p.gradeShare.B, C: Math.max(0, 1 - v - p.gradeShare.B) } })
  const sLo = clamp(p.gradeShare.A - 0.1, 0.05, 0.9 - p.gradeShare.B), sHi = clamp(p.gradeShare.A + 0.1, 0.05, 0.9 - p.gradeShare.B)
  cases.push({ label: 'Proporción de paquetes Grado A', low: [pct(sLo), withShare(sLo), A], high: [pct(sHi), withShare(sHi), A] })

  const blo = clamp(p.gradeBSuccess - 0.15, 0.1, 0.95), bhi = clamp(p.gradeBSuccess + 0.15, 0.1, 0.95)
  cases.push({ label: 'Éxito Grado B (liquidación flash)', low: [pct(blo), { ...p, gradeBSuccess: blo }, A], high: [pct(bhi), { ...p, gradeBSuccess: bhi }, A] })
  cases.push({ label: 'Margen del producto (Grado A)', low: ['20%', p, withA({ marginA: 0.2 })], high: ['36%', p, withA({ marginA: 0.36 })] })
  cases.push({ label: 'Costo de una van por día', low: [cop(p.vanCostCopPerDay * 0.75), { ...p, vanCostCopPerDay: p.vanCostCopPerDay * 0.75 }, A], high: [cop(p.vanCostCopPerDay * 1.25), { ...p, vanCostCopPerDay: p.vanCostCopPerDay * 1.25 }, A] })
  cases.push({ label: 'Costo del flete por km', low: [`$${A.freightCopPerKm * 2 / 3}`, p, withA({ freightCopPerKm: A.freightCopPerKm * 2 / 3 })], high: [`$${A.freightCopPerKm * 4 / 3}`, p, withA({ freightCopPerKm: A.freightCopPerKm * 4 / 3 })] })
  const mlsLo = clamp(p.marginLossShare - 0.25, 0.1, 1), mlsHi = clamp(p.marginLossShare + 0.25, 0.1, 1)
  cases.push({ label: 'Margen que se pierde si vuelve al CEDI', low: [pct(mlsLo), { ...p, marginLossShare: mlsLo }, A], high: [pct(mlsHi), { ...p, marginLossShare: mlsHi }, A] })
  cases.push({ label: 'Costo del desvío de la moto por minuto', low: ['$150', { ...p, detourCopPerMin: 150 }, A], high: ['$450', { ...p, detourCopPerMin: 450 }, A] })
  cases.push({ label: 'Capacidad de la van', low: ['40 pq', p, withA({ vanCapacity: 40 })], high: ['120 pq', p, withA({ vanCapacity: 120 })] })
  cases.push({ label: 'Valor COD de los paquetes', low: ['−20%', { ...p, codAverage: p.codAverage * 0.8 }, A], high: ['+20%', { ...p, codAverage: p.codAverage * 1.2 }, A] })

  const rows = cases.map((c) => {
    const lowDelta = meanOver(c.low[1], ANALYSIS_DAYS, c.low[2]).net - base
    const highDelta = meanOver(c.high[1], ANALYSIS_DAYS, c.high[2]).net - base
    return { label: c.label, lowLabel: c.low[0], highLabel: c.high[0], lowDelta, highDelta, swing: Math.abs(highDelta - lowDelta) }
  })
  rows.sort((x, y) => y.swing - x.swing)
  return { base, rows }
}

export interface ModeRow {
  vans: number
  intercept: Mean
  rounds: Mean
  roundsPending: Mean
}

/** Vans that intercept failures during the day against vans that do morning and afternoon rounds, for 1 to 3 vans. */
export function modeComparison(p: Params): ModeRow[] {
  return ([1, 2, 3] as const).map((vans) => ({
    vans,
    intercept: meanOver({ ...p, vans, mode: 'intercept' }),
    rounds: meanOver({ ...p, vans, mode: 'rounds', skipEmptyVisits: false }),
    roundsPending: meanOver({ ...p, vans, mode: 'rounds', skipEmptyVisits: true }),
  }))
}

export interface FailureValues {
  /** Pesos a day that the failed deliveries cost before any van. */
  perDay: number
  perFailure: number
  failuresPerDay: number
  /** Per grade: failures a day and the pesos that avoiding one of them is worth. */
  byGrade: Record<Grade, { perDay: number; value: number }>
  /** Share of the failures that happen from 14:00 on. */
  lateShare: number
}

/**
 * What a failed delivery costs, by grade: freight both ways, handling and the share of margin that is lost when it
 * goes back to the CEDI. Averaged over simulated days.
 */
export function failureValues(p: Params, a: Assumptions = ASSUMPTIONS, days = ANALYSIS_DAYS): FailureValues {
  const sum: Record<Grade, { n: number; v: number }> = { A: { n: 0, v: 0 }, B: { n: 0, v: 0 }, C: { n: 0, v: 0 } }
  let late = 0
  for (let d = 0; d < days; d++) {
    for (const q of generateIncidents({ ...p, seed: p.seed + d }, a, p.seed + d)) {
      const margin = q.grade === 'A' ? a.marginA : q.grade === 'B' ? a.marginB : 0
      sum[q.grade].n++
      sum[q.grade].v += 2 * q.cediKm * a.freightCopPerKm + a.handlingCop + q.cod * margin * p.marginLossShare
      if (q.hour >= 14) late++
    }
  }
  const n = sum.A.n + sum.B.n + sum.C.n
  const v = sum.A.v + sum.B.v + sum.C.v
  const grade = (g: Grade) => ({ perDay: sum[g].n / days, value: sum[g].n ? sum[g].v / sum[g].n : 0 })
  return { perDay: v / days, perFailure: n ? v / n : 0, failuresPerDay: n / days, byGrade: { A: grade('A'), B: grade('B'), C: grade('C') }, lateShare: n ? late / n : 0 }
}

/** What the failed deliveries of an average day cost before any van. */
export function failureCost(p: Params, a: Assumptions = ASSUMPTIONS, days = ANALYSIS_DAYS): { perFailure: number; perDay: number } {
  const v = failureValues(p, a, days)
  return { perFailure: v.perFailure, perDay: v.perDay }
}

export type Config = 'intercept' | 'rounds' | 'roundsPending'

export interface Best {
  /** none: no van setup earns more than it costs. */
  config: Config | 'none'
  vans: number
  net: number
  rows: ModeRow[]
}

/** The mode and number of vans with the highest net per day, among 1 to 3 vans and the three ways of operating. */
export function bestConfig(p: Params): Best {
  const rows = modeComparison(p)
  let best: Best = { config: 'none', vans: 0, net: 0, rows }
  for (const row of rows) {
    for (const config of ['intercept', 'rounds', 'roundsPending'] as const) {
      if (row[config].net > best.net) best = { config, vans: row.vans, net: row[config].net, rows }
    }
  }
  return best
}

export const withConfig = (p: Params, config: Config, vans: number): Params => ({
  ...p,
  vans: vans as Params['vans'],
  mode: config === 'intercept' ? 'intercept' : 'rounds',
  skipEmptyVisits: config === 'roundsPending',
})

/**
 * Net per day of one setup when two of the least certain inputs are off: the failure rate by `ratePoints` and the
 * second-attempt success by `retryPoints`. Returns the lowest and highest of the four corners.
 */
export function netRange(p: Params, config: Config, vans: number, ratePoints: number, retryPoints: number): [number, number] {
  const base = withConfig(p, config, vans)
  const nets: number[] = []
  for (const dr of [-ratePoints, ratePoints]) {
    for (const dp of [-retryPoints, retryPoints]) {
      nets.push(meanOver({
        ...base,
        failureRate: Math.min(0.4, Math.max(0.02, base.failureRate + dr / 100)),
        secondAttemptSuccess: Math.min(0.95, Math.max(0.1, base.secondAttemptSuccess + dp / 100)),
      }).net)
    }
  }
  return [Math.min(...nets), Math.max(...nets)]
}
