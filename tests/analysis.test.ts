import { describe, expect, it } from 'vitest'
import { breakEvenVolume, marginalVolume, meanOver, sensitivity, vansCurve, type VolumePoint } from '../src/sim/analysis'
import { defaultParams, greedyPlacement, nearestCell, simulate } from '../src/sim/simulate'

const pts = (rows: [number, number[]][]): VolumePoint[] => rows.map(([volume, net]) => ({ volume, failed: 0, net }))

describe('break-even helpers', () => {
  it('interpolates where a series crosses zero', () => {
    const p = pts([[100, [-100]], [200, [100]]])
    expect(breakEvenVolume(p, 0)).toBe(150)
  })
  it('returns the first volume if already positive and null if never', () => {
    expect(breakEvenVolume(pts([[100, [5]], [200, [9]]]), 0)).toBe(100)
    expect(breakEvenVolume(pts([[100, [-5]], [200, [-1]]]), 0)).toBeNull()
  })
  it('finds where a bigger fleet overtakes a smaller one', () => {
    const p = pts([[100, [10, 0]], [200, [20, 30]]])
    expect(marginalVolume(p, 1)).toBeCloseTo(100 + 100 * (10 / 20), 5)
  })
})

describe('van placement', () => {
  it('places distinct cells and as many vans as requested', () => {
    for (const placement of ['zones', 'concentration', 'hindsight'] as const) {
      const r = simulate({ ...defaultParams, vans: 3, placement })
      expect(r.vans).toHaveLength(3)
      expect(new Set(r.vans.map((v) => v.cell)).size).toBe(3)
    }
  })
  it('greedy coverage puts the first van on the heaviest cluster', () => {
    const w = new Array<number>(443).fill(0)
    const heavy = nearestCell(6.2442, -75.5812)
    w[heavy] = 100
    w[nearestCell(6.4386, -75.3322)] = 1
    expect(greedyPlacement(1, w, 5)).toEqual([heavy])
  })
  it('concentration placement does not depend on the evaluated day', () => {
    const a = simulate({ ...defaultParams, seed: 1 }).vans.map((v) => v.cell)
    const b = simulate({ ...defaultParams, seed: 99 }).vans.map((v) => v.cell)
    expect(a).toEqual(b)
  })
})

describe('analysis', () => {
  it('zero vans means zero net', () => {
    expect(meanOver({ ...defaultParams, vans: 0 }).net).toBe(0)
    expect(vansCurve(defaultParams)[0].net).toBe(0)
  })
  it('sensitivity rows are sorted by swing and the base matches the mean', () => {
    const { base, rows } = sensitivity(defaultParams)
    expect(base).toBe(meanOver(defaultParams).net)
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].swing).toBeGreaterThanOrEqual(rows[i].swing)
  })
  it('a higher van cost never raises the net', () => {
    const { rows } = sensitivity(defaultParams)
    const cost = rows.find((r) => r.label.startsWith('Costo de una van'))!
    expect(cost.lowDelta).toBeGreaterThan(0)
    expect(cost.highDelta).toBeLessThan(0)
  })
})
