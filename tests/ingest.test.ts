import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import {
  addressQueries, buildData, classifyReason, detectMapping, matchMunicipality, parseBool, parseCombinedCoords, parseDate, parseHour,
  parseLatLon, parseMoney, parseStatus, prepareRows, suggest, type Row,
} from '../src/data/ingest'
import { sampleCsv, sampleDeliveriesCsv } from '../src/data/sample'
import { geocodeAll, memoryCache, qualityOf } from '../src/data/geocode'
import { ASSUMPTIONS, defaultParams, generateIncidents, simulate } from '../src/sim/simulate'
import { meanOver, placementComparison } from '../src/sim/analysis'

describe('detecting columns', () => {
  it('recognises Spanish headers with accents and spaces', () => {
    const m = detectMapping(['Dirección', 'Municipio', 'Fecha', 'Hora', 'Valor COD', 'Motivo', 'Reintento', 'Mensajero'])
    expect(m).toMatchObject({ address: 'Dirección', municipality: 'Municipio', date: 'Fecha', time: 'Hora', cod: 'Valor COD', reason: 'Motivo', retry: 'Reintento', courier: 'Mensajero' })
  })
  it('uses lat/lon over a coordinates column, and one datetime column for date and hour', () => {
    const m = detectMapping(['latitud', 'longitud', 'coordenadas', 'Fecha Hora'])
    expect(m.lat).toBe('latitud')
    expect(m.lon).toBe('longitud')
    expect(m.coords).toBeUndefined()
    expect(m.date).toBe('Fecha Hora')
    expect(m.time).toBe('Fecha Hora')
  })
})

describe('reading values', () => {
  it('parses money in Colombian and US formats', () => {
    expect(parseMoney('$ 120.000')).toBe(120000)
    expect(parseMoney('120,000')).toBe(120000)
    expect(parseMoney('1.234,56')).toBe(1234.56)
    expect(parseMoney('85000')).toBe(85000)
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('sin valor')).toBeNull()
  })
  it('parses coordinates with decimal commas and swaps an inverted pair', () => {
    expect(parseLatLon('6,2442', '-75,5812')).toEqual({ lat: 6.2442, lon: -75.5812 })
    expect(parseLatLon('-75.5812', '6.2442')).toEqual({ lat: 6.2442, lon: -75.5812 })
    expect(parseLatLon('0', '0')).toBeNull()
    expect(parseLatLon('abc', '1')).toBeNull()
  })
  it('parses a coordinates cell in one column', () => {
    expect(parseCombinedCoords('6.2442, -75.5812')).toEqual({ lat: 6.2442, lon: -75.5812 })
    expect(parseCombinedCoords('6,2442; -75,5812')).toEqual({ lat: 6.2442, lon: -75.5812 })
    expect(parseCombinedCoords('Calle 10 # 43-50')).toBeNull()
  })
  it('reads the hour from times and datetimes', () => {
    expect(parseHour('14:30')).toBe(14.5)
    expect(parseHour('2026-03-10 09:15:00')).toBeCloseTo(9.25, 6)
    expect(parseHour('2026-03-10T16:30:00')).toBe(16.5)
    expect(parseHour('2:30 PM')).toBe(14.5)
    expect(parseHour('12:05 AM')).toBeCloseTo(5 / 60, 6)
    expect(parseHour('mañana')).toBeNull()
    expect(parseHour('25:00')).toBeNull()
  })
  it('reads dates day first for slashes', () => {
    expect(parseDate('10/03/2026')).toBe('2026-03-10')
    expect(parseDate('2026-03-10 14:00')).toBe('2026-03-10')
    expect(parseDate('31/02/2026')).toBeNull()
    expect(parseDate('nada')).toBeNull()
  })
  it('reads yes and no', () => {
    expect(parseBool('Sí')).toBe(true)
    expect(parseBool('entregado')).toBe(true)
    expect(parseBool('NO')).toBe(false)
    expect(parseBool('quizás')).toBeNull()
  })
  it('guesses the grade from the reason', () => {
    expect(classifyReason('Cliente ausente')).toBe('A')
    expect(classifyReason('Dirección incorrecta')).toBe('A')
    expect(classifyReason('Rechazó el pedido')).toBe('B')
    expect(classifyReason('Producto averiado')).toBe('C')
    expect(classifyReason('otro')).toBeNull()
  })
  it('matches municipalities ignoring accents', () => {
    expect(matchMunicipality('medellin')).toBe('Medellín')
    expect(matchMunicipality('ITAGUI')).toBe('Itagüí')
    expect(matchMunicipality('La Estrella, Antioquia')).toBe('La Estrella')
    expect(matchMunicipality('Bogotá')).toBeNull()
  })
})

describe('addresses', () => {
  it('expands abbreviations, drops the unit and adds a street-only fallback', () => {
    const q = addressQueries('Cra 70 # 44-20 Apto 301', 'Medellín')
    expect(q[0]).toBe('Carrera 70 44-20, Medellín')
    expect(q[1]).toBe('Carrera 70, Medellín')
  })
  it('keeps a lone street as a single query', () => {
    expect(addressQueries('Calle 10 Sur', 'Envigado')).toEqual(['Calle 10 Sur, Envigado'])
  })
})

describe('geocoding', () => {
  const hit = (extra: object) => ({ ok: true, status: 200, json: async () => [{ lat: '6.2', lon: '-75.57', ...extra }] }) as Response
  it('maps Nominatim types to a quality and drops town-level answers', () => {
    expect(qualityOf({ lat: '', lon: '', addresstype: 'house' })).toBe('house')
    expect(qualityOf({ lat: '', lon: '', category: 'highway', type: 'residential' })).toBe('street')
    expect(qualityOf({ lat: '', lon: '', addresstype: 'suburb' })).toBe('neighbourhood')
    expect(qualityOf({ lat: '', lon: '', addresstype: 'city' })).toBeNull()
  })
  it('asks once per distinct address, falls back to the street and remembers answers', async () => {
    let calls = 0
    const fetchFn = (async (url: string) => {
      calls++
      return decodeURIComponent(url).includes('q=Carrera 70 44-20') ? ({ ok: true, status: 200, json: async () => [] } as Response) : hit({ addresstype: 'road' })
    }) as unknown as typeof fetch
    const cache = memoryCache()
    const chains = [['Carrera 70 44-20, Medellín', 'Carrera 70, Medellín'], ['Carrera 70 44-20, Medellín', 'Carrera 70, Medellín']]
    const run = await geocodeAll(chains, { fetchFn, delayMs: 0, cache })
    expect(run.requests).toBe(2)
    expect(run.results[0]).toMatchObject({ quality: 'street' })
    expect(run.results[1]).toEqual(run.results[0])
    await geocodeAll(chains, { fetchFn, delayMs: 0, cache })
    expect(calls).toBe(2)
  })
  it('stops on a rate limit and keeps what it already had', async () => {
    let n = 0
    const fetchFn = (async () => (++n === 1 ? hit({ addresstype: 'house' }) : ({ ok: false, status: 429 } as Response))) as unknown as typeof fetch
    const run = await geocodeAll([['a'], ['b'], ['c']], { fetchFn, delayMs: 0 })
    expect(run.stopped).toBe('rate-limit')
    expect(run.results[0]).not.toBeNull()
    expect(run.results[1]).toBeNull()
  })
})

const CSV = `Dirección;Municipio;Fecha;Hora;Valor COD;Motivo;Reintento
Cra 70 # 44-20;Medellín;10/03/2026;09:15;"$ 120.000";Cliente ausente;Sí
Calle 50 # 50-10;Envigado;10/03/2026;14:40;95.000;Rechazó el pedido;No
;Bello;11/03/2026;11:00;110.000;Producto averiado;
Calle 1 # 1-1;Bogotá;11/03/2026;12:00;90.000;Cliente ausente;
`

describe('building a dataset from a file', () => {
  const parsed = Papa.parse<Row>(CSV, { header: true, skipEmptyLines: 'greedy' })
  it('reads a semicolon file with quotes and decimal formats', () => {
    expect(parsed.meta.delimiter).toBe(';')
    expect(parsed.data).toHaveLength(4)
    const m = detectMapping(parsed.meta.fields!)
    const rows = prepareRows(parsed.data, m, { 'Cliente ausente': 'A', 'Rechazó el pedido': 'B', 'Producto averiado': 'C' }, 'A')
    expect(rows[0]).toMatchObject({ cod: 120000, hour: 9.25, date: '2026-03-10', grade: 'A', retry: true })
    expect(rows[1].grade).toBe('B')
    expect(rows[2].locator.kind).toBe('municipality')
    expect(rows[3].locator.kind).toBe('address')
  })
  it('falls back to the municipality, excludes what is outside the valley and reports it', () => {
    const m = detectMapping(parsed.meta.fields!)
    const rows = prepareRows(parsed.data, m, { 'Cliente ausente': 'A', 'Rechazó el pedido': 'B', 'Producto averiado': 'C' }, 'A')
    const geo = [{ lat: 6.2419, lon: -75.5958, quality: 'neighbourhood' as const }, null, null, null]
    const { data, report } = buildData('t.csv', rows, geo, { daysOverride: null, defaultGrade: 'A' })
    expect(report.rows).toBe(4)
    expect(report.used).toBe(3)
    expect(report.excluded.noLocation).toBe(1)
    expect(report.quality).toMatchObject({ neighbourhood: 1, municipality: 2 })
    expect(report.days).toBe(2)
    expect(data.incidents[1].sigmaKm).toBeGreaterThan(0)
    expect(data.incidents[0].sigmaKm).toBe(0)
  })
  it('flags a file that is too small to trust', () => {
    const m = detectMapping(parsed.meta.fields!)
    const rows = prepareRows(parsed.data, m, {}, 'A')
    const { report } = buildData('t.csv', rows, rows.map(() => null), { daysOverride: null, defaultGrade: 'A' })
    const s = suggest(report, 100)
    expect(s.warnings.join(' ')).toMatch(/poco confiable/)
    expect(s.failureRate).toBeCloseTo(report.used / report.days / 100, 6)
    expect(s.secondAttemptSuccess).toBeNull()
  })
})

describe('the simulator on real data', () => {
  const pool = Array.from({ length: 200 }, (_, i) => ({
    lat: 6.2442, lon: -75.5812, cell: 0, sigmaKm: 0, hour: 9 + (i % 7), cod: 100000, grade: (i % 3 === 0 ? 'A' : i % 3 === 1 ? 'B' : 'C') as 'A' | 'B' | 'C', municipality: 'Medellín',
  }))
  const data = { id: 'x', incidents: pool, municipalityWeights: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] }
  const p = { ...defaultParams, data }
  it('draws volume x rate failures from the pool, deterministically', () => {
    const a = generateIncidents(p, ASSUMPTIONS, 3), b = generateIncidents(p, ASSUMPTIONS, 3)
    expect(a).toHaveLength(Math.round(p.volume * p.failureRate))
    expect(a).toEqual(b)
    expect(new Set(a.map((q) => q.cell)).size).toBe(1)
    expect(a.every((q) => q.cod === 100000)).toBe(true)
  })
  it('runs every analysis on the pool', () => {
    expect(simulate(p).failed).toBe(Math.round(p.volume * p.failureRate))
    expect(Number.isFinite(meanOver(p).net)).toBe(true)
  })
  it('a better second-attempt rate recovers more', () => {
    const lo = meanOver({ ...p, secondAttemptSuccess: 0.3, gradeBSuccess: 0.3 }), hi = meanOver({ ...p, secondAttemptSuccess: 0.9, gradeBSuccess: 0.9 })
    expect(hi.recovered).toBeGreaterThan(lo.recovered)
  })
})

describe('delivered and failed rows', () => {
  it('reads the status column in Spanish', () => {
    expect(parseStatus('Entregado')).toBe('delivered')
    expect(parseStatus('No entregado')).toBe('failed')
    expect(parseStatus('Fallido')).toBe('failed')
    expect(parseStatus('Devuelto al CEDI')).toBe('failed')
    expect(parseStatus('pendiente')).toBeNull()
    expect(detectMapping(['Estado', 'Latitud', 'Longitud']).status).toBe('Estado')
  })

  const parsed = Papa.parse<Row>(sampleDeliveriesCsv(), { header: true, skipEmptyLines: 'greedy' })
  const mapping = detectMapping(parsed.meta.fields!)
  const rows = prepareRows(parsed.data, mapping, Object.fromEntries(parsed.data.map((r) => [r.motivo, classifyReason(r.motivo) ?? 'A'])), 'A')
  const { data, report } = buildData('e.csv', rows, rows.map(() => null), { daysOverride: null, defaultGrade: 'A' })

  it('measures rates and counts only failed rows as failures', () => {
    expect(mapping.status).toBe('estado')
    expect(report.rates).not.toBeNull()
    expect(report.rates!.level).toBe('cell')
    expect(report.used).toBe(report.rates!.failures)
    expect(report.rates!.attempts).toBeGreaterThan(report.used * 4)
    expect(report.rates!.overall).toBeGreaterThan(0.08)
    expect(report.rates!.overall).toBeLessThan(0.25)
    expect(report.days).toBe(12)
  })
  it('finds the places and hours that were made to fail more', () => {
    const byName = Object.fromEntries(report.rates!.byMunicipality.map((r) => [r.name, r]))
    expect(byName['Copacabana'].shrunk).toBeGreaterThan(byName['Envigado'].shrunk)
    expect(byName['Envigado'].flag).toBe('low')
    const hours = report.rates!.byHour
    expect(hours[4].raw).toBeGreaterThan(hours[0].raw)
  })
  it('suggests the dispatches per day from the file, with no need to ask', () => {
    const s = suggest(report, null)
    expect(s.dispatchesPerDay).toBeGreaterThan(300)
    expect(s.failureRate).toBeCloseTo(report.rates!.overall, 6)
  })
  it('smooths a cell with little evidence toward its municipality', () => {
    expect(data.exposure!.length).toBeGreaterThan(50)
    for (const e of data.exposure!) {
      expect(e.rate).toBeGreaterThanOrEqual(0)
      expect(e.rate).toBeLessThan(1)
    }
  })
  it('places vans by tendency and compares it with history', () => {
    const p = { ...defaultParams, vans: 2 as const, data, volume: 600, failureRate: report.rates!.overall }
    const trend = simulate({ ...p, placement: 'trend' })
    expect(trend.vans).toHaveLength(2)
    expect(new Set(trend.vans.map((v) => v.cell)).size).toBe(2)
    expect(placementComparison(p).map((r) => r.id)).toContain('trend')
    expect(placementComparison({ ...defaultParams }).map((r) => r.id)).not.toContain('trend')
  })
  it('without a status column nothing is measured', () => {
    const only = Papa.parse<Row>(sampleCsv(), { header: true, skipEmptyLines: 'greedy' })
    const m = detectMapping(only.meta.fields!)
    expect(m.status).toBeUndefined()
    const r = buildData('f.csv', prepareRows(only.data, m, {}, 'A'), only.data.map(() => null), { daysOverride: null, defaultGrade: 'A' })
    expect(r.report.rates).toBeNull()
    expect(r.data.exposure).toBeUndefined()
  })
})
