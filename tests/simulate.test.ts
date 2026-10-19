import { describe, expect, it } from 'vitest'
import { defaultParams, simulate } from '../src/sim/simulate'

describe('simulate', () => {
  it('is deterministic for a seed', () => {
    expect(simulate(defaultParams)).toEqual(simulate(defaultParams))
  })

  it('with 0 vans every failed package returns to the CEDI', () => {
    const r = simulate({ ...defaultParams, vans: 0 })
    expect(r.saved).toBe(0)
    expect(r.returned).toBe(r.failed)
    expect(r.recovered).toBe(0)
    expect(r.vanCost).toBe(0)
  })

  it('failed packages = volume x failure rate', () => {
    const r = simulate({ ...defaultParams, volume: 1000, failureRate: 0.2 })
    expect(r.failed).toBe(200)
  })

  it('never saves Grade C and never exceeds van capacity', () => {
    const r = simulate({ ...defaultParams, vans: 3, volume: 1200, failureRate: 0.3, maxMinutes: 45, secondAttemptSuccess: 0.9 })
    expect(r.incidents.filter((q) => q.grade === 'C' && q.saved)).toHaveLength(0)
    r.vans.forEach((v) => expect(v.handled).toBeLessThanOrEqual(80))
  })

  it('more reach never saves fewer packages (same seed)', () => {
    const short = simulate({ ...defaultParams, placement: 'zones', maxMinutes: 10 })
    const long = simulate({ ...defaultParams, placement: 'zones', maxMinutes: 40 })
    expect(long.saved).toBeGreaterThanOrEqual(short.saved)
  })
})
