import { useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import {
  FIELD_LABELS, QUALITY_LABEL, buildData, classifyReason, detectMapping, prepareRows, reasonOf, suggest,
  type Field, type GeoPoint, type Mapping, type Report, type Row,
} from './data/ingest'
import { browserCache, cachedCount, geocodeAll } from './data/geocode'
import { sampleCsv, sampleDeliveriesCsv } from './data/sample'
import type { Grade, RealData } from './sim/simulate'
import { cop } from './format'

const MAX_ROWS = 20000
const MAX_UNIQUE_ADDRESSES = 400
const FIELDS: Field[] = ['status', 'lat', 'lon', 'coords', 'address', 'municipality', 'date', 'time', 'cod', 'reason', 'retry', 'courier']

/** What the file says about the simulator's parameters, ready to apply. */
export interface Applied {
  data: RealData
  patch: { volume?: number; failureRate?: number; secondAttemptSuccess?: number; gradeBSuccess?: number; fleet?: number }
  report: Report
}

function decode(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('windows-1252').decode(buffer) // Excel's "CSV" saved with the local code page
  }
}

const pct = (v: number) => `${Math.round(v * 100)}%`

export function DataPanel({ active, volume, open, onToggle, onApply, onClear }: {
  active: { used: number; days: number } | null
  volume: number
  open: boolean
  onToggle: (open: boolean) => void
  onApply: (a: Applied, summary: { used: number; days: number }) => void
  onClear: () => void
}) {
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [mapping, setMapping] = useState<Mapping>({})
  const [grades, setGrades] = useState<Record<string, Grade>>({})
  const [notice, setNotice] = useState('')
  const [consent, setConsent] = useState(false)
  const [daysText, setDaysText] = useState('')
  const [dispatches, setDispatches] = useState(String(volume))
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<{ data: RealData; report: Report; stopped: string | null } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const [cached, setCached] = useState(cachedCount())

  const reasons = useMemo(() => {
    if (!mapping.reason) return []
    const count = new Map<string, number>()
    rows.forEach((r) => { const t = reasonOf(r, mapping); if (t) count.set(t, (count.get(t) ?? 0) + 1) })
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
  }, [rows, mapping])

  const hasPoint = (mapping.lat && mapping.lon) || mapping.coords
  const needsAddresses = !hasPoint && !!mapping.address

  const load = (text: string, name: string) => {
    const parsed = Papa.parse<Row>(text.replace(/^﻿/, ''), {
      header: true, skipEmptyLines: 'greedy', delimitersToGuess: [',', ';', '\t', '|'], transformHeader: (h) => h.trim(),
    })
    const fields = (parsed.meta.fields ?? []).filter(Boolean)
    if (!fields.length || !parsed.data.length) { setNotice('No encontré filas con encabezados en ese archivo.'); return }
    const data = parsed.data.slice(0, MAX_ROWS)
    const m = detectMapping(fields)
    setFileName(name); setHeaders(fields); setRows(data); setMapping(m); setResult(null); setProgress(null)
    setGrades(Object.fromEntries(data.map((r) => reasonOf(r, m)).filter(Boolean).map((t) => [t, classifyReason(t) ?? 'A'])))
    setNotice(parsed.data.length > MAX_ROWS ? `El archivo tiene ${parsed.data.length} filas: usé las primeras ${MAX_ROWS}.` : '')
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 8_000_000) { setNotice('El archivo pesa más de 8 MB. Reduce las columnas o divide el archivo.'); return }
    load(decode(await file.arrayBuffer()), file.name)
  }

  const setField = (f: Field, header: string) => {
    const next = { ...mapping }
    if (header) next[f] = header; else delete next[f]
    setMapping(next); setResult(null)
    if (f === 'reason') setGrades(Object.fromEntries(rows.map((r) => reasonOf(r, next)).filter(Boolean).map((t) => [t, grades[t] ?? classifyReason(t) ?? 'A'])))
  }

  const process = async () => {
    const prepared = prepareRows(rows, mapping, grades, 'A')
    // Only failures are looked up: a long list of delivered addresses would take hours at one request per second.
    const needGeo = prepared.map((p, i) => (p.locator.kind === 'address' && p.status !== 'delivered' ? i : -1)).filter((i) => i >= 0)
    let geo: (GeoPoint | null)[] = prepared.map(() => null)
    let stopped: string | null = null
    if (needGeo.length && consent) {
      const chains = needGeo.map((i) => (prepared[i].locator as { queries: string[] }).queries)
      const uniques = new Set(chains.map((c) => c.join('|'))).size
      if (uniques > MAX_UNIQUE_ADDRESSES) { setNotice(`Hay ${uniques} direcciones distintas. Para no sobrecargar el servicio público de OpenStreetMap el máximo es ${MAX_UNIQUE_ADDRESSES}. Usa coordenadas o un archivo más corto.`); return }
      abort.current = new AbortController()
      setProgress({ done: 0, total: uniques })
      const run = await geocodeAll(chains, { cache: browserCache(), signal: abort.current.signal, onProgress: (done, total) => setProgress({ done, total }) })
      run.results.forEach((g, k) => { geo[needGeo[k]] = g })
      stopped = run.stopped
      setCached(cachedCount())
      setProgress(null)
    }
    const days = daysText.trim() ? Math.max(1, Math.round(Number(daysText)) || 1) : null
    const { data, report } = buildData(fileName, prepared, geo, { daysOverride: days, defaultGrade: 'A' })
    setResult({ data, report, stopped })
  }

  const suggestion = useMemo(() => (result ? suggest(result.report, Number(dispatches) > 0 ? Number(dispatches) : null) : null), [result, dispatches])

  const apply = () => {
    if (!result || !suggestion) return
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
    const perDay = suggestion.dispatchesPerDay ?? (Number(dispatches) > 0 ? Number(dispatches) : null)
    const dispatchesPerDay = perDay ? clamp(Math.round(perDay), 150, 1200) : null
    const patch: Applied['patch'] = {}
    if (dispatchesPerDay) {
      patch.volume = dispatchesPerDay
      patch.failureRate = clamp(suggestion.failuresPerDay / dispatchesPerDay, 0.02, 0.4)
    }
    if (suggestion.secondAttemptSuccess !== null) patch.secondAttemptSuccess = clamp(suggestion.secondAttemptSuccess, 0.1, 0.95)
    if (suggestion.gradeBSuccess !== null) patch.gradeBSuccess = clamp(suggestion.gradeBSuccess, 0.1, 0.95)
    if (suggestion.fleet !== null) patch.fleet = clamp(suggestion.fleet, 3, 80)
    onApply({ data: result.data, patch, report: result.report }, { used: result.report.used, days: result.report.days })
  }

  const clearCache = () => { browserCache().clear(); setCached(0) }
  const download = () => {
    const url = URL.createObjectURL(new Blob([sampleDeliveriesCsv()], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'ejemplo-entregas.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
    {active && (
      <div className="data-active" role="status">
        <span><b>Usando tus datos:</b> {active.used} fallos en {active.days} día{active.days === 1 ? '' : 's'}.</span>
        <button className="btn ghost danger" onClick={onClear}>Volver a datos sintéticos</button>
      </div>
    )}
    <details className="panel data-panel" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>
        <span className="data-title">{active ? 'Cambiar los datos' : 'Usa tus propios datos'}</span>
        <span className="data-sub">{active ? 'Carga otro CSV' : 'Carga un CSV con tus paquetes fallidos'}</span>
      </summary>

      <div className="data-body">
        <p className="hint">
          El archivo se procesa en tu navegador y no se sube a ningún servidor. Solo si activas la ubicación de direcciones, esas direcciones se envían a OpenStreetMap.
          El simulador no necesita nombres ni teléfonos: quítalos antes de cargar.
        </p>
        <div className="data-actions">
          <label className="btn">
            Elegir archivo CSV
            <input type="file" accept=".csv,.txt,text/csv" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} hidden />
          </label>
          <button className="btn ghost" onClick={() => load(sampleDeliveriesCsv(), 'ejemplo-entregas.csv')}>Ejemplo: entregas y fallos</button>
          <button className="btn ghost" onClick={() => load(sampleCsv(), 'ejemplo-novedades.csv')}>Ejemplo: solo fallos</button>
          <button className="btn ghost" onClick={download}>Descargar el ejemplo con entregas</button>
        </div>
        {notice && <p className="warn" role="alert">{notice}</p>}

        {rows.length > 0 && (
          <>
            <h3>1. Columnas de «{fileName}» · {rows.length} filas</h3>
            <div className="map-grid">
              {FIELDS.map((f) => (
                <label key={f} className="map-row">
                  <span>{FIELD_LABELS[f]}</span>
                  <select value={mapping[f] ?? ''} onChange={(e) => setField(f, e.target.value)}>
                    <option value="">No está</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {!hasPoint && !mapping.address && !mapping.municipality && <p className="warn">Necesito una ubicación: coordenadas, una dirección o al menos el municipio.</p>}
            {hasPoint && <p className="hint">Se usarán las coordenadas. Una dirección solo se busca cuando una fila no trae coordenadas válidas.</p>}

            {reasons.length > 0 && (
              <>
                <h3>2. ¿Qué tan recuperable es cada motivo?</h3>
                <p className="hint">A: un segundo intento es viable (ausente, no contesta). B: rechazo que se puede liquidar en el lugar. C: avería o cambio, vuelve al CEDI. Ya sugerí uno por motivo; corrígelo si hace falta.</p>
                <div className="reason-list">
                  {reasons.map(([text, n]) => (
                    <label key={text} className="reason-row">
                      <span className="reason-text">{text} <i>{n}</i></span>
                      <select value={grades[text] ?? 'A'} onChange={(e) => { setGrades({ ...grades, [text]: e.target.value as Grade }); setResult(null) }}>
                        <option value="A">A · reintento viable</option>
                        <option value="B">B · liquidación flash</option>
                        <option value="C">C · vuelve al CEDI</option>
                      </select>
                    </label>
                  ))}
                </div>
              </>
            )}

            <h3>{reasons.length > 0 ? '3' : '2'}. Detalles</h3>
            <div className="map-grid">
              {!mapping.date && !(mapping.time && /fecha|timestamp|datetime/i.test(mapping.time)) && (
                <label className="map-row"><span>Días que cubre el archivo</span><input type="number" min={1} value={daysText} onChange={(e) => setDaysText(e.target.value)} placeholder="Sin fecha: dime cuántos" /></label>
              )}
              {!mapping.status && <label className="map-row"><span>Despachos al día (con y sin novedad)</span><input type="number" min={1} value={dispatches} onChange={(e) => { setDispatches(e.target.value) }} /></label>}
            </div>
            {mapping.status
              ? <p className="hint">El archivo trae entregas y fallos: calcularé cuántos paquetes se despachan al día y la tasa de novedad por zona, por hora y por día de la semana. Las direcciones solo se buscan para los fallos.</p>
              : <p className="hint">Un archivo de fallos no dice cuántos paquetes se despacharon. Con ese número calculo tu tasa de novedad. Si el archivo trae también las entregas exitosas (una columna de estado), puedo medir dónde y cuándo se falla más.</p>}

            {needsAddresses && (
              <label className="check consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  Ubicar las direcciones enviándolas a OpenStreetMap (Nominatim), una por segundo. Entiende calles y barrios, pero casi nunca el número de puerta, así que la ubicación es aproximada.
                  Sin esto, las filas se ubican solo por municipio.{cached > 0 && <> Hay {cached} direcciones recordadas en este navegador. <button type="button" className="link" onClick={clearCache}>Borrarlas</button>.</>}
                </span>
              </label>
            )}

            <div className="data-actions">
              <button className="btn" disabled={!!progress || (!hasPoint && !mapping.address && !mapping.municipality)} onClick={() => void process()}>Procesar archivo</button>
              {progress && <button className="btn ghost" onClick={() => abort.current?.abort()}>Cancelar</button>}
              {progress && <span className="hint">Ubicando direcciones… {progress.done} de {progress.total}</span>}
            </div>
          </>
        )}

        {result && suggestion && (
          <div className="data-result">
            <h3>Resultado</h3>
            <p>
              <b>{result.report.used}</b> fallos ubicados en el Valle de Aburrá, de {result.report.rows} filas, en <b>{result.report.days}</b> día{result.report.days === 1 ? '' : 's'} ({suggestion.failuresPerDay.toFixed(0)} fallos por día).
              {result.report.excluded.noLocation > 0 && <> {result.report.excluded.noLocation} sin ubicación.</>}
              {result.report.excluded.outsideValley > 0 && <> {result.report.excluded.outsideValley} fuera del valle.</>}
              {result.report.excluded.unknownStatus > 0 && <> {result.report.excluded.unknownStatus} con un estado que no reconozco.</>}
            </p>
            {result.stopped && <p className="warn">La búsqueda de direcciones se detuvo ({result.stopped === 'rate-limit' ? 'el servicio pidió ir más despacio' : result.stopped === 'cancelled' ? 'la cancelaste' : 'falló la red'}). Lo que no alcanzó a ubicarse quedó por municipio. Vuelve a procesar para continuar: lo ya buscado está recordado.</p>}
            <div className="quality">
              {(Object.keys(QUALITY_LABEL) as (keyof typeof QUALITY_LABEL)[]).filter((k) => result.report.quality[k] > 0).map((k) => (
                <div key={k} className="q-row"><span>{QUALITY_LABEL[k]}</span><div className="bar"><b style={{ width: `${(result.report.quality[k] / Math.max(1, result.report.used)) * 100}%`, background: k === 'municipality' ? 'var(--c3)' : 'var(--accent)' }} /></div><span className="n">{result.report.quality[k]}</span></div>
              ))}
            </div>

            <div className="calib-wrap">
            <table className="calib">
              <thead><tr><th>Parámetro</th><th>Tu archivo</th><th>Se usará</th></tr></thead>
              <tbody>
                {result.report.rates && <tr><td>Despachos al día</td><td>{Math.round(result.report.rates.attemptsPerDay)}</td><td>{Math.min(1200, Math.max(150, Math.round(result.report.rates.attemptsPerDay)))}</td></tr>}
                <tr><td>Tasa de novedad</td><td>{suggestion.failureRate !== null ? pct(suggestion.failureRate) : 'falta el despacho diario'}</td><td>{suggestion.failureRate !== null ? pct(Math.min(0.4, Math.max(0.02, suggestion.failureRate))) : 'sin cambio'}</td></tr>
                <tr><td>Éxito del 2.º intento (A)</td><td>{result.report.retry.A.rate !== null ? `${pct(result.report.retry.A.rate)} · ${result.report.retry.A.n} casos` : 'sin columna de reintento'}</td><td>{suggestion.secondAttemptSuccess !== null ? pct(suggestion.secondAttemptSuccess) : 'sin cambio'}</td></tr>
                <tr><td>Éxito liquidación flash (B)</td><td>{result.report.retry.B.rate !== null ? `${pct(result.report.retry.B.rate)} · ${result.report.retry.B.n} casos` : 'sin columna de reintento'}</td><td>{suggestion.gradeBSuccess !== null ? pct(suggestion.gradeBSuccess) : 'sin cambio'}</td></tr>
                <tr><td>Motos</td><td>{suggestion.fleet ?? 'sin columna de mensajero'}</td><td>{suggestion.fleet ?? 'sin cambio'}</td></tr>
                <tr><td>Mezcla A / B / C</td><td colSpan={2}>{pct(result.report.gradeShare.A)} · {pct(result.report.gradeShare.B)} · {pct(result.report.gradeShare.C)}</td></tr>
                <tr><td>Valor promedio del pedido</td><td colSpan={2}>{result.report.codMean ? cop(result.report.codMean) : 'sin columna de valor'}</td></tr>
                <tr><td>Municipios con más fallos</td><td colSpan={2}>{result.report.municipalityShare.slice(0, 4).map((m) => `${m.name} ${pct(m.share)}`).join(' · ')}</td></tr>
              </tbody>
            </table>
            </div>
            {suggestion.warnings.length > 0 && <ul className="warn-list">{suggestion.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            <div className="data-actions"><button className="btn" onClick={apply}>Usar estos datos en el simulador</button></div>
          </div>
        )}
      </div>
    </details>
    </>
  )
}
