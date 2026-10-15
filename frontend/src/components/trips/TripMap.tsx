import React, {
  forwardRef,
  lazy,
  useCallback,
  Suspense,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react'

export type MapPoint = { id: string; lat: number; lng: number; n?: number }
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
  onPinClick: (id: string) => void
}

const W = 600
const H = 420
const PAD = 48

// Lazy: MapLibre only loads when a tile source exists and the map is actually on screen.
const MapCanvas = lazy(() => import('./MapCanvas'))

export const OSM_MAP_ATTRIBUTION = '© OpenStreetMap contributors'

function project(points: MapPoint[], fit: MapPoint[]) {
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

/** Pins and route on a plain ground. Always works: no tiles, no network, no WebGL. */
const PlainMap: React.FC<MapProps & { hot: string | null; reason: string }> = ({
  pins,
  others,
  colourVar,
  title,
  onPinClick,
  hot,
  reason,
}) => {
  const proj = useMemo(() => project([...pins, ...others], pins), [pins, others])
  const pts = pins.map((p) => ({ ...p, ...proj(p) }))
  const dots = others.map((p) => ({ ...p, ...proj(p) }))
  const colour = `var(${colourVar})`
  return (
    <div className="trip-map-plain">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={title}
        preserveAspectRatio="xMidYMid slice"
      >
        <rect width={W} height={H} className="map-ground" />
        <g className="map-grid" aria-hidden>
          {[1, 2, 3, 4, 5].map((i) => (
            <line key={`v${i}`} x1={(W / 6) * i} x2={(W / 6) * i} y1={0} y2={H} />
          ))}
          {[1, 2, 3, 4].map((i) => (
            <line key={`h${i}`} y1={(H / 5) * i} y2={(H / 5) * i} x1={0} x2={W} />
          ))}
        </g>
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
            className={hot === p.id ? 'map-pin is-hot' : 'map-pin'}
            transform={`translate(${p.x} ${p.y})`}
            onClick={() => onPinClick(p.id)}
            aria-hidden
          >
            <circle r={15} fill={colour} className="map-pin-disc" />
            <text textAnchor="middle" dy="0.35em">
              {p.n}
            </text>
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
  const reason = tiles && !failed ? 'Loading map' : 'Offline map'
  const lit = props.focusId ?? hot
  const plain = <PlainMap {...props} hot={lit} reason={reason} />
  if (!gl) return plain
  return (
    <Suspense fallback={plain}>
      <MapCanvas {...props} hot={lit} tilesUrl={tiles} onFail={onFail} />
    </Suspense>
  )
})
