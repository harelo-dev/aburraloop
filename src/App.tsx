import { useMemo, useState } from 'react'
import { Analysis, OBJECTIVE_LABEL } from './Analysis'
import { DataPanel, type Applied } from './DataPanel'
import { Tendency } from './Tendency'
import { Guided } from './Guided'
import { ScenarioSummary } from './ScenarioSummary'
import { Levers } from './Levers'
import type { Report } from './data/ingest'
import { MapView } from './MapView'
import { ASSUMPTIONS, defaultParams, simulate, type Mode, type Objective, type Params, type Placement } from './sim/simulate'
import { cop, dec } from './format'
import travel from './data/travel.json'

const CEDIS = [
  { id: 'sur', name: 'CEDI Sur · Sabaneta' },
  { id: 'centro', name: 'CEDI Centro · Guayabal' },
  { id: 'gir', name: 'CEDI Girardota' },
] as const

function Slider(props: { id: string; label: string; value: number; min: number; max: number; step: number; out: string; onChange: (v: number) => void }) {
  return (
    <div className="ctl">
      <label htmlFor={props.id}>{props.label}<output>{props.out}</output></label>
      <input id={props.id} type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(+e.target.value)} />
    </div>
  )
}

export function App() {
  const [p, setP] = useState<Params>(defaultParams)
  const [dataInfo, setDataInfo] = useState<{ used: number; days: number } | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [showRates, setShowRates] = useState(false)
  const [guidedOpen, setGuidedOpen] = useState(true)
  const [csvOpen, setCsvOpen] = useState(false)
  const [origin, setOrigin] = useState<'demo' | 'guided'>('demo')
  /** Moving one cause keeps the three shares adding up to 100%: the other cause gives way before the returns do. */
  const setShare = (which: 'A' | 'B', v: number) => {
    setP((o) => {
      const other = which === 'A' ? o.gradeShare.B : o.gradeShare.A
      const o2 = Math.min(other, 1 - v)
      const A = which === 'A' ? v : o2
      const B = which === 'B' ? v : o2
      return { ...o, gradeShare: { A, B, C: Math.max(0, 1 - A - B) } }
    })
  }
  const useData = (a: Applied, summary: { used: number; days: number }) => {
    setP((o) => ({ ...o, data: a.data, ...a.patch, placement: o.placement === 'trend' && !a.data.exposure ? 'history' : o.placement }))
    setDataInfo(summary)
    setReport(a.report)
    setShowRates(a.report.rates?.level === 'cell')
    setCsvOpen(false)
    setGuidedOpen(false)
  }
  const useGuided = (guided: Params) => {
    setP({ ...guided, data: undefined })
    setOrigin('guided')
    setGuidedOpen(false)
    requestAnimationFrame(() => document.querySelector('.grid')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }))
  }
  const csvFromGuided = () => {
    setGuidedOpen(false)
    setCsvOpen(true)
  }
  const clearData = () => {
    setP((o) => ({ ...o, data: undefined, placement: o.placement === 'trend' ? 'history' : o.placement }))
    setDataInfo(null)
    setReport(null)
    setShowRates(false)
  }
  const set = <K extends keyof Params>(k: K, v: Params[K]) => setP((o) => ({ ...o, [k]: v }))
  const r = useMemo(() => simulate(p), [p])
  const net = r.net
  const pct = r.failed ? (r.saved / r.failed) * 100 : 0
  const bars = [
    { name: 'Tradicional: vuelven al CEDI', n: r.failed, color: 'var(--loss)' },
    { name: `Con ${p.vans} van${p.vans === 1 ? '' : 's'}: vuelven al CEDI`, n: r.returned, color: 'var(--loss)' },
    { name: `Con ${p.vans} van${p.vans === 1 ? '' : 's'}: salvados en calle`, n: r.saved, color: 'var(--accent)' },
  ]

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>Aburrá<span>Loop</span></h1>
          <p className="tag">Cuánto cuesta devolver al CEDI lo que no se entregó, y cuánto se rescata si una mini-van lo intercepta en la calle el mismo día.</p>
        </div>
        <span className="demo">{dataInfo ? `TUS DATOS · ${dataInfo.used} fallos · tiempos de viaje por carretera` : 'DEMO · datos sintéticos · tiempos de viaje por carretera'}</span>
      </header>

      {!dataInfo && <Guided open={guidedOpen} onToggle={setGuidedOpen} onApply={useGuided} onCsv={csvFromGuided} />}
      <DataPanel active={dataInfo} volume={p.volume} open={csvOpen} onToggle={setCsvOpen} onApply={useData} onClear={clearData} />

      <div className="grid">
        <aside className="panel" aria-label="Parámetros">
          <h2>Tu operación</h2>
          <div className="ctl">
            <label htmlFor="cedi">CEDI base</label>
            <select id="cedi" value={p.cedi} onChange={(e) => set('cedi', e.target.value as Params['cedi'])}>
              {CEDIS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <Slider id="vol" label="Despachos al día" value={p.volume} min={150} max={1200} step={50} out={String(p.volume)} onChange={(v) => set('volume', v)} />
          <Slider id="fleet" label="Motorizados en calle" value={p.fleet} min={3} max={80} step={1} out={String(p.fleet)} onChange={(v) => set('fleet', v)} />
          <Slider id="rate" label="Tasa de novedad / fallo COD" value={Math.round(p.failureRate * 100)} min={2} max={40} step={1} out={`${Math.round(p.failureRate * 100)}%`} onChange={(v) => set('failureRate', v / 100)} />
          <div className="ctl">
            <span className="lbl">Mini-vans pivote</span>
            <div className="seg" role="group" aria-label="Mini-vans">
              {([0, 1, 2, 3] as const).map((v) => (
                <button key={v} aria-pressed={p.vans === v} onClick={() => set('vans', v)}>{v}</button>
              ))}
            </div>
            <p className="hint">0 = modelo tradicional.</p>
          </div>
          <div className="ctl">
            <label htmlFor="mode">Cómo opera la van</label>
            <select id="mode" value={p.mode} disabled={p.vans === 0} onChange={(e) => set('mode', e.target.value as Mode)}>
              <option value="intercept">Intercepta fallos en la calle</option>
              <option value="rounds">Recorre a las motos (AM y PM) y es el punto de cierre</option>
            </select>
            {p.mode === 'rounds' && (
              <label className="check" htmlFor="skip">
                <input id="skip" type="checkbox" checked={p.skipEmptyVisits} onChange={(e) => set('skipEmptyVisits', e.target.checked)} />
                Visitar solo a las motos con algo pendiente
              </label>
            )}
          </div>
          <div className="ctl">
            <label htmlFor="placement">Dónde van las vans</label>
            <select id="placement" value={p.placement} disabled={p.vans === 0} onChange={(e) => set('placement', e.target.value as Placement)}>
              <option value="history">Según fallos de días previos</option>
              <option value="trend" disabled={!p.data?.exposure}>Según tendencia de novedad{p.data?.exposure ? '' : ' (pide entregas y fallos)'}</option>
              <option value="zones">Fijas por zona</option>
              <option value="hindsight">Con conocimiento del día (techo)</option>
            </select>
          </div>
          <div className="ctl">
            <label htmlFor="objective">Criterio de ubicación</label>
            <select id="objective" value={p.objective} disabled={p.vans === 0 || p.mode === 'rounds'} onChange={(e) => set('objective', e.target.value as Objective)}>
              {(['value', 'density', 'reach'] as const).map((o) => <option key={o} value={o}>{OBJECTIVE_LABEL[o]}</option>)}
            </select>
          </div>
          <h2 className="sep">Supuestos que tú ajustas</h2>
          <Slider id="mins" label={p.mode === 'rounds' ? 'Tiempo máx. van ↔ moto' : 'Tiempo máx. van → paquete'} value={p.maxMinutes} min={10} max={45} step={5} out={`${p.maxMinutes} min`} onChange={(v) => set('maxMinutes', v)} />
          <p className="hint tight">La zona verde del mapa es lo que cada van alcanza por carretera en ese tiempo.</p>
          <Slider id="minCedi" label="Distancia mínima van → CEDI" value={p.minCediMinutes} min={0} max={20} step={5} out={p.minCediMinutes ? `${p.minCediMinutes} min` : 'sin límite'} onChange={(v) => set('minCediMinutes', v)} />
          <p className="hint tight">Una van pegada al CEDI no intercepta nada que el CEDI no reciba igual. La zona gris del mapa no admite vans.</p>
          <Slider id="marginLoss" label="Margen que se pierde si vuelve al CEDI" value={Math.round(p.marginLossShare * 100)} min={10} max={100} step={10} out={`${Math.round(p.marginLossShare * 100)}%`} onChange={(v) => set('marginLossShare', v / 100)} />
          <p className="hint tight">Un paquete devuelto puede reofrecerse. Solo cuenta la parte de la venta que se pierde.</p>
          <Slider id="detour" label="Costo del desvío de la moto" value={p.detourCopPerMin} min={0} max={1500} step={50} out={`$${p.detourCopPerMin}/min`} onChange={(v) => set('detourCopPerMin', v)} />
          <p className="hint tight">Lo que cuesta cada minuto que una moto se desvía hacia la van, ida y vuelta. Más caro, más conviene tener la van cerca de la concentración.</p>
          <Slider id="shareA" label="Fallos por cliente ausente o sin respuesta (A)" value={Math.round(p.gradeShare.A * 100)} min={5} max={90} step={5} out={`${Math.round(p.gradeShare.A * 100)}%`} onChange={(v) => setShare('A', v / 100)} />
          <Slider id="shareB" label="Fallos por rechazo o sin efectivo (B)" value={Math.round(p.gradeShare.B * 100)} min={0} max={90} step={5} out={`${Math.round(p.gradeShare.B * 100)}%`} onChange={(v) => setShare('B', v / 100)} />
          <p className="hint tight">El resto ({Math.round(p.gradeShare.C * 100)}%) son averías o cambios (C): vuelven al CEDI.</p>
          <Slider id="cod" label="Valor promedio del pedido" value={Math.round(p.codAverage / 1000)} min={40} max={400} step={5} out={cop(p.codAverage)} onChange={(v) => set('codAverage', v * 1000)} />
          <Slider id="vanCost" label="Costo de una van por día" value={Math.round(p.vanCostCopPerDay / 10000)} min={10} max={80} step={1} out={cop(p.vanCostCopPerDay)} onChange={(v) => set('vanCostCopPerDay', v * 10000)} />
          <Slider id="pB" label="Éxito de la liquidación flash (Grado B)" value={Math.round(p.gradeBSuccess * 100)} min={10} max={95} step={5} out={`${Math.round(p.gradeBSuccess * 100)}%`} onChange={(v) => set('gradeBSuccess', v / 100)} />
          <Slider id="p2" label="Éxito del 2.º intento (Grado A)" value={Math.round(p.secondAttemptSuccess * 100)} min={10} max={95} step={5} out={`${Math.round(p.secondAttemptSuccess * 100)}%`} onChange={(v) => set('secondAttemptSuccess', v / 100)} />
          <button className="reroll" onClick={() => set('seed', (p.seed * 31 + 11) % 100000)}>Simular otro día</button>
        </aside>

        <section className="main">
          <div className="kpis" aria-live="polite">
            <div className="kpi"><div className="k">Retorno físico evitado</div><div className="v good">{pct.toFixed(0)}%</div><div className="s">{r.saved} de {r.failed} fallidos</div></div>
            <div className="kpi"><div className="k">Capital recuperado / día</div><div className={`v ${net >= 0 ? 'good' : 'bad'}`}>{cop(r.recovered)}</div><div className="s">{p.vans ? `${p.mode === 'rounds' ? `neto, con ahorro de cierre ${cop(r.tripSaving)}` : 'neto de vans y desvíos'}: ${net < 0 ? '−' : ''}${cop(Math.abs(net))}` : 'sin vans no hay rescate'}</div></div>
            <div className="kpi"><div className="k">Costo de las vans / día</div><div className="v">{cop(r.vanCost)}</div><div className="s">{p.vans} × {cop(p.vanCostCopPerDay)}{p.mode === 'rounds' ? ` · visitas ${r.visits.done}/${r.visits.done + r.visits.skipped}` : ` · desvíos ${cop(r.detourCost)}`}</div></div>
            <div className="kpi"><div className="k">Peso muerto por moto</div><div className="v">{dec(r.deadWeightWithVans)}</div><div className="s">antes {dec(r.deadWeightTraditional)} pq/moto</div></div>
          </div>

          <div className="panel mapbox">
            {report?.rates?.level === 'cell' && (
              <div className="seg map-toggle" role="group" aria-label="Qué mostrar en el mapa">
                <button aria-pressed={!showRates} onClick={() => setShowRates(false)}>Fallos simulados</button>
                <button aria-pressed={showRates} onClick={() => setShowRates(true)}>Tasa de novedad por zona</button>
              </div>
            )}
            <MapView result={r} params={p} rateCells={report?.rates?.cells} overall={report?.rates?.overall} showRates={showRates} />
            <div className="legend">
              <span><i style={{ background: 'var(--accent)' }} />Salvado en calle</span>
              <span><i style={{ background: 'var(--loss)' }} />Retorno forzoso al CEDI</span>
              {p.mode === 'rounds'
                ? <span><i className="ring" />Moto (centro de su zona)</span>
                : <span><i className="line" style={{ background: 'var(--loss)', opacity: 0.5 }} />Viaje de peso muerto (línea recta, ilustrativa)</span>}
              <span><i className="sq" />Zona que alcanzan las vans</span>
              <span><i className="sq gray" />Sin vans: demasiado cerca del CEDI</span>
              {showRates && <span><i className="grad" />Tasa de novedad: menor → mayor que la general (zonas con 5+ entregas)</span>}
            </div>
          </div>

          <div className="panel">
            <h2>Tradicional vs. con nodos móviles</h2>
            <div className="cmp">
              {bars.map((b) => (
                <div className="row" key={b.name}>
                  <span className="name">{b.name}</span>
                  <div className="bar"><b style={{ width: `${r.failed ? (b.n / r.failed) * 100 : 0}%`, background: b.color }} /></div>
                  <span className="n">{b.n} pq</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h2>Supuestos del modelo</h2>
            <div className="assume">
              <div>Mezcla de fallos: <b>{Math.round(p.gradeShare.A * 100)}% A · {Math.round(p.gradeShare.B * 100)}% B · {Math.round(p.gradeShare.C * 100)}% C</b></div>
              <div>Éxito Grado B (flash): <b>{Math.round(p.gradeBSuccess * 100)}%</b></div>
              <div>Margen A / B: <b>28% / 12% del COD</b>, de lo cual se pierde <b>{Math.round(p.marginLossShare * 100)}%</b> al volver</div>
              <div>Desvío de la moto: <b>${p.detourCopPerMin}/min</b>, ida y vuelta a la van</div>
              <div>Flete ahorrado: <b>${ASSUMPTIONS.freightCopPerKm}/km ida y vuelta + ${ASSUMPTIONS.handlingCop / 1000}k manejo</b></div>
              <div>Costo por van/día: <b>{cop(p.vanCostCopPerDay)}</b></div>
              <div>Capacidad por van: <b>{ASSUMPTIONS.vanCapacity} paquetes/día</b></div>
              <div>Tiempos de viaje: <b>{travel.cells.length} celdas de ~1 km, OSRM (carro)</b></div>
              <div>Operación: <b>{p.mode === 'rounds' ? `la van visita a cada moto a las ${ASSUMPTIONS.amWindow[0]}–${ASSUMPTIONS.amWindow[1]} y ${ASSUMPTIONS.pmWindow[0]}–${ASSUMPTIONS.pmWindow[1]} h, ${ASSUMPTIONS.handoffMinutes} min por visita` : 'intercepta fallos dentro de su alcance'}</b></div>
              <div>Reintento: <b>éxito pleno si llega a la van antes de las {ASSUMPTIONS.attemptFullUntil} h, nulo desde las {ASSUMPTIONS.attemptNoneFrom} h</b></div>
              <div>Van a ≥ <b>{p.minCediMinutes ? `${p.minCediMinutes} min` : '0 (sin límite)'}</b> del CEDI</div>
              <div>Ubicación de vans: <b>{p.placement === 'zones' ? 'fija por zona' : p.placement === 'history' ? 'según fallos de 10 días previos' : 'según los fallos del día (techo)'} · {OBJECTIVE_LABEL[p.objective].toLowerCase()}</b></div>
            </div>
          </div>
        </section>
      </div>

      {report?.rates && dataInfo && <Tendency rates={report.rates} days={dataInfo.days} />}

      <Analysis params={p} />

      <Levers params={p} report={report} />

      <ScenarioSummary params={p} origin={dataInfo ? 'archivo propio' : origin === 'guided' ? 'estimaciones del modo guiado' : 'valores de la demo'} report={report} />

      <details className="privacy">
        <summary>Privacidad: qué pasa con lo que escribes y cargas</summary>
        <ul>
          <li>Este sitio no tiene servidor propio: <b>no recoge, no guarda y no envía</b> lo que escribes ni los archivos que cargas. Todo se calcula en tu navegador.</li>
          <li>Tu navegador sí se conecta a terceros para mostrar la página: GitHub Pages (el sitio), OpenFreeMap y OpenStreetMap (el mapa) y Google Fonts (las tipografías). Ellos ven tu dirección IP, como en cualquier página web.</li>
          <li>Solo si activas «ubicar las direcciones», las direcciones de los fallos se envían a Nominatim (OpenStreetMap). Se recuerdan en este navegador hasta que las borres.</li>
          <li>El resumen del escenario es para que lo veas y lo copies. No se envía a ningún lado.</li>
        </ul>
      </details>

      <footer>
        {dataInfo
          ? 'Simulación con los fallos de tu archivo, ubicados en una malla de ~1 km. Los demás supuestos (costos, capacidad, margen) siguen siendo los de la demo. Es una estimación, no una predicción.'
          : 'Simulación con datos sintéticos, no una predicción para una operación concreta. Con datos reales de novedades, el mismo modelo da una estimación propia.'}
        {' '}<a href="https://github.com/harelo-dev/aburraloop">Código en GitHub</a> · MIT
      </footer>
    </div>
  )
}
