import type { RateReport } from './data/ingest'
import type { ZoneRate } from './data/rates'

const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits).replace('.', ',')}%`
const signed = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(Math.round(v))}`

function Columns({ rows, overall }: { rows: ZoneRate[]; overall: number }) {
  const top = Math.max(...rows.map((r) => r.raw), overall) * 1.15 || 1
  return (
    <div className="cols" role="img" aria-label="Tasa de novedad por franja">
      {rows.map((r) => (
        <div className="col" key={r.key}>
          <span className="col-v">{pct(r.raw)}</span>
          <div className="col-bar"><i className="col-base" style={{ bottom: `${(overall / top) * 100}%` }} title="Tasa general" /><b style={{ height: `${(r.raw / top) * 100}%`, background: r.flag === 'high' ? 'var(--loss)' : r.flag === 'low' ? 'var(--accent)' : 'var(--muted)' }} /></div>
          <span className="col-n">{r.name}</span>
          <span className="col-c">{r.deliveries}</span>
        </div>
      ))}
    </div>
  )
}

function describe(rows: ZoneRate[], kind: 'municipio' | 'franja' | 'día') {
  const real = rows.filter((r) => r.deliveries >= 30)
  if (real.length < 2) return null
  const hi = [...real].sort((a, b) => b.raw - a.raw)[0]
  const lo = [...real].sort((a, b) => a.raw - b.raw)[0]
  if (hi.raw < lo.raw * 1.25) return `Por ${kind} la tasa es bastante pareja.`
  return `Por ${kind}: ${hi.name} ${pct(hi.raw)} frente a ${lo.name} ${pct(lo.raw)}.`
}

export function Tendency({ rates, days }: { rates: RateReport; days: number }) {
  const muni = rates.byMunicipality
  const top = Math.max(...muni.map((r) => r.hi), rates.overall) * 1.05
  const highs = muni.filter((r) => r.flag === 'high')
  const lows = muni.filter((r) => r.flag === 'low')
  return (
    <section className="panel tendency" aria-label="Dónde y cuándo se falla más">
      <h2>Dónde y cuándo se falla más</h2>
      <p className="hint">
        {rates.attempts} entregas en {days} día{days === 1 ? '' : 's'}, tasa de novedad general de <b>{pct(rates.overall, 1)}</b>, medida {rates.level === 'cell' ? 'por zonas de ~1 km (se puede ver en el mapa)' : 'por municipio, porque no todas las filas traen coordenadas'}.
        Las tasas de grupos con pocas entregas se acercan a la general, para que 8 entregas con 3 fallos no parezcan el peor lugar del valle.
      </p>

      <div className="tend-grid">
        <div>
          <h3>Por municipio</h3>
          <div className="tend-rows">
            {muni.map((r) => (
              <div className="tend-row" key={r.key}>
                <span className="tend-name">{r.name}<i>{r.deliveries}</i></span>
                <div className="tend-track" title={`Intervalo de 90%: ${pct(r.lo)} a ${pct(r.hi)}`}>
                  <b className="tend-whisker" style={{ left: `${(r.lo / top) * 100}%`, width: `${((r.hi - r.lo) / top) * 100}%` }} />
                  <b className="tend-bar" style={{ width: `${(r.shrunk / top) * 100}%`, background: r.flag === 'high' ? 'var(--loss)' : r.flag === 'low' ? 'var(--accent)' : 'var(--muted)' }} />
                  <b className="tend-base" style={{ left: `${(rates.overall / top) * 100}%` }} />
                </div>
                <span className="tend-n">{pct(r.shrunk)}</span>
              </div>
            ))}
          </div>
          <p className="hint">Barra: tasa ajustada. Línea fina: intervalo de 90%. Marca vertical: tasa general. Rojo: claramente por encima; verde: claramente por debajo.</p>
        </div>
        <div className="tend-side">
          {rates.byHour.some((r) => r.deliveries > 0) && (
            <div>
              <h3>Por hora del día</h3>
              <Columns rows={rates.byHour.filter((r) => r.deliveries > 0)} overall={rates.overall} />
            </div>
          )}
          {rates.byWeekday.length > 1 && (
            <div>
              <h3>Por día de la semana</h3>
              <Columns rows={rates.byWeekday} overall={rates.overall} />
            </div>
          )}
        </div>
      </div>

      <ul className="take list plain">
        {highs.length > 0 && <li><b>Fallan más de lo normal:</b> {highs.map((r) => `${r.name} (${pct(r.shrunk)}, ${signed(r.excess)} fallos sobre lo esperado)`).join('; ')}.</li>}
        {lows.length > 0 && <li><b>Fallan menos de lo normal:</b> {lows.map((r) => `${r.name} (${pct(r.shrunk)})`).join('; ')}.</li>}
        {highs.length === 0 && lows.length === 0 && <li>Ningún municipio se aparta claramente de la tasa general con estas entregas.</li>}
        {[describe(rates.byHour.filter((r) => r.deliveries > 0), 'franja'), describe(rates.byWeekday, 'día')].filter(Boolean).map((t) => <li key={t}>{t}</li>)}
        <li>Esto muestra <b>dónde y cuándo</b> se concentran las novedades, no <b>por qué</b>. Que una franja falle menos puede deberse a quién pide en esa franja y no a la hora. Para saber si cambiar algo las reduce hace falta probarlo en una parte de la operación.</li>
      </ul>
    </section>
  )
}
