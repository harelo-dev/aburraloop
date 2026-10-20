import { describe, expect, it } from 'vitest'
import { band, buildSummary, NEVER_INCLUDED } from '../src/summary'
import { bestConfig, failureCost, netRange, withConfig } from '../src/sim/analysis'
import { defaultParams } from '../src/sim/simulate'

describe('bands', () => {
  it('turns an exact figure into a range', () => {
    expect(band(620, [150, 300, 500, 700])).toBe('500 a 699')
    expect(band(150, [150, 300])).toBe('150 a 299')
    expect(band(100, [150, 300])).toBe('menos de 150')
    expect(band(5000, [150, 300, 700])).toBe('700 o más')
  })
})

describe('the scenario summary', () => {
  const best = { config: 'intercept' as const, vans: 1, net: 231_400 }
  const s = buildSummary(defaultParams, best, 'estimaciones del modo guiado')
  it('has bands and no exact figure', () => {
    expect(s.despachos_por_dia).toBe('500 a 699')
    expect(s.tasa_de_novedad).toBe('14% a 17%')
    expect(s.neto_diario_estimado).toBe('$100 mil a $299 mil')
    expect(JSON.stringify(s)).not.toContain('231')
  })
  it('says what it never contains and has no field for rows or places', () => {
    expect(s.nunca_incluye).toEqual(NEVER_INCLUDED)
    for (const key of ['filas', 'direcciones', 'coordenadas', 'latitud', 'longitud', 'incidentes']) expect(Object.keys(s)).not.toContain(key)
  })
  it('adds only the size of the file when there is one', () => {
    expect(s.dias_de_datos).toBeUndefined()
    const r = buildSummary(defaultParams, best, 'archivo propio', { days: 12, used: 648 } as never)
    expect(r.dias_de_datos).toBe('10 a 19')
    expect(r.fallos_en_el_archivo).toBe('300 a 999')
  })
  it('reports no gain when no setup pays', () => {
    expect(buildSummary(defaultParams, { config: 'none', vans: 0, net: 0 }, 'valores de la demo').neto_diario_estimado).toBe('sin ganancia')
  })
})

describe('best setup and its range', () => {
  it('picks the setup with the highest net, never a losing one', () => {
    const b = bestConfig(defaultParams)
    for (const row of b.rows) for (const c of ['intercept', 'rounds', 'roundsPending'] as const) expect(row[c].net).toBeLessThanOrEqual(Math.max(b.net, 0) + 1e-6)
    if (b.config === 'none') expect(b.net).toBe(0)
  })
  it('the range brackets the point estimate', () => {
    const b = bestConfig(defaultParams)
    if (b.config === 'none') return
    const [lo, hi] = netRange(defaultParams, b.config, b.vans, 2, 10)
    expect(lo).toBeLessThanOrEqual(b.net)
    expect(hi).toBeGreaterThanOrEqual(b.net)
  })
  it('withConfig maps the setups to the simulator options', () => {
    expect(withConfig(defaultParams, 'roundsPending', 2)).toMatchObject({ mode: 'rounds', skipEmptyVisits: true, vans: 2 })
    expect(withConfig(defaultParams, 'intercept', 1)).toMatchObject({ mode: 'intercept', vans: 1 })
  })
})

describe('what failures cost', () => {
  it('scales with the number of failures', () => {
    const a = failureCost(defaultParams), b = failureCost({ ...defaultParams, volume: 1200 })
    expect(b.perDay).toBeGreaterThan(a.perDay * 1.8)
    expect(a.perFailure).toBeGreaterThan(10_000)
  })
})
