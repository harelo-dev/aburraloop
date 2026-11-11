import { useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import places from './data/places.json'
import travel from './data/travel.json'
import type { DayLayer } from './DayLayer'
import { buildArcs } from './replay'
import { minutesBetween, type Params, type PlaceError, type Result } from './sim/simulate'

const NOTICE: Record<PlaceError, string> = {
  outside: 'Fuera del valle: la van no puede ir ahí.',
  'near-cedi': 'Demasiado cerca del CEDI: no hay vans en la zona gris.',
  taken: 'Ya hay una van en esa celda.',
}
const STYLE = 'https://tiles.openfreemap.org/styles/positron'

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
  return {
    blocked: { type: 'FeatureCollection' as const, features: blocked },
    reach: { type: 'FeatureCollection' as const, features: reach },
    incidents: { type: 'FeatureCollection' as const, features: result.incidents.map((q) => point(q.lon, q.lat, { saved: q.saved, hour: q.hour })) },
    vans: { type: 'FeatureCollection' as const, features: result.vans.map((v, i) => point(v.lon, v.lat, { label: v.name, idx: i })) },
    couriers: { type: 'FeatureCollection' as const, features: result.couriers.map((c) => point(c.lon, c.lat)) },
    cedi: { type: 'FeatureCollection' as const, features: [point(cedi.lon, cedi.lat, { label: cedi.name })] },
  }
}

export interface RateCell { lat: number; lon: number; deliveries: number; rate: number }

export function MapView({ result, params, rateCells, overall, showRates, hour, onMoveVan }: { result: Result; params: Params; rateCells?: RateCell[]; overall?: number; showRates?: boolean; hour: number; onMoveVan?: (index: number, lat: number, lon: number) => PlaceError | null }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)
  const day = useRef<DayLayer | null>(null)
  const shown = useRef<number>(NaN)
  const latest = useRef({ result, params, rateCells, overall, showRates, hour, onMoveVan })
  const [notice, setNotice] = useState<string | null>(null)
  const stopDrag = useRef<() => void>(() => {})
  latest.current = { result, params, rateCells, overall, showRates, hour, onMoveVan }

  const push = () => {
    const m = map.current
    if (!m || !ready.current) return
    const d = build(latest.current.result, latest.current.params)
    const { rateCells: rc, overall: base, showRates: on } = latest.current
    const h = travel.step / 2
    const rateData = {
      type: 'FeatureCollection' as const,
      features: (rc ?? []).filter((c) => c.deliveries >= 5 && base).map((c) => ({
        type: 'Feature' as const, properties: { rel: c.rate / base! },
        geometry: { type: 'Polygon' as const, coordinates: [[[c.lon - h, c.lat - h], [c.lon + h, c.lat - h], [c.lon + h, c.lat + h], [c.lon - h, c.lat + h], [c.lon - h, c.lat - h]]] },
      })),
    }
    ;(m.getSource('rates') as GeoJSONSource).setData(rateData)
    m.setLayoutProperty('rates', 'visibility', on ? 'visible' : 'none')
    for (const k of ['blocked', 'reach', 'couriers', 'incidents', 'vans', 'cedi'] as const) (m.getSource(k) as GeoJSONSource).setData(d[k])
    const cedi = places.cedis.find((c) => c.id === latest.current.params.cedi)!
    day.current?.setData(on ? [] : buildArcs(latest.current.result, cedi),  latest.current.params.mode !== 'rounds', window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    shown.current = NaN
    pushHour()
  }

  /** The replay hour moves the pulses and arcs on the GPU; the dots only need a new filter about ten times a second. */
  const pushHour = () => {
    const m = map.current
    if (!m || !ready.current) return
    const h = latest.current.hour
    day.current?.setHour(h)
    const q = h >= 99 ? 99 : Math.floor(h * 10) / 10
    if (q !== shown.current) {
      shown.current = q
      m.setFilter('incidents', ['<=', ['get', 'hour'], q])
    }
  }

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current!, style: STYLE, center: [-75.55, 6.25], zoom: 10.2, attributionControl: { compact: true } })
    map.current = m
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    m.on('load', () => {
      const empty = { type: 'FeatureCollection' as const, features: [] }
      for (const k of ['rates', 'blocked', 'reach', 'couriers', 'incidents', 'vans', 'cedi']) m.addSource(k, { type: 'geojson', data: empty })
      m.addLayer({
        id: 'rates', type: 'fill', source: 'rates', layout: { visibility: 'none' },
        paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'rel'], 0.5, '#dcebe3', 1, '#f6e3a6', 1.6, '#e2806a', 2.4, '#a3231a'], 'fill-opacity': 0.62, 'fill-outline-color': 'rgba(0,0,0,0)' },
      })
      m.addLayer({ id: 'blocked', type: 'fill', source: 'blocked', paint: { 'fill-color': '#12201d', 'fill-opacity': 0.16, 'fill-outline-color': 'rgba(0,0,0,0)' } })
      m.addLayer({ id: 'reach', type: 'fill', source: 'reach', paint: { 'fill-color': '#0b7a6b', 'fill-opacity': 0.14, 'fill-outline-color': 'rgba(0,0,0,0)' } })
      m.addLayer({ id: 'couriers', type: 'circle', source: 'couriers', paint: { 'circle-radius': 5.5, 'circle-color': '#ffffff', 'circle-stroke-color': '#12201d', 'circle-stroke-width': 1.4, 'circle-opacity': 0.9 } })
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
      // three.js is only needed for the replay, so it loads after the map is already usable.
      import('./DayLayer').then(({ DayLayer }) => {
        if (map.current !== m) return
        day.current = new DayLayer()
        m.addLayer(day.current, 'cedi')
        push()
      })
      // Drag a van: it follows the pointer cell by cell, and the result is recalculated at each step.
      let dragging: number | null = null
      const canvas = m.getCanvas()
      const start = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
        const f = (e as { features?: { properties: { idx: number } }[] }).features?.[0]
        if (!f || !latest.current.onMoveVan) return
        e.preventDefault()
        dragging = f.properties.idx
        m.dragPan.disable()
        canvas.style.cursor = 'grabbing'
        setNotice(null)
      }
      const move = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
        if (dragging === null) return
        const err = latest.current.onMoveVan?.(dragging, e.lngLat.lat, e.lngLat.lng)
        setNotice(err ? NOTICE[err] : null)
      }
      const end = () => {
        if (dragging === null) return
        dragging = null
        m.dragPan.enable()
        canvas.style.cursor = ''
        setNotice(null)
      }
      m.on('mousedown', 'vans', start)
      m.on('touchstart', 'vans', start)
      m.on('mousemove', move)
      m.on('touchmove', move)
      m.on('mouseup', end)
      m.on('touchend', end)
      m.on('touchcancel', end)
      // Letting go outside the map must still end the drag.
      window.addEventListener('mouseup', end)
      window.addEventListener('touchend', end)
      stopDrag.current = () => { window.removeEventListener('mouseup', end); window.removeEventListener('touchend', end) }
      m.on('mouseenter', 'vans', () => { if (dragging === null && latest.current.onMoveVan) canvas.style.cursor = 'grab' })
      m.on('mouseleave', 'vans', () => { if (dragging === null) canvas.style.cursor = '' })
      ready.current = true
      push()
    })
    return () => { ready.current = false; day.current = null; stopDrag.current(); m.remove() }
  }, [])

  useEffect(push, [result, params, rateCells, overall, showRates])
  useEffect(pushHour, [hour])

  return (
    <div className="map-wrap">
      <div ref={el} className="map" role="img" aria-label="Mapa del Valle de Aburrá con paquetes fallidos, salvados y retornados" />
      {notice && <div className="map-note" role="status">{notice}</div>}
    </div>
  )
}
