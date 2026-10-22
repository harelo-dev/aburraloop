import { describe, expect, it } from 'vitest'
import { buildDataset, detectMapping, guessOutcome, matchMunicipality, parseGrade, parseMoment, parseMoney, type Outcome } from '../src/ingest/map'
import { detectDelimiter, parseCsv, toTable } from '../src/ingest/table'
import { defaultParams, simulate } from '../src/sim/simulate'
import exampleCsv from '../public/ejemplo-novedades.csv?raw'

describe('parseCsv', () => {
  it('detects the delimiter and honours quotes', () => {
    const text = 'a;b;c\n"x;1";"he said ""hi""";3\n'
    expect(detectDelimiter(text)).toBe(';')
    expect(parseCsv(text)).toEqual([['a', 'b', 'c'], ['x;1', 'he said "hi"', '3']])
  })

  it('handles CRLF, a BOM and a missing final newline', () => {
    expect(parseCsv('﻿a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('skips blank lines and junk above the header', () => {
    const t = toTable([[null, null], ['Reporte', null], ['Ciudad', 'Estado'], ['Bello', 'Entregado']])
    expect(t.headers).toEqual(['Ciudad', 'Estado'])
    expect(t.rows).toHaveLength(1)
  })
})

describe('values', () => {
  it('reads money in Colombian and English formats', () => {
    expect(parseMoney('$1.250.000')).toBe(1250000)
    expect(parseMoney('1,250,000')).toBe(1250000)
    expect(parseMoney('1.250,50')).toBe(1250.5)
    expect(parseMoney('1250.5')).toBe(1250.5)
    expect(parseMoney('85.000')).toBe(85000)
    expect(parseMoney('COP 85000')).toBe(85000)
    expect(parseMoney('gratis')).toBeNull()
  })

  it('reads hours and dates', () => {
    expect(parseMoment('14:30').hour).toBeCloseTo(14.5)
    expect(parseMoment('2:30 pm').hour).toBeCloseTo(14.5)
    expect(parseMoment('12:15 a. m.').hour).toBeCloseTo(0.25)
    expect(parseMoment('9').hour).toBe(9)
    expect(parseMoment(0.5).hour).toBe(12)
    expect(parseMoment('2025-03-04 16:45:10')).toEqual({ hour: 16.75, date: '2025-03-04' })
    expect(parseMoment('04/03/2025')).toEqual({ hour: null, date: '2025-03-04' })
    expect(parseMoment(new Date(Date.UTC(2025, 2, 4, 9, 0)))).toEqual({ hour: 9, date: '2025-03-04' })
    expect(parseMoment('sin hora')).toEqual({ hour: null, date: null })
  })

  it('reads grades', () => {
    expect(parseGrade('b')).toBe('B')
    expect(parseGrade('Grado C')).toBe('C')
    expect(parseGrade('D')).toBeNull()
  })

  it('matches municipalities despite accents and suffixes', () => {
    expect(matchMunicipality('ITAGUI')?.id).toBe('itagui')
    expect(matchMunicipality('Itagüí - Antioquia')?.id).toBe('itagui')
    expect(matchMunicipality('La Estrella')?.id).toBe('laestrella')
    expect(matchMunicipality('Rionegro')).toBeNull()
  })

  it('guesses what a result value means', () => {
    const g = (v: string): Outcome => guessOutcome(v)
    expect(g('Entregado')).toBe('delivered')
    expect(g('No entregado')).toBe('failed')
    expect(g('Devuelto al CEDI')).toBe('failed')
    expect(g('Novedad')).toBe('failed')
    expect(g('Fallido')).toBe('failed')
    expect(g('Si')).toBe('delivered')
    expect(g('0')).toBe('failed')
    expect(g('En ruta')).toBe('ignore')
  })
})

const sample = (rows: string[][], headers: string[]) => toTable([headers, ...rows])

describe('mapping', () => {
  it('finds columns whatever they are called', () => {
    const t = sample(
      [['Bello', 'Entregado', '$85.000', '14:30', '04/03/2025'], ['Itagüí', 'Devuelto', '$120.000', '9:10', '04/03/2025']],
      ['Ciudad destino', 'Estado envío', 'Valor a recaudar', 'Hora entrega', 'Fecha'],
    )
    expect(detectMapping(t)).toEqual({ municipio: 0, resultado: 1, cod: 2, hora: 3, fecha: 4 })
  })

  it('finds coordinates by their values, even under unhelpful headers or swapped', () => {
    const rows = Array.from({ length: 20 }, (_, i) => [String(-75.58 + i / 1000), String(6.24 + i / 1000), 'x'])
    const t = sample(rows, ['A', 'B', 'C'])
    const m = detectMapping(t)
    expect(m.lat).toBe(1)
    expect(m.lon).toBe(0)
  })

  it('does not take a text column as money', () => {
    const t = sample([['Bello', 'abc'], ['Bello', 'def']], ['Municipio', 'Valor'])
    expect(detectMapping(t).cod).toBeUndefined()
  })
})

describe('buildDataset', () => {
  const rowsFor = (day: string, delivered: number, failed: number) => [
    ...Array.from({ length: delivered }, () => ['Medellín', 'Entregado', day]),
    ...Array.from({ length: failed }, (_, i) => [['Medellín', 'Bello', 'Envigado'][i % 3], 'Devuelto', day]),
  ]
  const table = sample([...rowsFor('01/03/2025', 40, 12), ...rowsFor('02/03/2025', 50, 15)], ['Ciudad', 'Estado', 'Fecha'])
  const outcomes: Record<string, Outcome> = { Entregado: 'delivered', Devuelto: 'failed' }

  it('splits by day and counts dispatches from delivered plus failed', () => {
    const { dataset, report } = buildDataset(table, { municipio: 0, resultado: 1, fecha: 2 }, { outcomes })
    expect(dataset!.days.map((d) => [d.label, d.volume, d.failures.length])).toEqual([['2025-03-01', 52, 12], ['2025-03-02', 65, 15]])
    expect(report.failed).toBe(27)
    expect(report.filled).toContain('el valor a cobrar')
  })

  it('drops failures it cannot place and says why', () => {
    const t = sample([...rowsFor('01/03/2025', 5, 12), ['Rionegro', 'Devuelto', '01/03/2025']], ['Ciudad', 'Estado', 'Fecha'])
    const { report } = buildDataset(t, { municipio: 0, resultado: 1, fecha: 2 }, { outcomes })
    expect(report.discarded['Municipio fuera del Valle de Aburrá o no reconocido']).toBe(1)
    expect(report.unknownPlaces).toEqual(['Rionegro'])
  })

  it('refuses a dataset with too few failures', () => {
    const t = sample(rowsFor('01/03/2025', 50, 3), ['Ciudad', 'Estado', 'Fecha'])
    const { dataset, report } = buildDataset(t, { municipio: 0, resultado: 1, fecha: 2 }, { outcomes })
    expect(dataset).toBeNull()
    expect(report.warnings[0]).toMatch(/al menos/)
  })

  it('treats every row as a failure when there is no result column', () => {
    const t = sample(Array.from({ length: 30 }, () => ['Sabaneta']), ['Municipio'])
    const { dataset } = buildDataset(t, { municipio: 0 }, { outcomes: {}, volumePerDay: 300 })
    expect(dataset!.days[0].volume).toBe(300)
    expect(dataset!.days[0].failures).toHaveLength(30)
  })

  it('keeps exact coordinates and rejects points outside the valley', () => {
    const rows = [...Array.from({ length: 12 }, () => ['6.2442', '-75.5812']), ['4.7110', '-74.0721']]
    const t = sample(rows, ['Latitud', 'Longitud'])
    const { dataset, report } = buildDataset(t, { lat: 0, lon: 1 }, { outcomes: {}, volumePerDay: 100 })
    expect(dataset!.days[0].failures).toHaveLength(12)
    expect(report.discarded['Coordenadas fuera del Valle de Aburrá']).toBe(1)
  })
})

describe('simulating uploaded data', () => {
  const rows = Array.from({ length: 90 }, (_, i) => [['Medellín', 'Bello', 'Itagüí', 'Envigado'][i % 4], '$90.000', 'B'])
  const { dataset } = buildDataset(sample(rows, ['Ciudad', 'Valor', 'Grado']), { municipio: 0, cod: 1, grado: 2 }, { outcomes: {}, volumePerDay: 600 })
  const p = { ...defaultParams, data: dataset!, volume: 600, failureRate: 0.15 }

  it('uses the uploaded failures, not synthetic ones', () => {
    const r = simulate(p)
    expect(r.failed).toBe(90)
    expect(r.incidents.every((q) => q.cod === 90000 && q.grade === 'B')).toBe(true)
    expect(new Set(r.incidents.map((q) => q.municipality)).size).toBeGreaterThan(1)
  })

  it('is deterministic and still respects van capacity', () => {
    expect(simulate(p)).toEqual(simulate(p))
    simulate({ ...p, vans: 3, maxMinutes: 45 }).vans.forEach((v) => expect(v.handled).toBeLessThanOrEqual(80))
  })

  it('with 0 vans everything returns to the CEDI', () => {
    const r = simulate({ ...p, vans: 0 })
    expect(r.saved).toBe(0)
    expect(r.returned).toBe(90)
  })
})

describe('the example file', () => {
  it('maps end to end with no help', async () => {
    const { readTable } = await import('../src/ingest/table')
    const { distinctValues } = await import('../src/ingest/map')
    const file = new File([exampleCsv], 'ejemplo-novedades.csv')
    const t = await readTable(file)
    const m = detectMapping(t)
    expect(m).toEqual({ municipio: 1, resultado: 2, cod: 3, fecha: 4, hora: 5 })
    const outcomes = Object.fromEntries(distinctValues(t, m.resultado!).map((d) => [d.value, guessOutcome(d.value)]))
    expect(outcomes).toMatchObject({ Entregado: 'delivered', 'No entregado': 'failed', Devuelto: 'failed', 'Cliente ausente': 'failed', Novedad: 'failed' })
    const { dataset, report } = buildDataset(t, m, { outcomes })
    expect(dataset!.days).toHaveLength(5)
    expect(report.discarded).toEqual({})
    const rate = report.failed / report.used
    expect(rate).toBeGreaterThan(0.12)
    expect(rate).toBeLessThan(0.2)
  })
})
