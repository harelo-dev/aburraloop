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
 * A made-up file of failures only, in the format the loader reads: 12 days of failed deliveries with coordinates, hours, COD value,
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

/** How much more or less often each place and time fails in the made-up file with deliveries, so the rates have something to find. */
const MUNICIPALITY_FACTOR: Record<string, number> = {
  Medellín: 1, Bello: 1.6, Copacabana: 1.9, Girardota: 1.2, Barbosa: 1, Itagüí: 0.8, Envigado: 0.55, Sabaneta: 0.7, 'La Estrella': 1.1, Caldas: 1.4,
}
const hourFactor = (h: number) => (h < 10 ? 0.7 : h < 12 ? 0.85 : h < 14 ? 1.1 : h < 16 ? 1.35 : 1.7)
const WEEKDAY_FACTOR = [0.9, 1, 1, 1, 1.1, 1.4]

/**
 * A made-up file with every delivery of 12 working days, delivered and failed, where some municipalities, hours and
 * Saturdays fail more than others. It exists so the rates, the map and the placement by tendency can be tried
 * without a real operation. The differences are invented, not a finding about the valley.
 */
export function sampleDeliveriesCsv(): string {
  const r = mulberry32(77)
  const lines = ['fecha,hora,latitud,longitud,municipio,estado,valor_cod,motivo,reintento_entregado,mensajero']
  const days = [2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14]
  days.forEach((day, k) => {
    const weekday = k % 6
    generateIncidents({ ...defaultParams, volume: 420, failureRate: 1 }, ASSUMPTIONS, 3000 + day).forEach((q, i) => {
      const p = Math.min(0.6, 0.105 * (MUNICIPALITY_FACTOR[q.municipality] ?? 1) * hourFactor(q.hour) * WEEKDAY_FACTOR[weekday])
      const failed = r() < p
      const [lat, lon] = [q.lat + (r() - 0.5) * 0.008, q.lon + (r() - 0.5) * 0.008]
      const reason = failed ? REASONS[q.grade][Math.floor(r() * REASONS[q.grade].length)] : ''
      const retry = failed && q.grade !== 'C' ? (r() < (q.grade === 'A' ? 0.55 : 0.7) ? 'Sí' : 'No') : ''
      lines.push([`2026-03-${pad(day)}`, hhmm(q.hour), lat.toFixed(5), lon.toFixed(5), q.municipality, failed ? 'Fallido' : 'Entregado', Math.round(q.cod / 1000) * 1000, reason, retry, `M${pad(1 + ((i * 7 + day) % 20))}`].join(','))
    })
  })
  return lines.join('\n')
}
