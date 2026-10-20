/** How many deliveries' worth of evidence the overall rate counts for when a small group is pulled toward it. */
export const PRIOR_STRENGTH = 20

export interface Counts {
  key: string
  name: string
  /** Every attempt in the group, delivered or failed. */
  deliveries: number
  failures: number
}

export interface ZoneRate extends Counts {
  raw: number
  /** Pulled toward the overall rate in proportion to how little evidence the group has. */
  shrunk: number
  lo: number
  hi: number
  /** Failures above (+) or below (-) what the overall rate would give this group. */
  excess: number
  /** high / low only when the whole 90% interval sits above / below the overall rate. */
  flag: 'high' | 'low' | null
}

/** Wilson score interval for a proportion. Behaves with small counts, unlike the normal approximation. */
export function wilson(failures: number, n: number, z = 1.645): [number, number] {
  if (n === 0) return [0, 1]
  const p = failures / n
  const z2 = z * z
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n)
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n)
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}

export const shrink = (failures: number, n: number, prior: number, k = PRIOR_STRENGTH) => (failures + k * prior) / (n + k)

/** A rate per group, with the overall rate, a shrunk estimate and an interval, so a group with 8 deliveries cannot look like the worst place. */
export function rateTable(groups: Counts[], k = PRIOR_STRENGTH): { overall: number; rows: ZoneRate[] } {
  const n = groups.reduce((s, g) => s + g.deliveries, 0)
  const f = groups.reduce((s, g) => s + g.failures, 0)
  const overall = n ? f / n : 0
  const rows = groups.map((g) => {
    const [lo, hi] = wilson(g.failures, g.deliveries)
    return {
      ...g,
      raw: g.deliveries ? g.failures / g.deliveries : 0,
      shrunk: shrink(g.failures, g.deliveries, overall, k),
      lo,
      hi,
      excess: g.failures - g.deliveries * overall,
      flag: g.deliveries && lo > overall ? ('high' as const) : g.deliveries && hi < overall ? ('low' as const) : null,
    }
  })
  return { overall, rows }
}

export const HOUR_BUCKETS = ['antes de 10', '10 a 12', '12 a 14', '14 a 16', 'desde las 16']
export const hourBucket = (h: number) => (h < 10 ? 0 : h < 12 ? 1 : h < 14 ? 2 : h < 16 ? 3 : 4)

export const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
/** 0 = Monday, from an ISO date. */
export const weekdayOf = (iso: string) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7
