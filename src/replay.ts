import type { Incident, Result } from './sim/simulate'

export interface Arc {
  from: [number, number]
  to: [number, number]
  /** Hour of the day at which the package fails and the arc starts. */
  hour: number
  /** True when the package ends in a van, false when it goes back to the CEDI. */
  saved: boolean
}

/** Whole hours that cover every failure of the day, so the slider never starts or ends mid-hour. */
export function dayRange(incidents: Pick<Incident, 'hour'>[]): [number, number] {
  if (!incidents.length) return [8, 17]
  let lo = Infinity
  let hi = -Infinity
  for (const q of incidents) { lo = Math.min(lo, q.hour); hi = Math.max(hi, q.hour) }
  const start = Math.floor(lo)
  return [start, Math.max(start + 1, Math.ceil(hi))]
}

/** Failures that have happened by `hour`, and how each of those ends. */
export function countAt(incidents: Pick<Incident, 'hour' | 'saved'>[], hour: number) {
  let failed = 0
  let saved = 0
  for (const q of incidents) if (q.hour <= hour) { failed++; if (q.saved) saved++ }
  return { failed, saved, returned: failed - saved }
}

/** One arc per failed package: to its van if it was rescued, to the CEDI if it was not. Straight-line ends; the curve is only illustrative. */
export function buildArcs(result: Pick<Result, 'incidents' | 'vans'>, cedi: { lat: number; lon: number }): Arc[] {
  return result.incidents.map((q) => {
    const van = q.saved && q.vanIndex !== null ? result.vans[q.vanIndex] : undefined
    const dest = van ?? cedi
    return { from: [q.lon, q.lat], to: [dest.lon, dest.lat], hour: q.hour, saved: !!van }
  })
}

export const clock = (hour: number) => {
  const h = Math.floor(hour)
  const m = Math.floor((hour - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Hours an arc takes to travel from the failure to its destination. */
export const ARC_HOURS = 1.2
