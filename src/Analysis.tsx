import { useDeferredValue, useMemo } from 'react'
import {
  ANALYSIS_DAYS, VOLUME_POINTS, breakEvenVolume, marginalVolume, modeComparison, placementComparison, sensitivity, vansCurve, volumeCurve,
  type PlacementRow, type VolumePoint,
} from './sim/analysis'
import { ASSUMPTIONS, type Objective, type Params } from './sim/simulate'
import { cop, copSigned } from './format'

export const OBJECTIVE_LABEL: Record<Objective, string> = {
  reach: 'Mayor alcance',
  value: 'Mayor valor neto',
  density: 'Concentración de paquetes',
}
const rowLabel = (id: PlacementRow['id'], objective: Objective, rounds: boolean) =>
  id === 'trend' ? 'Tendencia de novedad (tasa suavizada)'
    : rounds && id === 'history-density' ? 'Historial · concentración de motos'
    : id === 'zones' ? 'Fijas por zona (Norte, Centro, Sur)'
    : id === 'hindsight' ? `Con conocimiento del día (techo)${rounds ? '' : ` · ${OBJECTIVE_LABEL[objective].toLowerCase()}`}`
      : `Historial · ${OBJECTIVE_LABEL[id.slice(8) as Objective].toLowerCase()}`
const lc = (t: string) => t.charAt(0).toLowerCase() + t.slice(1)
const SERIES_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)']

function VolumeChart({ points, current }: { points: VolumePoint[]; current: number }) {
  const W = 520, H = 260, L = 58, R = 46, T = 14, B = 36
  const all = points.flatMap((p) => p.net)
  const hi = Math.max(...all, 0), lo = Math.min(...all, 0)
  const step = [250_000, 500_000, 1_000_000, 2_000_000].find((s) => (hi - lo) / s <= 6) ?? 2_000_000
  const yMin = Math.floor(lo / step) * step, yMax = Math.ceil(hi / step) * step
  const x = (v: number) => L + ((v - VOLUME_POINTS[0]) / (VOLUME_POINTS[VOLUME_POINTS.length - 1] - VOLUME_POINTS[0])) * (W - L - R)
  const y = (v: number) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B)
  const ticks: number[] = []
  for (let v = yMin; v <= yMax + 1; v += step) ticks.push(v)
  // End labels sit at the last point of each line; where the lines converge they are pushed apart so none overlaps.
  const lastNet = points[points.length - 1].net
  const labelY = [0, 1, 2].map((s) => y(lastNet[s]))
  const order = [0, 1, 2].sort((a, b) => labelY[a] - labelY[b])
  for (let i = 1; i < order.length; i++) labelY[order[i]] = Math.max(labelY[order[i]], labelY[order[i - 1]] + 13)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Neto por día según despachos diarios, para 1, 2 y 3 vans">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t === 0 ? 'zero' : 'grid'} />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" className="tick">{t === 0 ? '0' : `${t < 0 ? '−' : ''}$${(Math.abs(t) / 1e6).toFixed(Math.abs(t) % 1e6 ? 2 : 0).replace('.', ',')} M`}</text>
        </g>
      ))}
      {[150, 450, 750, 1050].map((v) => <text key={v} x={x(v)} y={H - 16} textAnchor="middle" className="tick">{v}</text>)}
      <text x={(L + W - R) / 2} y={H - 2} textAnchor="middle" className="tick">despachos por día</text>
      <line x1={x(current)} x2={x(current)} y1={T} y2={H - B} className="now" />
      <text x={x(current)} y={T + 9} textAnchor={current > 900 ? 'end' : 'start'} dx={current > 900 ? -4 : 4} className="tick now-t">tu volumen</text>
      {[0, 1, 2].map((s) => {
        const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.volume).toFixed(1)},${y(p.net[s]).toFixed(1)}`).join(' ')
        const last = points[points.length - 1]
        return (
          <g key={s}>
            <path d={d} fill="none" stroke={SERIES_COLORS[s]} strokeWidth="2.2" strokeLinejoin="round" />
            <text x={x(last.volume) + 6} y={labelY[s] + 4} fill={SERIES_COLORS[s]} className="end-label">{s + 1} van{s ? 's' : ''}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function Analysis({ params }: { params: Params }) {
  const deferred = useDeferredValue(params)
  const stale = deferred !== params
  const vans = deferred.vans > 0 ? deferred.vans : 2
  const base = useMemo(() => ({ ...deferred, vans: vans as Params['vans'] }), [deferred, vans])

  const curve = useMemo(() => vansCurve(base), [base])
  const volume = useMemo(() => volumeCurve(base), [base])
  const placements = useMemo(() => placementComparison(base), [base])
  const modes = useMemo(() => modeComparison(base), [base])
  const sens = useMemo(() => sensitivity(base), [base])

  const bestN = curve.reduce((b, m, i) => (m.net > curve[b].net ? i : b), 0)
  const perRescue = curve[1].saved ? (curve[1].recovered - curve[1].detourCost) / curve[1].saved : 0
  const rescuesToPay = perRescue ? deferred.vanCostCopPerDay / perRescue : 0
  const maxNet = Math.max(...curve.map((m) => m.net), 1)
  const maxAbs = Math.max(...sens.rows.flatMap((r) => [Math.abs(r.lowDelta), Math.abs(r.highDelta)]), 1)
  const rowFor = (id: PlacementRow['id']) => placements.find((r) => r.id === id)!
  const zones = rowFor('zones'), hind = rowFor('hindsight')
  const rounds = deferred.mode === 'rounds'
  const trendRow = placements.find((r) => r.id === 'trend')
  const hist = (['reach', 'value', 'density'] as const).map((o) => placements.find((r) => r.id === `history-${o}`))
  const histNow = rounds ? rowFor('history-density') : rowFor(`history-${deferred.objective}`)
  const selectedId: PlacementRow['id'] = deferred.placement === 'zones' ? 'zones' : deferred.placement === 'hindsight' ? 'hindsight' : deferred.placement === 'trend' ? 'trend' : rounds ? 'history-density' : `history-${deferred.objective}`
  const be = [0, 1, 2].map((s) => breakEvenVolume(volume, s))
  const m2 = marginalVolume(volume, 1), m3 = marginalVolume(volume, 2)
  const fmtV = (v: number | null) => (v === null ? '' : `~${Math.round(v / 10) * 10}`)

  return (
    <section className="analysis" aria-label="Análisis" data-stale={stale}>
      <div className="an-head">
        <h2>Análisis</h2>
        <p className="hint">Promedio de {ANALYSIS_DAYS} días simulados con tus parámetros actuales{deferred.vans === 0 ? ' (con 2 vans, porque elegiste 0)' : ''}. Las cifras son netas del costo de las vans y de los desvíos de las motos.</p>
      </div>

      <div className="an-grid">
        <div className="panel wide">
          <h3>¿Intercepta o recorre?</h3>
          <div className="mode-row head"><span>Vans</span><span>Intercepta en la calle</span><span>Recorre AM y PM</span><span>Recorre, solo con pendientes</span></div>
          {modes.map((m) => {
            const best = Math.max(m.intercept.net, m.rounds.net, m.roundsPending.net)
            const cell = (mean: typeof m.intercept) => (
              <span className={`n ${mean.net === best ? 'win' : ''}`}>{copSigned(mean.net)} · {mean.savedPct.toFixed(0)}%</span>
            )
            return (
              <div className="mode-row" key={m.vans}>
                <span>{m.vans} van{m.vans === 1 ? '' : 's'}</span>
                {cell(m.intercept)}{cell(m.rounds)}{cell(m.roundsPending)}
              </div>
            )
          })}
          <p className="take">
            Neto por día y % de fallos salvados, en negrita el mejor de cada fila. Intercepta recibe el fallo apenas ocurre, pero la moto se desvía hacia la van. Recorre ahorra ese desvío y el regreso al CEDI al cierre ({copSigned(modes[1].rounds.tripSaving)} al día con 2 vans), pero entrega el paquete a la van más tarde, y un reintento tardío funciona menos. Además una van no alcanza a visitar a todas las motos en la ventana: con pocas vans y muchas motos, algunas se quedan sin visita.
          </p>
        </div>

        <div className="panel">
          <h3>¿Cuántas vans conviene?</h3>
          <div className="cmp">
            {curve.map((m, i) => (
              <div className={`row2 ${i === bestN ? 'best' : ''}`} key={i}>
                <span className="name">{i} van{i === 1 ? '' : 's'}{i === bestN ? ' · mejor' : ''}</span>
                <div className="bar"><b style={{ width: `${Math.max(0, m.net) / maxNet * 100}%`, background: i === bestN ? 'var(--accent)' : 'var(--muted)' }} /></div>
                <span className="n">{copSigned(m.net)}</span>
              </div>
            ))}
          </div>
          <p className="take">
            {bestN === 0
              ? 'Con estos parámetros ninguna van cubre su costo.'
              : <>Con estos parámetros conviene <b>{bestN} van{bestN === 1 ? '' : 's'}</b>: {copSigned(curve[bestN].net)} netos al día.
                {bestN < 3 && <> Una más cambiaría el neto en {copSigned(curve[bestN + 1].net - curve[bestN].net)}.</>}
                {' '}Cada van se paga con unos <b>{Math.ceil(rescuesToPay)}</b> paquetes rescatados al día.</>}
          </p>
        </div>

        <div className="panel">
          <h3>Punto de equilibrio</h3>
          <VolumeChart points={volume} current={deferred.volume} />
          <ul className="take list">
            {[0, 1, 2].map((s) => (
              <li key={s}><i style={{ background: SERIES_COLORS[s] }} />{s + 1} van{s ? 's' : ''}: {be[s] === null ? <>no se pagan con 150 a 1.200 despachos al día</> : <>se pagan desde <b>{fmtV(be[s])}</b> despachos al día</>}</li>
            ))}
          </ul>
          <p className="take">
            {m2 === null ? <>La 2.ª van no supera a la 1.ª con 150 a 1.200 despachos al día</> : <>La 2.ª van supera a la 1.ª desde <b>{fmtV(m2)}</b> despachos al día</>}
            {' '}y {m3 === null ? <>la 3.ª no supera a la 2.ª en ese rango</> : <>la 3.ª supera a la 2.ª desde <b>{fmtV(m3)}</b></>}, con {Math.round(deferred.failureRate * 100)}% de novedad.
            {(m2 !== null || m3 !== null) && ' Por debajo de ese volumen, lo que rescata la van adicional no cubre su costo.'}
          </p>
        </div>

        <div className="panel">
          <h3>¿Dónde poner {vans === 1 ? 'la van' : `las ${vans} vans`}?</h3>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Estrategia</th><th>Salvados</th><th>Neto / día</th><th>Ubicación</th></tr></thead>
              <tbody>
                {placements.map((r) => (
                  <tr key={r.id} className={r.id === selectedId ? 'sel' : ''}>
                    <td>{rowLabel(r.id, deferred.objective, deferred.mode === 'rounds')}</td>
                    <td>{r.mean.savedPct.toFixed(0)}%</td>
                    <td>{copSigned(r.mean.net)}</td>
                    <td>{r.sites.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rounds ? (
            <>
              <p className="take">
                Frente a zonas fijas, ubicar por historial da <b>{copSigned(histNow.mean.net - zones.mean.net)}</b> al día.
                Conocer el día de antemano sumaría {copSigned(hind.mean.net - histNow.mean.net)}.
              </p>
              <ul className="take list plain">
                <li>En recorridos, las vans se ubican donde se concentran las motos (mismo criterio de concentración), porque ahí empieza cada ronda y ahí cierran las motos.</li>
                {deferred.minCediMinutes > 0 && <li>Ninguna van queda a menos de {deferred.minCediMinutes} min del CEDI.</li>}
              </ul>
            </>
          ) : (
            <>
              <p className="take">
                Frente a zonas fijas, ubicar por historial da <b>{copSigned(hist[0]!.mean.net - zones.mean.net)}</b> al día con mayor alcance, <b>{copSigned(hist[1]!.mean.net - zones.mean.net)}</b> con mayor valor neto y <b>{copSigned(hist[2]!.mean.net - zones.mean.net)}</b> con concentración de paquetes.
                Conocer el día de antemano sumaría {copSigned(hind.mean.net - histNow.mean.net)} sobre el criterio elegido.
              </p>
              <ul className="take list plain">
                <li><b>Mayor alcance:</b> cada van va donde cubre más valor que ninguna otra cubre ya.</li>
                <li><b>Mayor valor neto:</b> suma la capacidad de la van ({ASSUMPTIONS.vanCapacity} paquetes) y el desvío de la moto, que cuesta ${deferred.detourCopPerMin} por minuto.</li>
                <li><b>Concentración:</b> minimiza el tiempo total de carretera hasta los paquetes, contando paquetes y no pesos. Un paquete que ninguna van alcanza cuenta como el doble del alcance ({deferred.maxMinutes} min): mientras queden paquetes fuera de alcance, la van nueva va hacia ellos, y solo cuando todo se alcanza se parte el núcleo denso.</li>
                {deferred.minCediMinutes > 0 && <li>Ninguna van queda a menos de {deferred.minCediMinutes} min del CEDI.</li>}
              </ul>
            </>
          )}
          {trendRow && (
            <p className="take">
              Ubicar por <b>tendencia de novedad</b> (entregas por zona y su tasa suavizada) da {copSigned(trendRow.mean.net - histNow.mean.net)} al día frente a ubicar por los fallos del historial. Con pocos días de datos la tendencia suavizada es más estable que el conteo crudo; con muchos, tienden a coincidir.
            </p>
          )}
        </div>

        <div className="panel">
          <h3>Sensibilidad: ¿qué supuesto mueve más el resultado?</h3>
          <div className="tor">
            {sens.rows.map((r) => (
              <div className="tor-row" key={r.label}>
                <div className="tor-label">{r.label}</div>
                {([[r.lowLabel, r.lowDelta], [r.highLabel, r.highDelta]] as const).map(([lab, d]) => (
                  <div className="tor-line" key={lab}>
                    <span className="tv">{lab}</span>
                    <div className="tor-track">
                      <b style={{ [d < 0 ? 'right' : 'left']: '50%', width: `${Math.abs(d) / maxAbs * 50}%`, background: d < 0 ? 'var(--loss)' : 'var(--accent)' }} />
                    </div>
                    <span className={`td ${d < 0 ? 'bad' : 'good'}`}>{copSigned(d)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="take">
            Cambio en el neto diario frente al caso base ({copSigned(sens.base)}). Los que más pesan: <b>{lc(sens.rows[0].label)}</b>, <b>{lc(sens.rows[1].label)}</b> y <b>{lc(sens.rows[2].label)}</b>. Son los datos que una operación real puede medir, y los que conviene verificar primero.
          </p>
        </div>
      </div>
    </section>
  )
}
