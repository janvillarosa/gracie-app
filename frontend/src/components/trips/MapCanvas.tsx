import React, { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import { layers, namedFlavor } from '@protomaps/basemaps'
import 'maplibre-gl/dist/maplibre-gl.css'
import { shorten, type MapScene, type MapStop } from '@lib/trips/mapScene'
import { OSM_MAP_ATTRIBUTION, type MapViewProps, type TileConfig } from './mapView'

type Props = MapViewProps & { config: TileConfig; onFail: () => void }

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const css = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

const CATEGORIES = ['food', 'sight', 'activity', 'transport', 'stay', 'shopping', 'other'] as const

// A quiet light basemap, tinted toward the paper ground so pins and routes carry the colour.
function buildStyle(config: TileConfig): maplibregl.StyleSpecification {
  const flavor = {
    ...namedFlavor('light'),
    background: css('--trip-map-ground', '#E9EEE6'),
    earth: '#EEF0E9',
    water: '#CFDDE3',
  }
  const all = layers('protomaps', flavor, { lang: 'en' })
  const withGlyphs = !!config.glyphs
  const kept = (withGlyphs ? all : all.filter((l) => l.type !== 'symbol')).map((l) => {
    // No sprite is served from our origin: drop icon references instead of warning about them.
    if (l.type !== 'symbol' || !l.layout) return l
    const { 'icon-image': _i, ...layout } = l.layout as Record<string, unknown>
    return { ...l, layout }
  })
  return {
    version: 8,
    ...(withGlyphs ? { glyphs: config.glyphs } : {}),
    sources: {
      protomaps: {
        type: 'vector',
        url: config.tilejson,
        attribution: `${OSM_MAP_ATTRIBUTION} · Protomaps`,
      },
    },
    layers: kept as maplibregl.LayerSpecification[],
  }
}

type Feature = {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry:
    | { type: 'Point'; coordinates: [number, number] }
    | { type: 'LineString'; coordinates: [number, number][] }
}
const EMPTY = { type: 'FeatureCollection' as const, features: [] as Feature[] }
const point = (lng: number, lat: number, properties: Record<string, unknown>): Feature => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Point', coordinates: [lng, lat] },
})

// Small images the layers use: a route arrow, and the nine-patch pill behind the next stop's label.
function arrowImage(colour: string): ImageData {
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = colour
  g.beginPath()
  g.moveTo(4, 3)
  g.lineTo(13, 8)
  g.lineTo(4, 13)
  g.closePath()
  g.fill()
  return g.getImageData(0, 0, 16, 16)
}
function pillImage(border: string): ImageData {
  const c = document.createElement('canvas')
  c.width = c.height = 24
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#fff'
  g.strokeStyle = border
  g.lineWidth = 2
  g.beginPath()
  g.roundRect(1.5, 1.5, 21, 21, 10)
  g.fill()
  g.stroke()
  return g.getImageData(0, 0, 24, 24)
}

function colours(): {
  pips: Record<string, string>
  days: string[]
  done: string
  ink: string
  yellow: string
} {
  const pips: Record<string, string> = {}
  for (const c of CATEGORIES) pips[c] = css(`--pip-${c}`, '#555')
  return {
    pips,
    days: [0, 1, 2, 3, 4, 5].map((i) => css(`--trip-day-${i}`, '#2348A6')),
    done: css('--pip-done', '#A9ADA6'),
    ink: css('--ink', '#222'),
    yellow: css('--brand-yellow', '#FFD417'),
  }
}

type Cfg = Pick<MapViewProps, 'labelLimit' | 'nextPrefix'>
function features(scene: MapScene, cfg: Cfg) {
  const col = colours()
  const hollow = scene.mode === 'ideas'
  const byDay = scene.mode === 'all'
  const make = (s: MapStop) => {
    const category = col.pips[s.category] ?? col.pips.other
    const fill = hollow
      ? '#ffffff'
      : s.done
        ? col.done
        : byDay
          ? col.days[s.dayIndex % 6]
          : category
    const next = s.id === scene.nextId
    return point(s.lng, s.lat, {
      id: s.id,
      text: `${next && cfg.nextPrefix ? 'Next · ' : ''}${shorten(s.label, cfg.labelLimit)}`,
      prio: s.priority,
      fill,
      stroke: hollow ? category : '#ffffff',
      done: s.done,
      next,
      // Labels: on for a day; for all days and ideas only on hover.
      labelled: scene.mode === 'day',
    })
  }
  const lit = (s: MapStop) => s.id === scene.nextId || s.id === scene.selectedId
  return {
    stops: scene.stops.filter((s) => !lit(s)).map(make),
    focus: scene.stops.filter(lit).map(make),
    route:
      scene.route && scene.stops.length > 1
        ? {
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'LineString' as const,
              coordinates: scene.stops.map((s) => [s.lng, s.lat]),
            },
          }
        : null,
  }
}

const MapCanvas: React.FC<Props> = (props) => {
  const { config, onFail } = props
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const readyRef = useRef(false)
  const programmatic = useRef(false)
  const tip = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const lastFit = useRef('')

  // Everything the layers need, written to their sources. No per-pin DOM: it is all GPU layers.
  const apply = () => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const p = latest.current
    const f = features(p.scene, p)
    ;(map.getSource('stops') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: f.stops,
    })
    ;(map.getSource('focus') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: f.focus,
    })
    ;(map.getSource('route') as maplibregl.GeoJSONSource).setData(f.route ?? EMPTY)
    if (map.getLayer('route-line'))
      map.setPaintProperty('route-line', 'line-color', css(p.scene.colourVar, '#2348A6'))
    const pv = p.preview
    ;(map.getSource('preview') as maplibregl.GeoJSONSource).setData(
      pv ? { type: 'FeatureCollection', features: [point(pv.lng, pv.lat, {})] } : EMPTY,
    )
  }

  const fit = (force: boolean) => {
    const map = mapRef.current
    const p = latest.current
    if (!map || !readyRef.current || !p.scene.stops.length) return
    const key = p.scene.stops.map((s) => `${s.id}:${s.lat}:${s.lng}`).join('|')
    if (!force && (!p.following || key === lastFit.current)) return
    lastFit.current = key
    const b = new maplibregl.LngLatBounds()
    for (const s of p.scene.stops) b.extend([s.lng, s.lat])
    programmatic.current = true
    map.fitBounds(b, {
      padding: p.fitPadding ?? { top: 56, bottom: 56, left: 56, right: 56 },
      maxZoom: 15,
      duration: reduced() ? 0 : 500,
    })
  }

  useEffect(() => {
    if (!box.current) return
    const col = colours()
    const map = new maplibregl.Map({
      container: box.current,
      style: buildStyle(config),
      center: [0, 20],
      zoom: 1,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    })
    mapRef.current = map
    map.touchZoomRotate.disableRotation()
    if (latest.current.interactive)
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

    map.on('load', () => {
      map.addImage('arrow', arrowImage(col.ink))
      map.addImage('pill', pillImage(col.yellow), {
        content: [8, 4, 16, 20],
        stretchX: [[8, 16]],
        stretchY: [[8, 16]],
      })
      // Stops that may merge when they genuinely stack; the next and selected never do.
      map.addSource('stops', {
        type: 'geojson',
        data: EMPTY,
        cluster: true,
        clusterRadius: 28,
        clusterMaxZoom: 15,
      })
      map.addSource('focus', { type: 'geojson', data: EMPTY })
      map.addSource('route', { type: 'geojson', data: EMPTY })
      map.addSource('preview', { type: 'geojson', data: EMPTY })
      map.addSource('hot', { type: 'geojson', data: EMPTY })

      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 3, 'line-color': '#2348A6', 'line-opacity': 0.55 },
      })
      map.addLayer({
        id: 'route-arrows',
        type: 'symbol',
        source: 'route',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 120,
          'icon-image': 'arrow',
          'icon-size': 0.8,
          'icon-allow-overlap': true,
        },
      })
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'stops',
        filter: ['has', 'point_count'],
        paint: {
          'circle-radius': 12,
          'circle-color': '#ffffff',
          'circle-stroke-color': col.ink,
          'circle-stroke-width': 2,
        },
      })
      const pip = {
        'circle-radius': 6.5,
        'circle-color': ['get', 'fill'],
        'circle-stroke-color': ['get', 'stroke'],
        'circle-stroke-width': 2.5,
      } as NonNullable<maplibregl.CircleLayerSpecification['paint']>
      map.addLayer({
        id: 'pips',
        type: 'circle',
        source: 'stops',
        filter: ['!', ['has', 'point_count']],
        paint: pip,
      })
      map.addLayer({
        id: 'focus-ring',
        type: 'circle',
        source: 'focus',
        paint: {
          'circle-radius': 11,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': col.yellow,
          'circle-stroke-width': 3,
        },
      })
      map.addLayer({ id: 'focus-pips', type: 'circle', source: 'focus', paint: pip })
      map.addLayer({
        id: 'preview-pin',
        type: 'circle',
        source: 'preview',
        paint: {
          'circle-radius': 8,
          'circle-color': 'rgba(255,255,255,0.4)',
          'circle-stroke-color': col.ink,
          'circle-stroke-width': 2.5,
        },
      })
      map.addLayer({
        id: 'hot-pip',
        type: 'circle',
        source: 'hot',
        paint: {
          'circle-radius': 9,
          'circle-color': ['get', 'fill'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3,
        },
      })

      if (config.glyphs) {
        const text = {
          'text-field': ['get', 'text'],
          'text-font': ['Noto Sans Medium'],
          'text-size': 12.5,
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
          'text-radial-offset': 0.95,
          'text-optional': true,
          'text-allow-overlap': false,
          'symbol-sort-key': ['get', 'prio'],
        } as maplibregl.SymbolLayerSpecification['layout']
        const paint = {
          'text-color': ['case', ['get', 'done'], '#8b8f88', col.ink],
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
        } as maplibregl.SymbolLayerSpecification['paint']
        map.addLayer({
          id: 'labels',
          type: 'symbol',
          source: 'stops',
          filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'labelled'], true]],
          layout: text,
          paint,
        })
        map.addLayer({
          id: 'labels-focus',
          type: 'symbol',
          source: 'focus',
          filter: ['all', ['==', ['get', 'next'], false], ['==', ['get', 'labelled'], true]],
          layout: text,
          paint,
        })
        map.addLayer({
          id: 'label-next',
          type: 'symbol',
          source: 'focus',
          filter: ['==', ['get', 'next'], true],
          layout: {
            ...(text as object),
            'icon-image': 'pill',
            'icon-text-fit': 'both',
            'icon-text-fit-padding': [2, 8, 2, 8],
            'symbol-sort-key': 1,
          } as maplibregl.SymbolLayerSpecification['layout'],
          paint,
        })
        map.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'stops',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['concat', '+', ['get', 'point_count_abbreviated']],
            'text-font': ['Noto Sans Medium'],
            'text-size': 11,
            'text-allow-overlap': true,
          },
          paint: { 'text-color': col.ink },
        })
        map.addLayer({
          id: 'hot-label',
          type: 'symbol',
          source: 'hot',
          layout: {
            ...(text as object),
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            'text-optional': false,
          } as maplibregl.SymbolLayerSpecification['layout'],
          paint,
        })
      }

      readyRef.current = true
      apply()
      fit(true)
    })

    // A tile source that cannot be reached (bad key, offline) falls back to the preview.
    map.on('error', (e) => {
      if ((e as unknown as { sourceId?: string }).sourceId === 'protomaps') onFail()
    })

    // Anything that moves the map and was not us is the person looking around.
    map.on('movestart', () => {
      if (!programmatic.current) latest.current.onUserMove?.()
    })
    map.on('moveend', () => {
      programmatic.current = false
    })

    const pipLayers = ['pips', 'focus-pips']
    map.on('click', async (e) => {
      const hit = map.queryRenderedFeatures(e.point, {
        layers: [...pipLayers, 'clusters'].filter((l) => map.getLayer(l)),
      })
      const first = hit[0]
      if (first?.layer.id === 'clusters') {
        const id = first.properties?.cluster_id as number
        const src = map.getSource('stops') as maplibregl.GeoJSONSource
        const zoom = await src.getClusterExpansionZoom(id)
        programmatic.current = false
        map.easeTo({
          center: (first.geometry as { coordinates: number[] }).coordinates as [number, number],
          zoom,
          duration: reduced() ? 0 : 400,
        })
        return
      }
      if (first) return latest.current.onPinClick(String(first.properties?.id))
      const p = latest.current
      if (!p.interactive || !p.onMapClick) return
      // A place label under the click gives its name; otherwise the page reverse-geocodes.
      const poi = ['pois', 'places_subplace', 'places_locality'].filter((l) => map.getLayer(l))
      const near = poi.length
        ? map.queryRenderedFeatures(
            [
              [e.point.x - 10, e.point.y - 10],
              [e.point.x + 10, e.point.y + 10],
            ],
            { layers: poi },
          )
        : []
      const name = near.find((n) => typeof n.properties?.name === 'string')?.properties?.name as
        | string
        | undefined
      p.onMapClick({ lat: e.lngLat.lat, lng: e.lngLat.lng, name, x: e.point.x, y: e.point.y })
    })
    for (const l of [...pipLayers, 'clusters']) {
      map.on('mouseenter', l, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', l, () => {
        map.getCanvas().style.cursor = ''
      })
    }

    return () => {
      readyRef.current = false
      map.remove()
      mapRef.current = null
    }
    // The map is created once per mount: the props below feed it through `latest`.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  }, [config.tilejson, config.glyphs])

  // The scene, the preview and the flags go to the layers; following refits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: apply/fit read `latest`
  useEffect(() => {
    apply()
    fit(false)
  }, [props.scene, props.preview, props.labelLimit, props.nextPrefix])

  // "Fit day": refit whatever the following state is.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fit reads `latest`
  useEffect(() => {
    fit(true)
  }, [props.fitToken])

  // An open item centres the map on its pin, in the space left of a docked panel.
  useEffect(() => {
    const map = mapRef.current
    const p = props.focusPoint
    if (!map || !readyRef.current || !p) return
    programmatic.current = true
    map.easeTo({
      center: [p.lng, p.lat],
      padding: { top: 0, bottom: 0, left: 0, right: props.focusInset ?? 0 },
      duration: reduced() ? 0 : 500,
    })
  }, [props.focusPoint, props.focusInset])

  // A stop in the list that the pointer is on: lifted, and labelled even if it collided. Without
  // a glyph source the label is one small tag instead (still no per-pin elements).
  useEffect(() => {
    const map = mapRef.current
    const el = tip.current
    if (!map || !readyRef.current) return
    const s = props.hotId ? props.scene.stops.find((x) => x.id === props.hotId) : undefined
    const f = features(props.scene, props)
    const feature = s ? [...f.stops, ...f.focus].find((x) => x.properties?.id === s.id) : undefined
    ;(map.getSource('hot') as maplibregl.GeoJSONSource).setData(
      feature ? { type: 'FeatureCollection', features: [feature] } : EMPTY,
    )
    if (el) {
      if (s && !config.glyphs) {
        const px = map.project([s.lng, s.lat])
        el.textContent = shorten(s.label, props.labelLimit)
        el.style.transform = `translate(${Math.round(px.x + 12)}px, ${Math.round(px.y - 10)}px)`
        el.hidden = false
      } else el.hidden = true
    }
  }, [props.hotId, props.scene, props.labelLimit, props.nextPrefix, config.glyphs])

  // A place being considered (the add bar's highlighted suggestion): ease to it if it is off screen.
  useEffect(() => {
    const map = mapRef.current
    const pv = props.preview
    if (!map || !readyRef.current || !pv) return
    if (!map.getBounds().contains([pv.lng, pv.lat])) {
      programmatic.current = true
      map.easeTo({ center: [pv.lng, pv.lat], duration: reduced() ? 0 : 400 })
    }
  }, [props.preview])

  return (
    <div className="trip-map-gl-wrap">
      <div ref={box} className="trip-map-gl" role="img" aria-label={props.title} />
      <div ref={tip} className="map-tip" hidden aria-hidden />
    </div>
  )
}

export default MapCanvas
