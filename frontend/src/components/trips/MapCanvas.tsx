import React, { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { layers, namedFlavor } from '@protomaps/basemaps'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { MapProps } from './TripMap'
import { OSM_MAP_ATTRIBUTION } from './TripMap'

type Props = MapProps & { hot: string | null; tilesUrl: string; onFail: () => void }

let protocolAdded = false

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Vector tiles from our own PMTiles file. Text layers are dropped unless a glyph source is
// configured (VITE_GLYPHS_URL), so the map never reaches for a third-party font host.
function buildStyle(tilesUrl: string): maplibregl.StyleSpecification {
  const glyphs = import.meta.env.VITE_GLYPHS_URL as string | undefined
  const all = layers('protomaps', namedFlavor('light'), { lang: 'en' })
  return {
    version: 8,
    ...(glyphs ? { glyphs } : {}),
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${tilesUrl}`,
        attribution: OSM_MAP_ATTRIBUTION,
      },
    },
    layers: (glyphs
      ? all
      : all.filter((l) => l.type !== 'symbol')) as maplibregl.LayerSpecification[],
  }
}

const EMPTY = { type: 'FeatureCollection' as const, features: [] }

const MapCanvas: React.FC<Props> = ({
  pins,
  others,
  colourVar,
  title,
  onPinClick,
  focusPoint,
  hot,
  tilesUrl,
  onFail,
}) => {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markers = useRef<Map<string, { m: maplibregl.Marker; el: HTMLElement }>>(new Map())
  const clickRef = useRef(onPinClick)
  clickRef.current = onPinClick
  const readyRef = useRef(false)
  const applyRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!box.current) return
    if (!protocolAdded) {
      maplibregl.addProtocol('pmtiles', new Protocol().tile)
      protocolAdded = true
    }
    const map = new maplibregl.Map({
      container: box.current,
      style: buildStyle(tilesUrl),
      center: [0, 20],
      zoom: 1,
      attributionControl: { compact: true },
      cooperativeGestures: false,
    })
    mapRef.current = map
    map.on('load', () => {
      map.addSource('route', { type: 'geojson', data: EMPTY })
      map.addSource('others', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'others',
        type: 'circle',
        source: 'others',
        paint: { 'circle-radius': 4, 'circle-color': '#8d8d8d', 'circle-opacity': 0.8 },
      })
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 4, 'line-color': '#2348a6' },
      })
      readyRef.current = true
      applyRef.current?.()
    })
    // A source error means the tiles aren't reachable (offline, wrong URL): fall back.
    map.on('error', (e) => {
      if ((e as unknown as { sourceId?: string }).sourceId === 'protomaps') onFail()
    })
    const cache = markers.current
    return () => {
      for (const { m } of cache.values()) m.remove()
      cache.clear()
      map.remove()
      mapRef.current = null
      readyRef.current = false
    }
  }, [tilesUrl, onFail])

  // The map follows the day in view.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      const colour = getComputedStyle(document.documentElement).getPropertyValue(colourVar).trim()
      ;(map.getSource('route') as maplibregl.GeoJSONSource | undefined)?.setData(
        pins.length > 1
          ? {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: pins.map((p) => [p.lng, p.lat]) },
            }
          : EMPTY,
      )
      ;(map.getSource('others') as maplibregl.GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: others.map((p) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
      })
      if (colour && map.getLayer('route')) map.setPaintProperty('route', 'line-color', colour)

      const live = new Set(pins.map((p) => p.id))
      for (const [id, { m }] of markers.current) {
        if (!live.has(id)) {
          m.remove()
          markers.current.delete(id)
        }
      }
      for (const p of pins) {
        let entry = markers.current.get(p.id)
        if (!entry) {
          const el = document.createElement('div')
          el.className = 'map-marker'
          el.setAttribute('aria-hidden', 'true')
          el.addEventListener('click', () => clickRef.current(p.id))
          entry = {
            m: new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map),
            el,
          }
          markers.current.set(p.id, entry)
        }
        entry.m.setLngLat([p.lng, p.lat])
        entry.el.textContent = String(p.n ?? '')
        entry.el.style.background = colour
      }
      const pts = pins.length ? pins : others
      if (pts.length) {
        const b = new maplibregl.LngLatBounds()
        for (const p of pts) b.extend([p.lng, p.lat])
        map.fitBounds(b, { padding: 56, maxZoom: 15, duration: reduced() ? 0 : 600 })
      }
    }
    applyRef.current = apply
    if (readyRef.current) apply()
  }, [pins, others, colourVar])

  // An open item centres the map on its pin.
  useEffect(() => {
    if (focusPoint)
      mapRef.current?.easeTo({
        center: [focusPoint.lng, focusPoint.lat],
        duration: reduced() ? 0 : 500,
      })
  }, [focusPoint])

  useEffect(() => {
    for (const [id, { el }] of markers.current) el.classList.toggle('is-hot', id === hot)
  }, [hot])

  return <div ref={box} className="trip-map-gl" role="img" aria-label={title} />
}

export default MapCanvas
