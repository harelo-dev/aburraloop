import type { FailureValues } from './analysis'
import type { Params } from './simulate'

export type LeverId = 'confirm' | 'shift' | 'retry' | 'pickup' | 'prepaid'

/** Example costs, to be replaced by the person's own. */
export interface LeverCosts {
  /** Pesos per package sent a confirmation before it leaves (a message or a call). */
  confirm: number
  /** Pesos per package moved to another time slot (re-planning, a tighter route). */
  shift: number
  /** Minutes of a courier's time for each same-day retry. */
  retryMinutes: number
  /** Pesos per COD package offered a payment link. */
  prepaid: number
}

export const DEFAULT_COSTS: LeverCosts = { confirm: 200, shift: 150, retryMinutes: 15, prepaid: 100 }

export type Tier = 'small' | 'medium' | 'large' | 'never'

export type Measure =
  /** Two groups, with and without the lever, to see a drop in the failure rate of what it attacks. */
  | { kind: 'compare'; perGroup: number; days: number }
  /** The lever works on failures that already happened, so what is measured is how many accept it. */
  | { kind: 'rate'; offered: number; days: number }

export interface Lever {
  id: LeverId
  name: string
  attacks: string
  /** Failures a day it works on. */
  targets: number
  /** Pesos a day it would save if it avoided every one of them. */
  ceiling: number
  costPerDay: number
  /** Share of those failures it must avoid to cover its cost. Above 1 it can never pay for itself. */
  needed: number
  tier: Tier
  /** How the lever's effect would be measured in a pilot, for the effect it needs to pay for itself. */
  measure: Measure | null
  /** compare: the lever acts before the failure, on `exposed` packages a day whose failure rate it attacks (p1). rate: it acts after it. */
  basis: { kind: 'compare'; p1: number; exposed: number } | { kind: 'rate' }
}

/** What a given effect would earn each day, and how a pilot would measure it. */
export function atEffect(l: Lever, effect: number): { gain: number; measure: Measure | null } {
  const gain = effect * l.ceiling - l.costPerDay
  if (l.basis.kind === 'rate') return { gain, measure: { kind: 'rate', offered: RATE_SAMPLE, days: Math.ceil(RATE_SAMPLE / Math.max(0.01, l.targets)) } }
  const s = pilotSize(l.basis.p1, effect, l.basis.exposed)
  return { gain, measure: s ? { kind: 'compare', ...s } : null }
}

/** A pilot longer than this is not a pilot. */
export const MAX_PILOT_DAYS = 60

export const tierOf = (needed: number): Tier => (needed < 0.1 ? 'small' : needed < 0.3 ? 'medium' : needed < 1 ? 'large' : 'never')

const Z = 1.96 + 0.84 // 5% two-sided significance and 80% power

/**
 * Deliveries per group needed to tell a failure rate p1 from p1 x (1 - effect), and the days of a pilot that splits
 * `exposedPerDay` packages in two. Assumes the groups are comparable, which only a random split guarantees.
 */
export function pilotSize(p1: number, effect: number, exposedPerDay: number): { perGroup: number; days: number } | null {
  if (!(p1 > 0 && p1 < 1) || !(effect > 0 && effect < 1) || !(exposedPerDay > 0)) return null
  const p2 = p1 * (1 - effect)
  const perGroup = Math.ceil((Z * Z * (p1 * (1 - p1) + p2 * (1 - p2))) / ((p1 - p2) ** 2))
  return { perGroup, days: Math.ceil((2 * perGroup) / exposedPerDay) }
}

/** Failures to watch to estimate a rate within about 10 points (95%). */
const RATE_SAMPLE = 96

/**
 * The effect each lever needs in order to pay for itself, compared with the cost of the failures it attacks. Nobody
 * knows how much a lever reduces failures until it is tried, so none is assumed: the person judges whether the needed
 * effect is plausible. The baseline is an operation with no van.
 */
export function levers(v: FailureValues, p: Params, costs: LeverCosts, lateAttemptShare: number): Lever[] {
  const A = v.byGrade.A
  const B = v.byGrade.B
  const lateFailures = v.failuresPerDay * v.lateShare
  const lateExposed = p.volume * lateAttemptShare
  const make = (
    id: LeverId, name: string, attacks: string, targets: number, valueEach: number, costPerDay: number, basis: Lever['basis'],
  ): Lever => {
    const ceiling = targets * valueEach
    const needed = ceiling > 0 ? costPerDay / ceiling : Infinity
    const lever: Lever = { id, name, attacks, targets, ceiling, costPerDay, needed, tier: tierOf(needed), measure: null, basis }
    lever.measure = needed < 1 ? atEffect(lever, needed).measure : null
    return lever
  }
  const before = (targets: number, exposed: number): Lever['basis'] => ({ kind: 'compare', p1: targets / Math.max(1, exposed), exposed })
  const after: Lever['basis'] = { kind: 'rate' }

  return [
    make('confirm', 'Confirmar antes de salir', 'Cliente ausente, no contesta, dirección no encontrada (A)', A.perDay, A.value, costs.confirm * p.volume, before(A.perDay, p.volume)),
    make('shift', 'Entregar en otra franja horaria', 'Fallos de las 14:00 en adelante', lateFailures, v.perFailure, costs.shift * lateExposed, before(lateFailures, lateExposed)),
    make('retry', 'Reintento el mismo día si el cliente quiere', 'Cliente ausente o sin respuesta (A)', A.perDay, A.value, costs.retryMinutes * p.detourCopPerMin * A.perDay, after),
    make('pickup', 'Recoger en la van o en un punto', 'Cliente ausente o sin respuesta (A)', A.perDay, A.value, p.vanCostCopPerDay, after),
    make('prepaid', 'Pago anticipado con enlace de pago', 'Rechazo o sin efectivo (B)', B.perDay, B.value, costs.prepaid * p.volume, before(B.perDay, p.volume)),
  ].sort((x, y) => x.needed - y.needed)
}
