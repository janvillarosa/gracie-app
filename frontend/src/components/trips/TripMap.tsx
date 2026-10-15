import React, {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { placeLabels, type LabelItem } from '@lib/trips/mapLabels'
import { shorten, type MapScene } from '@lib/trips/mapScene'
import type { MapViewProps } from './mapView'
import { mapsConfig, mapsEnabled } from './gmap/config'

export type { MapViewProps } from './mapView'

// Lazy: Google's script (and our map code) only load when a key is set, we are online and the
// map is actually shown.
const MapCanvas = lazy(() => import('./MapCanvas'))

const PAD = 56

function project(stops: MapScene['stops'], W: number, H: number) {
  if (!stops.length) return () => ({ x: W / 2, y: H / 2 })
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const p of stops) {
    minLat = Math.min(minLat, p.lat)
    maxLat = Math.max(maxLat, p.lat)
    minLng = Math.min(minLng, p.lng)
    maxLng = Math.max(maxLng, p.lng)
  }
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
  // A single stop still needs a span, or the scale divides by zero.
  const spanX = Math.max((maxLng - minLng) * k, 0.01)
  const spanY = Math.max(maxLat - minLat, 0.01)
  const scale = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY)
  const cx = (minLng + maxLng) / 2
  const cy = (minLat + maxLat) / 2
  return (p: { lat: number; lng: number }) => ({
    x: W / 2 + (p.lng - cx) * k * scale,
    y: H / 2 - (p.lat - cy) * scale,
  })
}

/** The map without Google: stops, route and labels on a plain paper ground. Always works (no
 *  key, no network) and follows the same rules as the real map: labels in priority order,
 *  the ones that would collide dropped, the next stop in a pill, a ring on the selected one. */
const PlainMap: React.FC<MapViewProps & { reason: string }> = ({
  scene,
  labelLimit,
  nextPrefix,
  hotId,
  title,
  onPinClick,
  reason,
}) => {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 600, h: 420 })
  const [over, setOver] = useState<string | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0)
        setSize((p) =>
          p.w === Math.round(r.width) && p.h === Math.round(r.height)
            ? p
            : { w: Math.round(r.width), h: Math.round(r.height) },
        )
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])
  const { w: W, h: H } = size
  const proj = useMemo(() => project(scene.stops, W, H), [scene.stops, W, H])
  const pts = useMemo(() => scene.stops.map((s) => ({ ...s, ...proj(s) })), [scene.stops, proj])
  const hollow = scene.mode === 'ideas'
  const byDay = scene.mode === 'all'
  const lit = hotId ?? over
  // Labels: on for a day, off for all days and ideas (those show on hover).
  const labelled = scene.mode === 'day'
  const text = (s: (typeof pts)[number]) =>
    `${s.id === scene.nextId && nextPrefix ? 'Next · ' : ''}${shorten(s.label, labelLimit)}`
  const placed = useMemo(() => {
    const items: LabelItem[] = pts
      .filter((s) => labelled || s.id === lit)
      .map((s) => ({
        id: s.id,
        x: s.x,
        y: s.y,
        text: text(s),
        priority: s.id === lit ? -1 : s.priority,
      }))
    return placeLabels(items, { width: W, height: H })
    // biome-ignore lint/correctness/useExhaustiveDependencies: text() reads exactly these
  }, [pts, labelled, lit, W, H, labelLimit, nextPrefix, scene.nextId])
  const pipFill = (s: (typeof pts)[number]) =>
    hollow
      ? 'var(--panel)'
      : s.done
        ? 'var(--pip-done)'
        : byDay
          ? `var(--trip-day-${s.dayIndex % 6})`
          : `var(--pip-${s.category})`
  const pipStroke = (s: (typeof pts)[number]) => (hollow ? `var(--pip-${s.category})` : '#fff')
  const colour = `var(${scene.colourVar})`
  return (
    <div ref={box} className="trip-map-plain">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} preserveAspectRatio="none">
        <rect width={W} height={H} className="map-ground" />
        {scene.route && pts.length > 1 && (
          <polyline
            className="map-route"
            points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
            stroke={colour}
            aria-hidden
          />
        )}
        {pts.map((p) => {
          const ring = p.id === scene.nextId || p.id === scene.selectedId
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: pins are supplementary; the list is the accessible source
            <g
              key={p.id}
              className={['map-pin', lit === p.id ? 'is-hot' : '', p.done ? 'is-done' : '']
                .filter(Boolean)
                .join(' ')}
              transform={`translate(${p.x} ${p.y})`}
              onClick={() => onPinClick(p.id)}
              onPointerEnter={() => setOver(p.id)}
              onPointerLeave={() => setOver(null)}
              aria-hidden
            >
              {ring && <circle r={11} className="map-pin-ring" />}
              <circle r={6.5} fill={pipFill(p)} stroke={pipStroke(p)} className="map-pin-disc" />
            </g>
          )
        })}
        {placed.map((l) => {
          const next = l.id === scene.nextId
          const isDone = pts.find((p) => p.id === l.id)?.done
          return (
            <g key={`l-${l.id}`} className="map-label-g" aria-hidden>
              {next && (
                <rect
                  x={l.x - 6}
                  y={l.y - 2}
                  width={l.w + 8}
                  height={l.h + 4}
                  rx={9}
                  className="map-next-pill"
                />
              )}
              <text
                x={l.x}
                y={l.y + l.h / 2}
                dominantBaseline="central"
                className={isDone ? 'map-label is-done' : 'map-label'}
              >
                {l.text}
              </text>
            </g>
          )
        })}
      </svg>
      <span className="map-label-badge">{reason}</span>
    </div>
  )
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}
const onlineNow = () => navigator.onLine !== false

export type TripMapHandle = { setHot: (id: string | null) => void }

/** The map pane: the Google map when there is a key and Map ID and we are online, otherwise the
 *  preview. Nothing from Google is requested until the real map is rendered. */
export const TripMap = forwardRef<TripMapHandle, MapViewProps>(function TripMap(props, ref) {
  const config = useMemo(() => mapsConfig(), [])
  const online = useSyncExternalStore(subscribeOnline, onlineNow, () => true)
  const [failed, setFailed] = useState(false)
  // The list's hover lights a stop here without re-rendering the page.
  const [hot, setHot] = useState<string | null>(null)
  useImperativeHandle(ref, () => ({ setHot }), [])
  const onFail = useCallback(() => setFailed(true), [])
  const real = mapsEnabled(config) && online && !failed
  const reason = real ? 'Loading map' : 'Map preview'
  const shared = { ...props, hotId: props.hotId ?? hot }
  const plain = <PlainMap {...shared} reason={reason} />
  if (!real) return plain
  return (
    <Suspense fallback={plain}>
      <MapCanvas {...shared} config={config} onFail={onFail} />
    </Suspense>
  )
})
