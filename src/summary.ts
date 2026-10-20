import type { Config } from './sim/analysis'
import type { Report } from './data/ingest'
import type { Params } from './sim/simulate'

/**
 * A band like "400 a 599" instead of the exact figure, so a summary of a scenario cannot single out one company.
 * `edges` are the lower bounds of the bands, ascending.
 */
export function band(value: number, edges: number[], fmt: (n: number) => string = String): string {
  if (value < edges[0]) return `menos de ${fmt(edges[0])}`
  for (let i = edges.length - 1; i >= 0; i--) {
    if (value >= edges[i]) return i === edges.length - 1 ? `${fmt(edges[i])} o más` : `${fmt(edges[i])} a ${fmt(edges[i + 1] - 1)}`
  }
  return fmt(value)
}

const pct = (n: number) => `${n}%`
const kpesos = (n: number) => `$${n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0).replace('.', ',')} M` : `${n} mil`}`

export const NEVER_INCLUDED = ['las filas del archivo', 'direcciones', 'coordenadas', 'nombres ni teléfonos', 'el archivo CSV']

export const CONFIG_LABEL: Record<Config | 'none', string> = {
  intercept: 'la van intercepta fallos en la calle',
  rounds: 'la van recorre a las motos en la mañana y en la tarde',
  roundsPending: 'la van recorre solo a las motos con algo pendiente',
  none: 'ninguna configuración de van cubre su costo',
}

export interface Summary {
  version: 1
  origen: 'estimaciones del modo guiado' | 'archivo propio' | 'valores de la demo'
  despachos_por_dia: string
  motos: string
  tasa_de_novedad: string
  causas: { cliente_ausente: string; rechazo_o_sin_efectivo: string; averia_o_cambio: string }
  exito_del_reintento: string
  valor_del_pedido: string
  recomendacion: { modo: string; vans: number }
  neto_diario_estimado: string
  dias_de_datos?: string
  fallos_en_el_archivo?: string
  nunca_incluye: string[]
}

/**
 * What a scenario says about itself, in bands and without any row of data. It is shown to the person and can be copied
 * by them. Nothing in this app sends it anywhere.
 */
export function buildSummary(
  p: Params,
  best: { config: Config | 'none'; vans: number; net: number },
  origin: Summary['origen'],
  report?: Report | null,
): Summary {
  const netK = Math.round(best.net / 1000)
  const s: Summary = {
    version: 1,
    origen: origin,
    despachos_por_dia: band(p.volume, [150, 300, 500, 700, 900, 1200]),
    motos: band(p.fleet, [3, 10, 20, 30, 45, 60]),
    tasa_de_novedad: band(Math.round(p.failureRate * 100), [2, 6, 10, 14, 18, 24, 32], pct),
    causas: {
      cliente_ausente: band(Math.round(p.gradeShare.A * 100), [0, 20, 40, 60, 80], pct),
      rechazo_o_sin_efectivo: band(Math.round(p.gradeShare.B * 100), [0, 10, 20, 30, 50], pct),
      averia_o_cambio: band(Math.round(p.gradeShare.C * 100), [0, 10, 20, 30, 50], pct),
    },
    exito_del_reintento: band(Math.round(p.secondAttemptSuccess * 100), [10, 30, 50, 70, 90], pct),
    valor_del_pedido: band(Math.round(p.codAverage / 1000), [40, 80, 120, 160, 240], (n) => `$${n} mil`),
    recomendacion: { modo: CONFIG_LABEL[best.config], vans: best.vans },
    neto_diario_estimado: best.config === 'none' ? 'sin ganancia' : band(netK, [0, 100, 300, 600, 1000, 2000], kpesos),
    nunca_incluye: NEVER_INCLUDED,
  }
  if (report) {
    s.dias_de_datos = band(report.days, [1, 5, 10, 20, 40], (n) => `${n}`)
    s.fallos_en_el_archivo = band(report.used, [1, 100, 300, 1000, 3000], (n) => `${n}`)
  }
  return s
}
