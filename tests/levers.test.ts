import { describe, expect, it } from 'vitest'
import { DEFAULT_COSTS, atEffect, levers, pilotSize, tierOf } from '../src/sim/levers'
import { failureValues } from '../src/sim/analysis'
import { defaultParams } from '../src/sim/simulate'

const v = failureValues(defaultParams)

describe('what a failure is worth', () => {
  it('adds up by grade and the Grade C returns have no margin to lose', () => {
    const total = (['A', 'B', 'C'] as const).reduce((s, g) => s + v.byGrade[g].perDay * v.byGrade[g].value, 0)
    expect(total).toBeCloseTo(v.perDay, 3)
    expect(v.byGrade.A.value).toBeGreaterThan(v.byGrade.C.value)
    expect(v.lateShare).toBeGreaterThan(0.2)
    expect(v.lateShare).toBeLessThan(0.6)
  })
})

describe('levers', () => {
  const list = levers(v, defaultParams, DEFAULT_COSTS, v.lateShare)
  it('needs cost divided by what the failures it attacks are worth', () => {
    const confirm = list.find((l) => l.id === 'confirm')!
    expect(confirm.needed).toBeCloseTo((DEFAULT_COSTS.confirm * defaultParams.volume) / (v.byGrade.A.perDay * v.byGrade.A.value), 6)
    expect(confirm.ceiling).toBeCloseTo(v.byGrade.A.perDay * v.byGrade.A.value, 6)
  })
  it('lists the easiest to pay for first', () => {
    for (let i = 1; i < list.length; i++) expect(list[i - 1].needed).toBeLessThanOrEqual(list[i].needed)
  })
  it('a lever that costs more than the failures it attacks can never pay for itself', () => {
    const dear = levers(v, defaultParams, { ...DEFAULT_COSTS, confirm: 1_000_000 }, v.lateShare).find((l) => l.id === 'confirm')!
    expect(dear.needed).toBeGreaterThan(1)
    expect(dear.tier).toBe('never')
    expect(dear.measure).toBeNull()
  })
  it('a pickup costs what a van costs', () => {
    expect(list.find((l) => l.id === 'pickup')!.costPerDay).toBe(defaultParams.vanCostCopPerDay)
  })
  it('a cheaper lever needs a smaller effect', () => {
    const cheap = levers(v, defaultParams, { ...DEFAULT_COSTS, prepaid: 20 }, v.lateShare).find((l) => l.id === 'prepaid')!
    const dear = levers(v, defaultParams, { ...DEFAULT_COSTS, prepaid: 200 }, v.lateShare).find((l) => l.id === 'prepaid')!
    expect(cheap.needed).toBeLessThan(dear.needed)
  })
  it('with no failures there is nothing to avoid', () => {
    const none = failureValues({ ...defaultParams, failureRate: 0 })
    expect(levers(none, { ...defaultParams, failureRate: 0 }, DEFAULT_COSTS, 0.3).every((l) => l.needed === Infinity)).toBe(true)
  })
})

describe('an effect the person expects', () => {
  const list = levers(v, defaultParams, DEFAULT_COSTS, v.lateShare)
  it('earns nothing at the break-even effect and gains above it', () => {
    const l = list.find((x) => x.id === 'confirm')!
    expect(atEffect(l, l.needed).gain).toBeCloseTo(0, 6)
    expect(atEffect(l, l.needed * 2).gain).toBeCloseTo(l.costPerDay, 6)
    expect(atEffect(l, 0.0001).gain).toBeLessThan(0)
  })
  it('a bigger expected effect is easier to measure', () => {
    const l = list.find((x) => x.id === 'confirm')!
    expect(atEffect(l, 0.3).measure!.days).toBeLessThan(atEffect(l, 0.1).measure!.days)
  })
  it('measures how many accept a lever that acts after the failure', () => {
    expect(atEffect(list.find((x) => x.id === 'pickup')!, 0.3).measure!.kind).toBe('rate')
  })
})

describe('tiers and pilots', () => {
  it('classifies by how much of the failures must be avoided', () => {
    expect([0.05, 0.2, 0.6, 1.4].map(tierOf)).toEqual(['small', 'medium', 'large', 'never'])
  })
  it('a smaller effect needs more deliveries and more days to see', () => {
    const big = pilotSize(0.06, 0.3, 600)!, small = pilotSize(0.06, 0.1, 600)!
    expect(small.perGroup).toBeGreaterThan(big.perGroup * 5)
    expect(small.days).toBeGreaterThan(big.days)
  })
  it('matches the textbook figure for two proportions', () => {
    // 10% vs 5% with 80% power at 5%: about 430 per group
    const s = pilotSize(0.1, 0.5, 1000)!
    expect(s.perGroup).toBeGreaterThan(400)
    expect(s.perGroup).toBeLessThan(460)
  })
  it('has no answer without an effect to detect', () => {
    expect(pilotSize(0.1, 0, 100)).toBeNull()
    expect(pilotSize(0, 0.2, 100)).toBeNull()
  })
})
