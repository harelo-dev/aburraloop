// Precomputes road travel time (minutes) between every pair of grid cells in
// src/data/travel.json, using the public OSRM demo server. Run once after
// `npm run build:matrix`: `npm run build:cellmatrix`. The output is committed.
import { readFileSync, writeFileSync } from 'node:fs'

const travel = JSON.parse(readFileSync(new URL('../src/data/travel.json', import.meta.url)))
const cells = travel.cells
const CHUNK = 45
const UNREACHABLE = 99
const minutes = cells.map(() => new Array(cells.length).fill(UNREACHABLE))

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
const total = Math.ceil(cells.length / CHUNK) ** 2
let done = 0
for (let i = 0; i < cells.length; i += CHUNK) {
  for (let j = 0; j < cells.length; j += CHUNK) {
    const src = cells.slice(i, i + CHUNK)
    const dst = cells.slice(j, j + CHUNK)
    const coords = [...src, ...dst].map((p) => `${p.lon},${p.lat}`).join(';')
    const s = src.map((_, k) => k).join(';')
    const d = dst.map((_, k) => src.length + k).join(';')
    const url = `https://router.project-osrm.org/table/v1/driving/${coords}?sources=${s}&destinations=${d}&annotations=duration`
    let res
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await fetch(url)
        if (r.ok) { res = await r.json(); break }
      } catch { /* retry */ }
      await sleep(2000 * (attempt + 1))
    }
    if (!res || res.code !== 'Ok') throw new Error(`OSRM failed at ${i},${j}`)
    res.durations.forEach((row, a) => row.forEach((v, b) => {
      if (v != null) minutes[i + a][j + b] = Math.min(UNREACHABLE, Math.round(v / 60))
    }))
    console.log(`${++done}/${total}`)
    await sleep(1000)
  }
}

writeFileSync(
  new URL('../src/data/cell-minutes.json', import.meta.url),
  JSON.stringify({ unreachable: UNREACHABLE, source: travel.source, minutes }),
)
console.log('wrote cell-minutes.json')
