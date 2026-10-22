import { useEffect, useMemo, useRef, useState } from 'react'
import { FIELDS, buildDataset, detectMapping, distinctValues, guessOutcome, type FieldId, type Mapping, type Outcome } from './ingest/map'
import { readTable, type Table } from './ingest/table'
import type { Dataset } from './sim/simulate'
import { int } from './format'

export interface Loaded { dataset: Dataset; name: string; rows: number; filled: string[] }

const OUTCOME_LABEL: Record<Outcome, string> = { failed: 'Fallido', delivered: 'Entregado', ignore: 'Ignorar' }
const MAX_OUTCOME_VALUES = 40

export function Upload({ onLoad, onClose }: { onLoad: (l: Loaded) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [table, setTable] = useState<Table | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mapping, setMapping] = useState<Mapping>({})
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const [volume, setVolume] = useState(400)

  useEffect(() => { ref.current?.showModal() }, [])

  const distinct = useMemo(() => (table && mapping.resultado !== undefined ? distinctValues(table, mapping.resultado, MAX_OUTCOME_VALUES + 1) : []), [table, mapping.resultado])

  const setResultado = (t: Table, col: number | undefined) => {
    if (col === undefined) { setOutcomes({}); return }
    const next: Record<string, Outcome> = {}
    for (const d of distinctValues(t, col, MAX_OUTCOME_VALUES)) next[d.value] = guessOutcome(d.value)
    setOutcomes(next)
  }

  async function pick(file: File) {
    setBusy(true); setError('')
    try {
      const t = await readTable(file)
      const m = detectMapping(t)
      setTable(t); setName(file.name); setMapping(m); setResultado(t, m.resultado)
    } catch (e) {
      setTable(null)
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.')
    } finally { setBusy(false) }
  }

  const built = useMemo(
    () => (table ? buildDataset(table, mapping, { outcomes, volumePerDay: volume }) : null),
    [table, mapping, outcomes, volume],
  )

  const changeField = (f: FieldId, v: string) => {
    const next = { ...mapping }
    if (v === '') delete next[f]
    else next[f] = +v
    setMapping(next)
    if (f === 'resultado' && table) setResultado(table, v === '' ? undefined : +v)
  }

  const needLocation = !((mapping.lat !== undefined && mapping.lon !== undefined) || mapping.municipio !== undefined)
  const tooManyValues = distinct.length > MAX_OUTCOME_VALUES
  const failedValues = Object.values(outcomes).filter((o) => o === 'failed').length
  const noFailedValue = mapping.resultado !== undefined && !tooManyValues && failedValues === 0
  const ready = !!built?.dataset && !needLocation && !tooManyValues && !noFailedValue

  const close = () => { ref.current?.close(); onClose() }

  return (
    <dialog ref={ref} className="upload" aria-labelledby="up-title" onCancel={(e) => { e.preventDefault(); close() }}>
      <div className="up-head">
        <h2 id="up-title">Cargar tus datos</h2>
        <button className="x" onClick={close} aria-label="Cerrar">×</button>
      </div>
      <p className="hint">Un archivo CSV o XLSX con un envío por fila. No importa cómo se llamen las columnas: tú indicas cuál es cuál. El archivo se procesa en tu navegador y no se sube a ningún servidor.</p>

      <label className="drop">
        <input type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f) }} />
        <span>{busy ? 'Leyendo…' : name || 'Elegir archivo .csv o .xlsx'}</span>
      </label>
      {error && <p className="msg bad" role="alert">{error}</p>}

      {table && built && (
        <>
          <h3>1. ¿Qué columna es cada dato?</h3>
          <div className="map">
            {FIELDS.map((f) => (
              <div className="ctl" key={f.id}>
                <label htmlFor={`f-${f.id}`}>{f.label}</label>
                <select id={`f-${f.id}`} value={mapping[f.id] ?? ''} onChange={(e) => changeField(f.id, e.target.value)}>
                  <option value="">— no está en el archivo —</option>
                  {table.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
                {f.hint && <p className="hint">{f.hint}</p>}
              </div>
            ))}
          </div>
          {needLocation && <p className="msg bad" role="alert">Falta la ubicación: indica latitud y longitud, o el municipio.</p>}

          <div className="preview" tabIndex={0} role="region" aria-label="Primeras filas del archivo">
            <table>
              <thead><tr>{table.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>
                {table.rows.slice(0, 4).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c instanceof Date ? c.toISOString().slice(0, 16).replace('T', ' ') : String(c ?? '')}</td>)}</tr>)}
              </tbody>
            </table>
          </div>

          {mapping.resultado !== undefined ? (
            <>
              <h3>2. ¿Qué significa cada resultado?</h3>
              {tooManyValues ? (
                <p className="msg bad" role="alert">Esa columna tiene más de {MAX_OUTCOME_VALUES} valores distintos, no parece un estado de entrega. Elige otra.</p>
              ) : (
                <div className="outcomes">
                  {distinct.map((d) => (
                    <div className="oc" key={d.value}>
                      <span className="v">{d.value || '(vacío)'}</span>
                      <span className="n">{int(d.count)}</span>
                      <select aria-label={`Significado de ${d.value || 'vacío'}`} value={outcomes[d.value] ?? 'ignore'} onChange={(e) => setOutcomes((o) => ({ ...o, [d.value]: e.target.value as Outcome }))}>
                        {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}
              {noFailedValue && <p className="msg bad" role="alert">Marca al menos un valor como «Fallido».</p>}
            </>
          ) : (
            <>
              <h3>2. Despachos por día</h3>
              <p className="hint">Sin columna de resultado se asume que todas las filas son paquetes fallidos. Indica cuántos despachos totales hay al día para calcular la tasa de novedad.</p>
              <div className="ctl">
                <label htmlFor="up-vol">Despachos al día<output>{int(volume)}</output></label>
                <input id="up-vol" type="range" min={100} max={3000} step={50} value={volume} onChange={(e) => setVolume(+e.target.value)} />
              </div>
            </>
          )}

          <Summary built={built} />
          <div className="up-actions">
            <button className="reroll" onClick={close}>Cancelar</button>
            <button
              className="go"
              disabled={!ready}
              onClick={() => { if (built.dataset) { onLoad({ dataset: built.dataset, name, rows: built.report.rows, filled: built.report.filled }); close() } }}
            >
              Usar estos datos
            </button>
          </div>
        </>
      )}
    </dialog>
  )
}

function Summary({ built }: { built: ReturnType<typeof buildDataset> }) {
  const { report, dataset } = built
  const failed = dataset?.days.reduce((s, d) => s + d.failures.length, 0) ?? 0
  const dispatches = dataset?.days.reduce((s, d) => s + d.volume, 0) ?? 0
  const discarded = Object.entries(report.discarded)
  return (
    <div className="summary" aria-live="polite">
      <h3>Resumen</h3>
      {dataset ? (
        <p>
          <b>{int(failed)}</b> fallidos de <b>{int(dispatches)}</b> despachos en <b>{report.days}</b> {report.days === 1 ? 'día' : 'días'}
          {' '}(<b>{dispatches ? ((failed / dispatches) * 100).toFixed(1).replace('.', ',') : 0}%</b> de novedad).
        </p>
      ) : (
        <p className="msg bad">No se puede simular todavía.</p>
      )}
      {report.ignored > 0 && <p className="hint">{int(report.ignored)} filas con resultado «Ignorar» no cuentan.</p>}
      {discarded.map(([why, n]) => <p className="msg warn" key={why}>{int(n)} filas descartadas: {why.toLowerCase()}{report.unknownPlaces.length && why.startsWith('Municipio') ? ` (ej. ${report.unknownPlaces.join(', ')})` : ''}.</p>)}
      {report.filled.length > 0 && dataset && <p className="hint">El archivo no trae {report.filled.join(', ')}; se usan los supuestos del modelo.</p>}
      {report.warnings.map((w) => <p className="msg warn" key={w}>{w}</p>)}
    </div>
  )
}
