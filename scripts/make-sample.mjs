// Writes public/ejemplo-novedades.csv: a made-up export with deliberately "foreign" column names,
// semicolon delimiter, Colombian money and dd/mm/yyyy dates, to show that the loader maps any layout.
import { writeFileSync } from 'node:fs'

let s = 20250301
const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
const towns = [['Medellín', 48], ['Bello', 12], ['Itagüí', 10], ['Envigado', 8], ['Copacabana', 6], ['Sabaneta', 5], ['La Estrella', 4], ['Girardota', 4], ['Caldas', 3]]
const pick = () => { let u = rnd() * towns.reduce((t, [, w]) => t + w, 0); return towns.find(([, w]) => (u -= w) < 0)[0] }
const money = (n) => '$' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const fail = ['No entregado', 'Devuelto', 'Cliente ausente', 'Novedad']
const lines = ['Guía;Ciudad destino;Estado del envío;Valor a recaudar;Fecha de despacho;Hora de entrega']
let n = 1
for (let day = 3; day <= 7; day++) {
  const total = 300 + Math.floor(rnd() * 120)
  for (let i = 0; i < total; i++) {
    const failed = rnd() < 0.16
    const h = 8 + Math.floor(rnd() * 11), m = Math.floor(rnd() * 60)
    lines.push([
      `AB${String(n++).padStart(6, '0')}`, pick(),
      failed ? fail[Math.floor(rnd() * fail.length)] : 'Entregado',
      money(Math.round((40000 + rnd() * 260000) / 1000) * 1000),
      `0${day}/03/2025`, `${h}:${String(m).padStart(2, '0')}`,
    ].join(';'))
  }
}
writeFileSync(new URL('../public/ejemplo-novedades.csv', import.meta.url), lines.join('\r\n') + '\r\n')
console.log(`${lines.length - 1} filas`)
