import { describe, expect, it } from 'vitest'
import { breakEvenVolume, marginalVolume, meanOver, sensitivity, vansCurve, type VolumePoint } from '../src/sim/analysis'
import travel from '../src/data/travel.json'
import { ASSUMPTIONS, defaultParams, densityPlacement, generateIncidents, greedyPlacement, nearestCell, simulate, simulateAt } from '../src/sim/simulate'

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
    for (const placement of ['zones', 'history', 'hindsight'] as const) {
      for (const objective of ['reach', 'value', 'density'] as const) {
        const r = simulate({ ...defaultParams, vans: 3, placement, objective })
        expect(r.vans).toHaveLength(3)
        expect(new Set(r.vans.map((v) => v.cell)).size).toBe(3)
      }
    }
  })
  it('greedy coverage puts the first van on the heaviest cluster', () => {
    const w = new Array<number>(443).fill(0)
    const heavy = nearestCell(6.2442, -75.5812)
    w[heavy] = 100
    w[nearestCell(6.4386, -75.3322)] = 1
    expect(greedyPlacement(1, w, 5)).toEqual([heavy])
  })
  it('history placement does not depend on the evaluated day', () => {
    const a = simulate({ ...defaultParams, seed: 1 }).vans.map((v) => v.cell)
    const b = simulate({ ...defaultParams, seed: 99 }).vans.map((v) => v.cell)
    expect(a).toEqual(b)
  })
})

describe('minimum distance to the CEDI', () => {
  const minutesToCedi = (cedi: string, cell: number) => travel.cells[cell].min[travel.origins.indexOf(`cedi:${cedi}`)]
  it('keeps every van at least minCediMinutes from the CEDI, for every strategy', () => {
    for (const cedi of ['sur', 'centro', 'gir'] as const) {
      for (const placement of ['zones', 'history', 'hindsight'] as const) {
        for (const objective of ['reach', 'value', 'density'] as const) {
          const r = simulate({ ...defaultParams, cedi, vans: 3, placement, objective, minCediMinutes: 10 })
          expect(r.vans).toHaveLength(3)
          r.vans.forEach((v) => expect(minutesToCedi(cedi, v.cell)).toBeGreaterThanOrEqual(10))
        }
      }
    }
  })
  it('with no limit, a van can sit next to the CEDI', () => {
    const r = simulate({ ...defaultParams, cedi: 'centro', vans: 1, placement: 'zones', minCediMinutes: 0 })
    expect(minutesToCedi('centro', r.vans[0].cell)).toBeLessThan(10)
  })
})

describe('density placement', () => {
  it('splits a dense core instead of heading for a thin periphery', () => {
    const w = new Array<number>(443).fill(0)
    const west = nearestCell(6.2442, -75.6), east = nearestCell(6.2442, -75.55), far = nearestCell(6.4386, -75.3322)
    w[west] = 40; w[east] = 40; w[far] = 2
    const [first, second] = densityPlacement(2, w, 25)
    expect(first).not.toBe(far)
    expect(second).not.toBe(far)
  })
})

describe('margin attribution', () => {
  it('losing less margin when a package returns recovers fewer pesos', () => {
    // same vans on the same cells and the same day, only the margin attribution changes
    const base = simulate(defaultParams)
    const at = (marginLossShare: number) => {
      const p = { ...defaultParams, marginLossShare }
      return simulateAt(p, ASSUMPTIONS, generateIncidents(p, ASSUMPTIONS, p.seed), base.vans.map((v) => v.cell))
    }
    const full = at(1)
    const half = at(0.5)
    expect(half.saved).toBe(full.saved)
    expect(half.recovered).toBeLessThan(full.recovered)
  })
  it('net is recovered minus van cost minus courier detours', () => {
    const r = simulate(defaultParams)
    expect(r.net).toBeCloseTo(r.recovered - r.vanCost - r.detourCost, 6)
    expect(r.detourCost).toBeGreaterThan(0)
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
