import { useEffect, useMemo, useRef, useState } from 'react'
import { MapView, type RateCell } from './MapView'
import { ARC_HOURS, clock, countAt, dayRange } from './replay'
import type { Params, PlaceError, Result } from './sim/simulate'

/** Simulated hours per real second. */
const SPEED = 1

interface Props { result: Result; params: Params; rateCells?: RateCell[]; overall?: number; showRates?: boolean; onMoveVan?: (index: number, lat: number, lon: number) => PlaceError | null }

/**
 * The map plus a play button for the day. The clock lives here, not in App, so a 60 fps animation
 * does not re-render the whole page.
 */
export function DayReplay(props: Props) {
  const { result, params, showRates } = props
  const [start, end] = useMemo(() => dayRange(result.incidents), [result])
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const [t, setT] = useState(end)
  const [playing, setPlaying] = useState(false)
  const raf = useRef(0)

  // A new simulated day, or new data, starts again from the full picture.
  useEffect(() => { setPlaying(false); setT(end) }, [start, end, result])

  useEffect(() => {
    if (!playing) return
    if (reduced) {
      // No travelling animation: step through the day half an hour at a time.
      const id = window.setInterval(() => setT((o) => (o + 0.5 >= end ? (setPlaying(false), end) : o + 0.5)), 700)
      return () => window.clearInterval(id)
    }
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      setT((o) => {
        const next = o + dt * SPEED
        if (next >= end + ARC_HOURS) { setPlaying(false); return end }
        return next
      })
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [playing, end, reduced])

  const play = () => {
    if (playing) { setPlaying(false); return }
    // Playing from the end (or from "everything shown") restarts the day.
    setT((o) => (o >= end ? start : o))
    setPlaying(true)
  }
  const seek = (v: number) => { setPlaying(false); setT(v) }

  // At the end of the day, and not playing, show everything finished.
  const mapHour = t >= end && !playing ? 100 : t
  const shown = Math.min(t, end)
  const c = useMemo(() => countAt(result.incidents, shown), [result, shown])
  const canReplay = !showRates && result.incidents.length > 0

  return (
    <>
      <MapView {...props} hour={mapHour} />
      {canReplay && (
        <div className="replay">
          <button type="button" className="play" onClick={play} aria-label={playing ? 'Pausar el día' : 'Reproducir el día'}>
            {playing ? 'Pausar' : t >= end ? 'Reproducir el día' : 'Seguir'}
          </button>
          <label className="clock">
            <span>{clock(shown)}</span>
            <input type="range" min={start} max={end} step={0.1} value={shown} onChange={(e) => seek(+e.target.value)} aria-label="Hora del día" aria-valuetext={`${clock(shown)} horas`} />
          </label>
          <output className="count">
            {c.failed} fallos · <b className="good">{c.saved} salvados</b> · <b className="bad">{c.returned} vuelven al CEDI</b>
          </output>
          <p className="hint tight">{params.mode === 'rounds' ? 'Cada pulso es un fallo. En este modo la van recorre a las motos, así que no se dibuja un viaje por paquete.' : 'Cada pulso es un fallo; el arco muestra adónde va: a la van (verde) o al CEDI (rojo). La curva es ilustrativa, no una ruta.'}</p>
        </div>
      )}
    </>
  )
}
