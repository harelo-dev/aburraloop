import { useEffect, useRef } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import places from './data/places.json'
import travel from './data/travel.json'
import { minutesBetween, type Params, type Result } from './sim/simulate'

const STYLE = 'https://tiles.openfreemap.org/styles/positron'
const MAX_LINES = 90

const point = (lon: number, lat: number, props: Record<string, unknown> = {}) => ({
  type: 'Feature' as const, properties: props, geometry: { type: 'Point' as const, coordinates: [lon, lat] },
})

function build(result: Result, params: Params) {
  const cedi = places.cedis.find((c) => c.id === params.cedi)!
  const h = travel.step / 2
  const cediIdx = travel.origins.indexOf(`cedi:${params.cedi}`)
  const square = (c: { lat: number; lon: number }) => ({
    type: 'Feature' as const, properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [[[c.lon - h, c.lat - h], [c.lon + h, c.lat - h], [c.lon + h, c.lat + h], [c.lon - h, c.lat + h], [c.lon - h, c.lat - h]]] },
  })
  const blocked = params.vans > 0 ? travel.cells.filter((c) => c.min[cediIdx] < params.minCediMinutes).map(square) : []
  const reach = travel.cells.filter((_, i) => result.vans.some((v) => minutesBetween(v.cell, i) <= params.maxMinutes)).map(square)
  const lines = result.incidents.filter((q) => !q.saved).slice(0, MAX_LINES).map((q) => ({
    type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: [[q.lon, q.lat], [cedi.lon, cedi.lat]] },
  }))
  return {
    blocked: { type: 'FeatureCollection' as const, features: blocked },
    reach: { type: 'FeatureCollection' as const, features: reach },
    lines: { type: 'FeatureCollection' as const, features: lines },
    incidents: { type: 'FeatureCollection' as const, features: result.incidents.map((q) => point(q.lon, q.lat, { saved: q.saved })) },
    vans: { type: 'FeatureCollection' as const, features: result.vans.map((v) => point(v.lon, v.lat, { label: v.name })) },
    cedi: { type: 'FeatureCollection' as const, features: [point(cedi.lon, cedi.lat, { label: cedi.name })] },
  }
}

export function MapView({ result, params }: { result: Result; params: Params }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)
  const latest = useRef({ result, params })
  latest.current = { result, params }

  const push = () => {
    const m = map.current
    if (!m || !ready.current) return
    const d = build(latest.current.result, latest.current.params)
    for (const k of ['blocked', 'reach', 'lines', 'incidents', 'vans', 'cedi'] as const) (m.getSource(k) as GeoJSONSource).setData(d[k])
  }

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current!, style: STYLE, center: [-75.55, 6.25], zoom: 10.2, attributionControl: { compact: true } })
    map.current = m
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    m.on('load', () => {
      const empty = { type: 'FeatureCollection' as const, features: [] }
      for (const k of ['blocked', 'reach', 'lines', 'incidents', 'vans', 'cedi']) m.addSource(k, { type: 'geojson', data: empty })
      m.addLayer({ id: 'blocked', type: 'fill', source: 'blocked', paint: { 'fill-color': '#12201d', 'fill-opacity': 0.16, 'fill-outline-color': 'rgba(0,0,0,0)' } })
      m.addLayer({ id: 'reach', type: 'fill', source: 'reach', paint: { 'fill-color': '#0b7a6b', 'fill-opacity': 0.14, 'fill-outline-color': 'rgba(0,0,0,0)' } })
      m.addLayer({ id: 'lines', type: 'line', source: 'lines', paint: { 'line-color': '#c9382c', 'line-opacity': 0.3, 'line-width': 1 } })
      m.addLayer({
        id: 'incidents', type: 'circle', source: 'incidents',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 13, 5], 'circle-color': ['case', ['get', 'saved'], '#0b7a6b', '#c9382c'], 'circle-opacity': 0.85, 'circle-stroke-color': '#fff', 'circle-stroke-width': 0.6 },
      })
      m.addLayer({ id: 'cedi', type: 'circle', source: 'cedi', paint: { 'circle-radius': 8, 'circle-color': '#fff', 'circle-stroke-color': '#12201d', 'circle-stroke-width': 3 } })
      m.addLayer({
        id: 'cedi-label', type: 'symbol', source: 'cedi',
        layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [1.1, 0], 'text-anchor': 'left', 'text-font': ['Noto Sans Bold'] },
        paint: { 'text-color': '#12201d', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
      })
      m.addLayer({ id: 'vans', type: 'circle', source: 'vans', paint: { 'circle-radius': 11, 'circle-color': '#12201d', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
      m.addLayer({
        id: 'van-labels', type: 'symbol', source: 'vans',
        layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-allow-overlap': true, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#fff' },
      })
      ready.current = true
      push()
    })
    return () => { ready.current = false; m.remove() }
  }, [])

  useEffect(push, [result, params])

  return <div ref={el} className="map" role="img" aria-label="Mapa del Valle de Aburrá con paquetes fallidos, salvados y retornados" />
}
