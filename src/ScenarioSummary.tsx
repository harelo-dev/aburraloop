import { useDeferredValue, useMemo, useState } from 'react'
import { bestConfig } from './sim/analysis'
import type { Params } from './sim/simulate'
import type { Report } from './data/ingest'
import { buildSummary, type Summary } from './summary'

export function ScenarioSummary({ params, origin, report }: { params: Params; origin: Summary['origen']; report: Report | null }) {
  const deferred = useDeferredValue(params)
  const [copied, setCopied] = useState(false)
  const text = useMemo(() => JSON.stringify(buildSummary(deferred, bestConfig({ ...deferred, vans: 2 }), origin, report), null, 2), [deferred, origin, report])

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* the text is selectable below */ }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'resumen-escenario.json'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <details className="panel summary-card">
      <summary>
        <span className="data-title">Resumen de este escenario</span>
        <span className="data-sub">Lo que diría de él, en rangos. Nada se envía.</span>
      </summary>
      <div className="data-body">
        <p className="hint">
          <b>Este sitio no envía este resumen a ningún lado.</b> Existe para que veas qué contiene un escenario y puedas copiarlo tú, por ejemplo para compartirlo con tu equipo.
          Usa rangos en lugar de cifras exactas y nunca incluye las filas de tu archivo, direcciones, coordenadas, nombres ni teléfonos.
        </p>
        <pre className="json" tabIndex={0} aria-label="Resumen del escenario">{text}</pre>
        <div className="data-actions">
          <button className="btn ghost" onClick={() => void copy()}>{copied ? 'Copiado' : 'Copiar'}</button>
          <button className="btn ghost" onClick={download}>Descargar .json</button>
        </div>
      </div>
    </details>
  )
}
