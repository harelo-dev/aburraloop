import { describe, expect, it } from 'vitest'
import { buildArcs, clock, countAt, dayRange } from '../src/replay'
import { defaultParams, simulate } from '../src/sim/simulate'
import places from '../src/data/places.json'

const cedi = places.cedis.find((c) => c.id === defaultParams.cedi)!

describe('replay', () => {
  it('covers every failure with whole hours', () => {
    const r = simulate(defaultParams)
    const [a, b] = dayRange(r.incidents)
    expect(Number.isInteger(a) && Number.isInteger(b)).toBe(true)
    expect(r.incidents.every((q) => q.hour >= a && q.hour <= b)).toBe(true)
    expect(dayRange([])).toEqual([8, 17])
  })

  it('counts add up and reach the day totals at the end', () => {
    const r = simulate({ ...defaultParams, vans: 2 })
    const [, end] = dayRange(r.incidents)
    const all = countAt(r.incidents, end)
    expect(all).toEqual({ failed: r.failed, saved: r.saved, returned: r.returned })
    expect(countAt(r.incidents, 0).failed).toBe(0)
    const mid = countAt(r.incidents, (end + dayRange(r.incidents)[0]) / 2)
    expect(mid.saved + mid.returned).toBe(mid.failed)
  })

  it('sends saved packages to their van and the rest to the CEDI', () => {
    const r = simulate({ ...defaultParams, vans: 2 })
    const arcs = buildArcs(r, cedi)
    expect(arcs).toHaveLength(r.incidents.length)
    expect(arcs.filter((a) => a.saved)).toHaveLength(r.saved)
    arcs.forEach((a, i) => {
      const q = r.incidents[i]
      const dest = q.saved ? r.vans[q.vanIndex!] : cedi
      expect(a.to).toEqual([dest.lon, dest.lat])
    })
  })

  it('with no vans every arc goes to the CEDI', () => {
    const arcs = buildArcs(simulate({ ...defaultParams, vans: 0 }), cedi)
    expect(arcs.some((a) => a.saved)).toBe(false)
    expect(arcs.every((a) => a.to[0] === cedi.lon && a.to[1] === cedi.lat)).toBe(true)
  })

  it('formats the clock', () => {
    expect(clock(8)).toBe('08:00')
    expect(clock(16.5)).toBe('16:30')
  })
})
