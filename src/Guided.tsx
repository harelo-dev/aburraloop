import { useEffect, useState } from 'react'
import { bestConfig, failureCost, netRange, sensitivity, withConfig, type Best } from './sim/analysis'
import { defaultParams, type CediId, type Params } from './sim/simulate'
import { CONFIG_LABEL } from './summary'
import { cop, copSigned } from './format'

const CEDIS: { id: CediId; name: string; note: string }[] = [
  { id: 'sur', name: 'CEDI Sur · Sabaneta', note: 'Despachas desde el sur del valle' },
  { id: 'centro', name: 'CEDI Centro · Guayabal', note: 'Despachas desde el centro, cerca de Medellín' },
  { id: 'gir', name: 'CEDI Girardota', note: 'Despachas desde el norte' },
]
const lc = (t: string) => t.charAt(0).toLowerCase() + t.slice(1)
const STEPS = ['Bodega', 'Volumen', 'Novedades', 'Causas', 'Costos']

interface Answers {
  cedi: CediId
  volume: number
  fleet: number
  rate: number
  measured: boolean
  shareA: number
  shareB: number
  retry: number
  cod: number
  vanCost: number
  motoMonthly: string
  motoHours: string
}

const START: Answers = {
  cedi: 'centro', volume: 600, fleet: 24, rate: 12, measured: false, shareA: 45, shareB: 25, retry: 60, cod: 117, vanCost: 32, motoMonthly: '', motoHours: '208',
}

const toParams = (a: Answers): Params => {
  const monthly = Number(a.motoMonthly.replace(/[^\d]/g, ''))
  const hours = Number(a.motoHours)
  const perMinute = monthly > 0 && hours > 0 ? Math.round(monthly / (hours * 60)) : defaultParams.detourCopPerMin
  const A = a.shareA / 100
  const B = Math.min(a.shareB / 100, 1 - A)
  return {
    ...defaultParams,
    cedi: a.cedi, volume: a.volume, fleet: a.fleet, failureRate: a.rate / 100,
    gradeShare: { A, B, C: Math.max(0, 1 - A - B) },
    secondAttemptSuccess: a.retry / 100,
    codAverage: a.cod * 1000, vanCostCopPerDay: a.vanCost * 10000, detourCopPerMin: perMinute,
  }
}

interface Outcome {
  p: Params
  best: Best
  range: [number, number] | null
  cost: { perFailure: number; perDay: number }
  onePoint: number
  top: string[]
}

function compute(a: Answers): Outcome {
  const p = toParams(a)
  const best = bestConfig(p)
  const cost = failureCost(p)
  const range = best.config === 'none' ? null : netRange(p, best.config, best.vans, a.measured ? 2 : 5, a.measured ? 5 : 15)
  const top = sensitivity(withConfig(p, best.config === 'none' ? 'intercept' : best.config, best.vans || 1)).rows.slice(0, 3).map((r) => lc(r.label))
  return { p, best, range, cost, onePoint: cost.perFailure * p.volume * 0.01, top }
}

function Pick({ label, value, min, max, step, out, onChange, hint }: { label: string; value: number; min: number; max: number; step: number; out: string; onChange: (v: number) => void; hint?: string }) {
  const id = `g-${label.replace(/\W+/g, '')}`
  return (
    <div className="ctl">
      <label htmlFor={id}>{label}<output>{out}</output></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}

export function Guided({ open, onToggle, onApply, onCsv }: {
  open: boolean
  onToggle: (open: boolean) => void
  onApply: (p: Params) => void
  onCsv: () => void
}) {
  const [step, setStep] = useState(0)
  const [a, setA] = useState<Answers>(START)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const set = <K extends keyof Answers>(k: K, v: Answers[K]) => setA((o) => ({ ...o, [k]: v }))

  useEffect(() => {
    if (step !== STEPS.length) { setOutcome(null); return }
    const t = setTimeout(() => setOutcome(compute(a)), 40) // lets the "calculating" line paint first
    return () => clearTimeout(t)
  }, [step, a])

  const C = Math.max(0, 100 - a.shareA - Math.min(a.shareB, 100 - a.shareA))
  const monthly = Number(a.motoMonthly.replace(/[^\d]/g, ''))
  const perMinute = monthly > 0 && Number(a.motoHours) > 0 ? Math.round(monthly / (Number(a.motoHours) * 60)) : null

  return (
    <details className="panel guided" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>
        <span className="data-title">Modo guiado</span>
        <span className="data-sub">Cinco preguntas y te digo si una van se paga y cuánto cuestan tus novedades</span>
      </summary>
      <div className="data-body">
        <ol className="steps" aria-label="Pasos">
          {[...STEPS, 'Resultado'].map((s, i) => (
            <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}><button onClick={() => i <= step && setStep(i)} disabled={i > step} aria-current={i === step ? 'step' : undefined}>{i + 1}. {s}</button></li>
          ))}
        </ol>

        {step === 0 && (
          <>
            <h3>¿Desde dónde despachas?</h3>
            <div className="picks">
              {CEDIS.map((c) => (
                <button key={c.id} className="pick" aria-pressed={a.cedi === c.id} onClick={() => set('cedi', c.id)}>
                  <b>{c.name}</b><span>{c.note}</span>
                </button>
              ))}
            </div>
            <p className="hint">Es la bodega a la que vuelven los paquetes que no se entregan.</p>
          </>
        )}

        {step === 1 && (
          <>
            <h3>¿Cuánto despachas?</h3>
            <Pick label="Paquetes por día" value={a.volume} min={150} max={1200} step={50} out={String(a.volume)} onChange={(v) => set('volume', v)} />
            <Pick label="Motos en calle" value={a.fleet} min={3} max={80} step={1} out={String(a.fleet)} onChange={(v) => set('fleet', v)} />
          </>
        )}

        {step === 2 && (
          <>
            <h3>¿Cuántos no se entregan al primer intento?</h3>
            <Pick label="Tasa de novedad" value={a.rate} min={2} max={40} step={1} out={`${a.rate}%`} onChange={(v) => set('rate', v)} hint="Paquetes que no se entregan al primer intento, entre todos los que despachas." />
            <div className="seg two" role="group" aria-label="Qué tan segura es la cifra">
              <button aria-pressed={a.measured} onClick={() => set('measured', true)}>La he medido</button>
              <button aria-pressed={!a.measured} onClick={() => set('measured', false)}>Es una estimación</button>
            </div>
            <p className="hint">Esto solo ensancha el rango del resultado: una estimación admite más margen de error que una cifra medida.</p>
          </>
        )}

        {step === 3 && (
          <>
            <h3>¿Por qué fallan?</h3>
            <Pick label="Cliente ausente, no contesta, dirección no encontrada" value={a.shareA} min={5} max={90} step={5} out={`${a.shareA}%`} onChange={(v) => set('shareA', v)} hint="Un segundo intento tiene sentido (A)." />
            <Pick label="Rechaza el pedido o no tiene efectivo" value={Math.min(a.shareB, 100 - a.shareA)} min={0} max={90} step={5} out={`${Math.min(a.shareB, 100 - a.shareA)}%`} onChange={(v) => set('shareB', v)} hint="Se puede intentar liquidar en el lugar (B)." />
            <p className="hint">El resto, <b>{C}%</b>, son averías o cambios: vuelven al CEDI (C).</p>
            <Pick label="De los que se reintentan (A), ¿cuántos se entregan?" value={a.retry} min={10} max={95} step={5} out={`${a.retry}%`} onChange={(v) => set('retry', v)} hint="Si no lo sabes, deja 60%: es lo que usa la demo. Es una de las cifras que más mueve el resultado." />
          </>
        )}

        {step === 4 && (
          <>
            <h3>¿Cuánto cuesta cada cosa?</h3>
            <Pick label="Valor promedio de un pedido" value={a.cod} min={40} max={400} step={5} out={cop(a.cod * 1000)} onChange={(v) => set('cod', v)} />
            <Pick label="Operar una van un día" value={a.vanCost} min={10} max={80} step={1} out={cop(a.vanCost * 10000)} onChange={(v) => set('vanCost', v)} hint="Conductor, combustible y vehículo." />
            <div className="map-grid">
              <label className="map-row"><span>Costo mensual de una moto (opcional)</span><input inputMode="numeric" value={a.motoMonthly} onChange={(e) => set('motoMonthly', e.target.value)} placeholder="Sueldo, prestaciones y combustible" /></label>
              <label className="map-row"><span>Horas efectivas al mes</span><input inputMode="numeric" value={a.motoHours} onChange={(e) => set('motoHours', e.target.value)} /></label>
            </div>
            <p className="hint">{perMinute ? <>Cada minuto de una moto te cuesta unos <b>${perMinute}</b>. Ese número decide si conviene que la van recorra a las motos o intercepte fallos.</> : 'Si lo dejas vacío uso $300 por minuto, un valor de ejemplo.'}</p>
          </>
        )}

        {step === STEPS.length && (
          <Result outcome={outcome} onApply={() => outcome && onApply(withConfig(outcome.p, outcome.best.config === 'none' ? 'intercept' : outcome.best.config, outcome.best.vans || 1))} onCsv={onCsv} />
        )}

        <div className="data-actions">
          {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}>Atrás</button>}
          {step < STEPS.length && <button className="btn" onClick={() => setStep(step + 1)}>{step === STEPS.length - 1 ? 'Ver resultado' : 'Siguiente'}</button>}
          {step === STEPS.length && <button className="btn ghost" onClick={() => setStep(0)}>Cambiar mis respuestas</button>}
        </div>
      </div>
    </details>
  )
}

function Result({ outcome, onApply, onCsv }: { outcome: Outcome | null; onApply: () => void; onCsv: () => void }) {
  if (!outcome) return <p className="hint" role="status">Calculando con tus respuestas…</p>
  const { p, best, range, cost, onePoint, top } = outcome
  const failures = Math.round(p.volume * p.failureRate)
  return (
    <div className="g-result">
      <h3>Con lo que me contaste</h3>
      <p className="g-line">
        Tus <b>{failures} novedades al día</b> cuestan unos <b>{cop(cost.perDay)}</b> (cerca de {cop(cost.perFailure)} cada una: flete de ida y vuelta, manejo y la parte del margen que se pierde).
        Bajar la tasa de novedad un punto ahorraría unos <b>{cop(onePoint)}</b> al día.
      </p>
      {best.config === 'none' ? (
        <p className="g-line"><b>Con estos números ninguna configuración de van se paga.</b> Lo que más ayudaría es reducir las novedades antes de que ocurran.</p>
      ) : (
        <p className="g-line">
          La mejor opción simulada: <b>{best.vans} van{best.vans === 1 ? '' : 's'}</b> donde {CONFIG_LABEL[best.config]}, con un neto de unos <b>{copSigned(best.net)} al día</b>
          {range && <> (entre {copSigned(range[0])} y {copSigned(range[1])} si tu tasa de novedad o tu éxito de reintento difieren de lo que escribiste)</>}.
        </p>
      )}
      <div className="mode-row head"><span>Vans</span><span>Intercepta</span><span>Recorre</span><span>Recorre, solo pendientes</span></div>
      {best.rows.map((r) => (
        <div className="mode-row" key={r.vans}>
          <span>{r.vans}</span>
          {([r.intercept, r.rounds, r.roundsPending] as const).map((m, i) => <span key={i} className={`n ${m.net === best.net && best.config !== 'none' ? 'win' : ''}`}>{copSigned(m.net)}</span>)}
        </div>
      ))}
      <p className="hint">Neto por día: lo recuperado menos el costo de las vans y de los desvíos de las motos.</p>
      {top.length > 0 && <p className="hint">Lo que más mueve este resultado: <b>{top.join(', ')}</b>. Son los datos que conviene medir primero.</p>}
      <p className="hint warn-soft">Esto es una simulación con cifras que tú escribiste y supuestos de la demo, no una predicción para tu operación.</p>
      <div className="data-actions">
        <button className="btn" onClick={onApply}>Explorar esto en el simulador completo</button>
        <button className="btn ghost" onClick={onCsv}>Afinar con mi archivo CSV</button>
      </div>
    </div>
  )
}
