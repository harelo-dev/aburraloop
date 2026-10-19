import { useDeferredValue, useMemo } from 'react'
import {
  ANALYSIS_DAYS, VOLUME_POINTS, breakEvenVolume, marginalVolume, placementComparison, sensitivity, vansCurve, volumeCurve,
  type VolumePoint,
} from './sim/analysis'
import { ASSUMPTIONS, type Params, type Placement } from './sim/simulate'
import { cop, copSigned } from './format'

const PLACEMENT_LABEL: Record<Placement, string> = {
  zones: 'Fijas por zona (Norte, Centro, Sur)',
  concentration: 'Según dónde cayeron los fallos de días anteriores',
  hindsight: 'Con conocimiento del día (techo, no alcanzable)',
}
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
            <text x={x(last.volume) + 6} y={y(last.net[s]) + 4} fill={SERIES_COLORS[s]} className="end-label">{s + 1} van{s ? 's' : ''}</text>
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
  const sens = useMemo(() => sensitivity(base), [base])

  const bestN = curve.reduce((b, m, i) => (m.net > curve[b].net ? i : b), 0)
  const perRescue = curve[1].saved ? curve[1].recovered / curve[1].saved : 0
  const rescuesToPay = perRescue ? ASSUMPTIONS.vanCostCopPerDay / perRescue : 0
  const maxNet = Math.max(...curve.map((m) => m.net), 1)
  const maxAbs = Math.max(...sens.rows.flatMap((r) => [Math.abs(r.lowDelta), Math.abs(r.highDelta)]), 1)
  const rowFor = (p: Placement) => placements.find((r) => r.placement === p)!
  const zones = rowFor('zones'), conc = rowFor('concentration'), hind = rowFor('hindsight')
  const be = [0, 1, 2].map((s) => breakEvenVolume(volume, s))
  const m2 = marginalVolume(volume, 1), m3 = marginalVolume(volume, 2)
  const fmtV = (v: number | null) => (v === null ? 'nunca en 150–1.200' : `~${Math.round(v / 10) * 10}`)

  return (
    <section className="analysis" aria-label="Análisis" data-stale={stale}>
      <div className="an-head">
        <h2>Análisis</h2>
        <p className="hint">Promedio de {ANALYSIS_DAYS} días simulados con tus parámetros actuales{deferred.vans === 0 ? ' (con 2 vans, porque elegiste 0)' : ''}. Las cifras son netas del costo de las vans.</p>
      </div>

      <div className="an-grid">
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
              <li key={s}><i style={{ background: SERIES_COLORS[s] }} />{s + 1} van{s ? 's' : ''} se pagan desde <b>{fmtV(be[s])}</b> despachos al día</li>
            ))}
          </ul>
          <p className="take">
            La 2.ª van supera a la 1.ª desde <b>{fmtV(m2)}</b> despachos al día y la 3.ª supera a la 2.ª desde <b>{fmtV(m3)}</b>, con {Math.round(deferred.failureRate * 100)}% de novedad.
            Por debajo de ese volumen, lo que rescata la van adicional no cubre su costo.
          </p>
        </div>

        <div className="panel">
          <h3>¿Dónde poner {vans === 1 ? 'la van' : `las ${vans} vans`}?</h3>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Estrategia</th><th>Salvados</th><th>Neto / día</th><th>Ubicación</th></tr></thead>
              <tbody>
                {(['zones', 'concentration', 'hindsight'] as const).map((k) => {
                  const r = rowFor(k)
                  return (
                    <tr key={k} className={k === deferred.placement ? 'sel' : ''}>
                      <td>{PLACEMENT_LABEL[k]}</td>
                      <td>{r.mean.savedPct.toFixed(0)}%</td>
                      <td>{copSigned(r.mean.net)}</td>
                      <td>{r.sites.join(', ')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="take">
            Poner las vans donde se concentraron los fallos de días anteriores da <b>{copSigned(conc.mean.net - zones.mean.net)}</b> al día frente a zonas fijas, y queda a {copSigned(hind.mean.net - conc.mean.net)} del techo con conocimiento del día.
            La regla: cada van va donde alcanza, en {deferred.maxMinutes} min por carretera, el mayor valor esperado que aún no cubre otra{deferred.minCediMinutes ? `, y a al menos ${deferred.minCediMinutes} min del CEDI` : ''}.
          </p>
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
