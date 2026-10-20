import places from './places.json'
import { ASSUMPTIONS, defaultParams, generateIncidents, mulberry32 } from '../sim/simulate'

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (h: number) => `${pad(Math.floor(h))}:${pad(Math.round((h % 1) * 60) % 60)}`

const REASONS = {
  A: ['Cliente ausente', 'No contesta', 'Dirección no encontrada', 'Reprogramado por el cliente'],
  B: ['Rechazó el pedido', 'Sin efectivo', 'Cambió de opinión'],
  C: ['Producto averiado', 'Producto equivocado'],
} as const

/**
 * A made-up file in the format the loader reads: 12 days of failed deliveries with coordinates, hours, COD value,
 * reason and the outcome of the second attempt. It lets anyone try the loader without having data at hand.
 */
export function sampleCsv(): string {
  const r = mulberry32(2026)
  const lines = ['fecha,hora,latitud,longitud,municipio,valor_cod,motivo,reintento_entregado,mensajero']
  for (let day = 0; day < 12; day++) {
    const incidents = generateIncidents({ ...defaultParams, volume: 500, failureRate: 0.16 }, ASSUMPTIONS, 900 + day)
    incidents.forEach((q, i) => {
      const reason = REASONS[q.grade][Math.floor(r() * REASONS[q.grade].length)]
      const odds = q.grade === 'A' ? 0.55 : q.grade === 'B' ? 0.7 : 0
      const retry = q.grade === 'C' ? '' : r() < odds ? 'Sí' : 'No'
      const [lat, lon] = [q.lat + (r() - 0.5) * 0.008, q.lon + (r() - 0.5) * 0.008]
      const m = places.municipalities.find((x) => x.name === q.municipality)?.name ?? q.municipality
      lines.push([`2026-03-${pad(2 + day)}`, hhmm(q.hour), lat.toFixed(5), lon.toFixed(5), m, Math.round(q.cod / 1000) * 1000, reason, retry, `M${pad(1 + ((i * 7 + day) % 20))}`].join(','))
    })
  }
  return lines.join('\n')
}
