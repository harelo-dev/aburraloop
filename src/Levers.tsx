import { useDeferredValue, useMemo, useState } from 'react'
import { failureValues } from './sim/analysis'
import { DEFAULT_COSTS, MAX_PILOT_DAYS, atEffect, levers, type Lever, type LeverCosts, type LeverId, type Measure, type Tier } from './sim/levers'
import type { Params } from './sim/simulate'
import type { Report } from './data/ingest'
import { cop } from './format'

const TIER_LABEL: Record<Tier, string> = {
  small: 'se paga con un efecto pequeño',
  medium: 'necesita un efecto mediano',
  large: 'necesita un efecto grande',
  never: 'no se paga ni evitando todos',
}
const TIER_COLOR: Record<Tier, string> = { small: 'var(--accent)', medium: 'var(--c2)', large: 'var(--c3)', never: 'var(--loss)' }

const pct = (v: number) => `${Math.round(v * 100)}%`
const int = (v: number) => new Intl.NumberFormat('es-CO').format(Math.round(v))

const lc = (t: string) => t.charAt(0).toLowerCase() + t.slice(1)

function measureText(m: Measure | null, effectLabel: string) {
  if (!m) return null
  if (m.kind === 'rate') return `Aquí se mide cuántos clientes la aceptan. Con unos ${m.offered} fallos ofrecidos estimas ese porcentaje con ±10 puntos: unos ${m.days} día${m.days === 1 ? '' : 's'}.`
  const base = `Para ver ${effectLabel} con un piloto de dos grupos (con y sin la palanca, repartidos al azar) hacen falta unas ${int(m.perGroup)} entregas por grupo: unos ${int(m.days)} día${m.days === 1 ? '' : 's'} con tu volumen.`
  return m.days > MAX_PILOT_DAYS ? `${base} Es demasiado para un piloto: un efecto así de pequeño se confunde con el ruido. O la palanca es tan barata que conviene aplicarla sin medirla, o solo vale la pena medirla si esperas un efecto mayor.` : base
}

export function Levers({ params, report }: { params: Params; report: Report | null }) {
  const deferred = useDeferredValue(params)
  const [costs, setCosts] = useState<LeverCosts>(DEFAULT_COSTS)
  const [expected, setExpected] = useState<Partial<Record<LeverId, string>>>({})
  const v = useMemo(() => failureValues(deferred), [deferred])
  const late = report?.rates ? (() => {
    const h = report.rates.byHour
    const all = h.reduce((s, r) => s + r.deliveries, 0)
    return all ? (h[3].deliveries + h[4].deliveries) / all : v.lateShare
  })() : v.lateShare
  const list = useMemo(() => levers(v, deferred, costs, late), [v, deferred, costs, late])
  const setCost = (k: keyof LeverCosts, value: string) => setCosts((c) => ({ ...c, [k]: Math.max(0, Number(value.replace(/[^\d]/g, '')) || 0) }))

  return (
    <section className="panel levers" aria-label="Palancas para reducir novedades">
      <h2>Palancas para reducir novedades</h2>
      <p className="hint">
        Tus <b>{int(v.failuresPerDay)} novedades al día</b> cuestan unos <b>{cop(v.perDay)}</b>. Nadie sabe cuánto reduce una palanca las novedades hasta probarla, así que aquí no supongo ningún efecto:
        para cada una calculo <b>cuánto tendría que reducir las novedades que ataca para pagarse</b>. Tú juzgas si ese efecto es plausible. Los costos son ejemplos: cámbialos por los tuyos.
      </p>

      <div className="lever-list">
        {list.map((l) => (
          <article className="lever" key={l.id}>
            <div className="lever-head">
              <h3>{l.name}</h3>
              <span className="lever-needed" style={{ color: TIER_COLOR[l.tier] }}>{l.needed >= 1 ? 'más del 100%' : pct(l.needed)}</span>
            </div>
            <div className="bar" aria-hidden="true"><b style={{ width: `${Math.min(1, l.needed) * 100}%`, background: TIER_COLOR[l.tier] }} /></div>
            <p className="lever-line"><b style={{ color: TIER_COLOR[l.tier] }}>{TIER_LABEL[l.tier]}.</b> Ataca: {lc(l.attacks)}, unos {int(l.targets)} al día. Si evitara todos ahorraría {cop(l.ceiling)} al día; cuesta {cop(l.costPerDay)} al día.</p>
            {l.id === 'confirm' && <label className="lever-cost">Costo por paquete confirmado <input inputMode="numeric" value={costs.confirm} onChange={(e) => setCost('confirm', e.target.value)} /> pesos</label>}
            {l.id === 'shift' && <label className="lever-cost">Costo por paquete movido de franja <input inputMode="numeric" value={costs.shift} onChange={(e) => setCost('shift', e.target.value)} /> pesos</label>}
            {l.id === 'retry' && <label className="lever-cost">Minutos de moto por reintento <input inputMode="numeric" value={costs.retryMinutes} onChange={(e) => setCost('retryMinutes', e.target.value)} /> min a ${deferred.detourCopPerMin}/min</label>}
            {l.id === 'pickup' && <p className="hint">Equivale a lo que cuesta operar una van un día ({cop(deferred.vanCostCopPerDay)}). Se cambia en «Costo de una van por día».</p>}
            {l.id === 'prepaid' && <label className="lever-cost">Costo por paquete ofrecido con enlace de pago <input inputMode="numeric" value={costs.prepaid} onChange={(e) => setCost('prepaid', e.target.value)} /> pesos</label>}
            {l.tier === 'never' && <p className="hint">Baja su costo o cámbiala por otra: con este costo no hay efecto que alcance.</p>}
            {measureText(l.measure, `esa reducción (${pct(l.needed)})`) && <p className="hint">{measureText(l.measure, `esa reducción (${pct(l.needed)})`)}</p>}
            <ExpectedEffect lever={l} value={expected[l.id] ?? ''} onChange={(t) => setExpected((e) => ({ ...e, [l.id]: t }))} />
          </article>
        ))}
      </div>

      <ul className="take list plain">
        <li>Ordenadas de la que menos exige a la que más. Un efecto de 10% significa evitar una de cada diez novedades de las que ataca.</li>
        <li>La comparación parte de una operación sin van. Si ya tienes una, parte de esas novedades ya se rescata y evitarlas vale menos.</li>
        <li>Las palancas se pueden sumar, pero no cuentan dos veces la misma novedad: sus efectos se solapan.</li>
        <li>Un piloto de dos grupos solo mide el efecto si el reparto es al azar. Si se comparan zonas distintas, la diferencia puede deberse a las zonas.</li>
      </ul>
    </section>
  )
}

/** The person's own guess of the effect, which turns the break-even into a gain and sizes a pilot for that effect. */
function ExpectedEffect({ lever, value, onChange }: { lever: Lever; value: string; onChange: (t: string) => void }) {
  const effect = Math.min(100, Math.max(0, Number(value.replace(/[^\d]/g, '')) || 0)) / 100
  const at = effect > 0 ? atEffect(lever, effect) : null
  return (
    <div className="lever-expect">
      <label className="lever-cost">Si esperas que evite <input inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} placeholder="—" /> % de esas novedades</label>
      {at && (
        <>
          <p className="lever-line">Con ese efecto {at.gain >= 0 ? 'ganarías' : 'perderías'} unos <b style={{ color: at.gain >= 0 ? 'var(--accent)' : 'var(--loss)' }}>{cop(Math.abs(at.gain))} al día</b>, descontado su costo.</p>
          {measureText(at.measure, `ese efecto (${Math.round(effect * 100)}%)`) && <p className="hint">{measureText(at.measure, `ese efecto (${Math.round(effect * 100)}%)`)}</p>}
        </>
      )}
    </div>
  )
}
