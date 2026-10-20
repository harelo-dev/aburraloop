import type { GeoPoint } from './ingest'

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
/** left, top, right, bottom of the grid, so an address only matches inside the valley. */
const VIEWBOX = '-75.72,6.48,-75.28,6.02'
const CACHE_PREFIX = 'aburraloop.geo.v1:'

export interface GeoCache {
  /** undefined: never asked. null: asked and nothing usable came back. */
  get(key: string): GeoPoint | null | undefined
  set(key: string, value: GeoPoint | null): void
  clear(): void
}

export function memoryCache(): GeoCache {
  const m = new Map<string, GeoPoint | null>()
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v), clear: () => m.clear() }
}

/** Remembers answers in this browser so a file is not looked up twice. Works without storage. */
export function browserCache(): GeoCache {
  return {
    get(key) {
      try {
        const raw = localStorage.getItem(CACHE_PREFIX + key)
        return raw === null ? undefined : (JSON.parse(raw) as GeoPoint | null)
      } catch { return undefined }
    },
    set(key, value) {
      try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value)) } catch { /* full or blocked */ }
    },
    clear() {
      try {
        Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k))
      } catch { /* blocked */ }
    },
  }
}

/** Number of addresses remembered in this browser. */
export function cachedCount() {
  try { return Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).length } catch { return 0 }
}

interface NominatimHit { lat: string; lon: string; category?: string; type?: string; addresstype?: string }

/** Street and neighbourhood hits are usable on a 1 km grid; a whole town or district is not, so it falls back to the municipality. */
export function qualityOf(hit: NominatimHit): GeoPoint['quality'] | null {
  const t = hit.addresstype ?? hit.type ?? ''
  if (['house', 'building', 'apartments', 'residential_building'].includes(t) || hit.category === 'building') return 'house'
  if (['road', 'street', 'path', 'pedestrian', 'service', 'tertiary', 'secondary', 'primary', 'residential', 'unclassified', 'trunk'].includes(t) || hit.category === 'highway') return 'street'
  if (['neighbourhood', 'suburb', 'quarter', 'city_district', 'borough', 'hamlet', 'village'].includes(t)) return 'neighbourhood'
  return null
}

export interface GeocodeOptions {
  fetchFn?: typeof fetch
  /** Nominatim's usage policy allows one request per second. */
  delayMs?: number
  cache?: GeoCache
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
}

export interface GeocodeRun {
  results: (GeoPoint | null)[]
  requests: number
  stopped: 'rate-limit' | 'network' | 'cancelled' | null
}

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))

/**
 * Looks up each chain of search texts (the full address first, then the street alone) and keeps the first usable
 * answer. Identical chains are looked up once. If the service refuses or the network drops, the run stops and what
 * was found so far is returned, so the rest falls back to the municipality instead of being lost.
 */
export async function geocodeAll(chains: string[][], opts: GeocodeOptions = {}): Promise<GeocodeRun> {
  const fetchFn = opts.fetchFn ?? fetch
  const delayMs = opts.delayMs ?? 1100
  const cache = opts.cache ?? memoryCache()
  const unique = [...new Set(chains.map((c) => JSON.stringify(c)))].map((k) => JSON.parse(k) as string[])
  const answers = new Map<string, GeoPoint | null>()
  let requests = 0
  let lastCall = 0
  let stopped: GeocodeRun['stopped'] = null

  const ask = async (query: string): Promise<GeoPoint | null> => {
    const known = cache.get(query)
    if (known !== undefined) return known
    const wait = lastCall + delayMs - Date.now()
    if (wait > 0) await sleep(wait)
    lastCall = Date.now()
    requests++
    const url = `${ENDPOINT}?format=jsonv2&limit=1&countrycodes=co&accept-language=es&bounded=1&viewbox=${VIEWBOX}&q=${encodeURIComponent(query)}`
    const res = await fetchFn(url, { signal: opts.signal, headers: { Accept: 'application/json' } })
    if (res.status === 429 || res.status === 403) throw new Error('rate-limit')
    if (!res.ok) throw new Error('network')
    const hits = (await res.json()) as NominatimHit[]
    const quality = hits[0] ? qualityOf(hits[0]) : null
    const value = hits[0] && quality ? { lat: Number(hits[0].lat), lon: Number(hits[0].lon), quality } : null
    cache.set(query, value)
    return value
  }

  let done = 0
  for (const chain of unique) {
    if (opts.signal?.aborted) { stopped = 'cancelled'; break }
    try {
      let found: GeoPoint | null = null
      for (const q of chain) { found = await ask(q); if (found) break }
      answers.set(JSON.stringify(chain), found)
    } catch (e) {
      stopped = opts.signal?.aborted ? 'cancelled' : (e as Error).message === 'rate-limit' ? 'rate-limit' : 'network'
      break
    }
    opts.onProgress?.(++done, unique.length)
  }
  return { results: chains.map((c) => answers.get(JSON.stringify(c)) ?? null), requests, stopped }
}
