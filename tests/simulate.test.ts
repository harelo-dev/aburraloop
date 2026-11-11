import { describe, expect, it } from 'vitest'
import { cellCenter, defaultParams, nearestCell, placeVan, simulate } from '../src/sim/simulate'
import places from '../src/data/places.json'

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

describe('manual van placement', () => {
  const base = { ...defaultParams, vans: 2 as const }
  const cells = simulate(base).vans.map((v) => v.cell)
  const pointOf = (c: number) => cellCenter(c)

  it('simulate uses the dragged cells when their count matches the vans', () => {
    const target = nearestCell(6.25, -75.57)
    const moved = simulate({ ...base, manualVans: [target, cells[1]] })
    expect(moved.vans[0].cell).toBe(target)
    expect(simulate({ ...base, manualVans: [target] }).vans.map((v) => v.cell)).toEqual(cells)
  })

  it('moves one van to the cell under a point and leaves the others', () => {
    const free = nearestCell(6.3, -75.58)
    const { lat, lon } = pointOf(free)
    const res = placeVan(base, cells, 0, lat, lon)
    expect('cells' in res && res.cells).toEqual(free === cells[1] ? undefined : [free, cells[1]])
  })

  it('rejects a point outside the valley, on another van, or too near the CEDI', () => {
    expect(placeVan(base, cells, 0, 0, 0)).toEqual({ error: 'outside' })
    const other = pointOf(cells[1])
    expect(placeVan(base, cells, 0, other.lat, other.lon)).toEqual({ error: 'taken' })
    const cedi = places.cedis.find((c) => c.id === base.cedi)!
    expect(placeVan({ ...base, minCediMinutes: 20 }, cells, 0, cedi.lat, cedi.lon)).toEqual({ error: 'near-cedi' })
  })
})
