// Precomputes road travel time/distance from each van anchor and CEDI to a ~1 km grid
// over the valley, using the public OSRM demo server. Run once: `npm run build:matrix`.
// The output (src/data/travel.json) is committed, so the app needs no routing service.
import { readFileSync, writeFileSync } from 'node:fs'

const places = JSON.parse(readFileSync(new URL('../src/data/places.json', import.meta.url)))
const STEP = 0.01
const origins = [
  ...places.vanAnchors.map((p) => ({ key: `van:${p.id}`, ...p })),
  ...places.cedis.map((p) => ({ key: `cedi:${p.id}`, ...p })),
]

const kmBetween = (a, b) => {
  const dy = (a.lat - b.lat) * 111.2
  const dx = (a.lon - b.lon) * 111.2 * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot(dx, dy)
}

const cells = []
for (let lat = 6.04; lat <= 6.48; lat += STEP) {
  for (let lon = -75.7; lon <= -75.3; lon += STEP) {
    const c = { lat: +lat.toFixed(3), lon: +lon.toFixed(3) }
    if (places.municipalities.some((m) => kmBetween(c, m) <= 2 * m.sigmaKm + 0.8)) cells.push(c)
  }
}
console.log(`${cells.length} grid cells, ${origins.length} origins`)

const CHUNK = 90
const out = cells.map((c) => ({ ...c, min: [], km: [] }))
for (let i = 0; i < cells.length; i += CHUNK) {
  const dest = cells.slice(i, i + CHUNK)
  const coords = [...origins, ...dest].map((p) => `${p.lon},${p.lat}`).join(';')
  const src = origins.map((_, k) => k).join(';')
  const dst = dest.map((_, k) => origins.length + k).join(';')
  const url = `https://router.project-osrm.org/table/v1/driving/${coords}?sources=${src}&destinations=${dst}&annotations=duration,distance`
  let res
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url)
    if (r.ok) { res = await r.json(); break }
    await new Promise((ok) => setTimeout(ok, 2000 * (attempt + 1)))
  }
  if (!res || res.code !== 'Ok') throw new Error(`OSRM failed at chunk ${i}`)
  dest.forEach((_, j) => {
    origins.forEach((_, k) => {
      out[i + j].min.push(res.durations[k][j] == null ? null : +(res.durations[k][j] / 60).toFixed(1))
      out[i + j].km.push(res.distances[k][j] == null ? null : +(res.distances[k][j] / 1000).toFixed(1))
    })
  })
  console.log(`chunk ${i / CHUNK + 1}/${Math.ceil(cells.length / CHUNK)}`)
  await new Promise((ok) => setTimeout(ok, 1200))
}

const good = out.filter((c) => c.min.every((v) => v != null))
writeFileSync(
  new URL('../src/data/travel.json', import.meta.url),
  JSON.stringify({ step: STEP, origins: origins.map((o) => o.key), source: 'OSRM demo server, driving profile (car; motos are usually faster in traffic)', cells: good }),
)
console.log(`wrote ${good.length} cells`)
