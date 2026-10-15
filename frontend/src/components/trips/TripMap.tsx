import React, {
  forwardRef,
  lazy,
  useCallback,
  Suspense,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

export type MapPoint = { id: string; lat: number; lng: number }
export type TripMapHandle = { setHot: (id: string | null) => void }

export type MapProps = {
  // The day in view: its stops are numbered and joined by a line in the day's colour.
  pins: MapPoint[]
  // Everything else, drawn as small grey dots.
  others: MapPoint[]
  // CSS custom property holding the day's colour, e.g. "--trip-day-2".
  colourVar: string
  title: string
  // The item open in the detail panel: its pin is lifted and the map centres on it.
  focusId?: string | null
  focusPoint?: { lat: number; lng: number } | null
  // Pixels on the right covered by a docked panel: the focused pin centres in what is left.
  focusInset?: number
  // The next stop (during the trip): its pin is larger, with a yellow ring.
  nextId?: string | null
  onPinClick: (id: string) => void
}

const PAD = 48

// Lazy: MapLibre only loads when a tile source exists and the map is actually on screen.
const MapCanvas = lazy(() => import('./MapCanvas'))

export const OSM_MAP_ATTRIBUTION = '© OpenStreetMap contributors'

function project(points: MapPoint[], fit: MapPoint[], W: number, H: number) {
  const base = fit.length ? fit : points
  if (!base.length) return () => ({ x: W / 2, y: H / 2 })
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const p of base) {
    minLat = Math.min(minLat, p.lat)
    maxLat = Math.max(maxLat, p.lat)
    minLng = Math.min(minLng, p.lng)
    maxLng = Math.max(maxLng, p.lng)
  }
  const midLat = (minLat + maxLat) / 2
  const k = Math.cos((midLat * Math.PI) / 180)
  // A single point still needs a span, or the scale divides by zero.
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

/** Pins and route on a plain paper-coloured ground. Always works: no tiles, no network, no
 *  WebGL. Drawn 1:1 with the pane, so a pin is 28px whatever the pane's size. */
const PlainMap: React.FC<MapProps & { hot: string | null; reason: string }> = ({
  pins,
  others,
  colourVar,
  title,
  nextId,
  onPinClick,
  hot,
  reason,
}) => {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 600, h: 420 })
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
  const proj = useMemo(() => project([...pins, ...others], pins, W, H), [pins, others, W, H])
  const pts = pins.map((p) => ({ ...p, ...proj(p) }))
  const dots = others.map((p) => ({ ...p, ...proj(p) }))
  const colour = `var(${colourVar})`
  return (
    <div ref={box} className="trip-map-plain">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} preserveAspectRatio="none">
        <rect width={W} height={H} className="map-ground" />
        {dots.map((d) => (
          <circle key={d.id} cx={d.x} cy={d.y} r={5} className="map-dot" aria-hidden />
        ))}
        {pts.length > 1 && (
          <polyline
            className="map-route"
            points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
            stroke={colour}
            aria-hidden
          />
        )}
        {pts.map((p) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: pins are supplementary; the spine is the accessible source
          <g
            key={p.id}
            className={['map-pin', hot === p.id ? 'is-hot' : '', nextId === p.id ? 'is-next' : '']
              .filter(Boolean)
              .join(' ')}
            transform={`translate(${p.x} ${p.y})`}
            onClick={() => onPinClick(p.id)}
            aria-hidden
          >
            {nextId === p.id && <circle r={20} className="map-pin-ring" />}
            <circle r={14} fill={colour} className="map-pin-disc" />
          </g>
        ))}
      </svg>
      <span className="map-label">{reason}</span>
      <span className="map-attrib">{OSM_MAP_ATTRIBUTION}</span>
    </div>
  )
}

function webglOk(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

export const TripMap = forwardRef<TripMapHandle, MapProps>(function TripMap(props, ref) {
  const [hot, setHot] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useImperativeHandle(ref, () => ({ setHot }), [])
  const onFail = useCallback(() => setFailed(true), [])
  const tiles = (import.meta.env.VITE_PMTILES_URL as string | undefined) || ''
  const gl = !!tiles && !failed && webglOk()
  // "Offline map" only when it really is offline; with no tiles configured it is a preview.
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  const reason =
    tiles && !failed ? 'Loading map' : offline || failed ? 'Offline map' : 'Map preview'
  const lit = props.focusId ?? hot
  const plain = <PlainMap {...props} hot={lit} reason={reason} />
  if (!gl) return plain
  return (
    <Suspense fallback={plain}>
      <MapCanvas {...props} hot={lit} tilesUrl={tiles} onFail={onFail} />
    </Suspense>
  )
})
