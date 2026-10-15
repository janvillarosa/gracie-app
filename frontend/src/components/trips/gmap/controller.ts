// The Google map behind the MapView adapter, as plain imperative code (the React component in
// MapCanvas.tsx only owns its lifetime). It draws a MapScene as AdvancedMarkerElements with our
// own HTML (the pills of brief 6u), clusters the stacked stops of the other days, joins a day with
// a cased line, and reports when the emphasised day is off the map. The map is for viewing (brief
// 6v): there is no click handling on it, and a pill's click is the only action.
//
// Camera rule (brief 6q): the camera moves only on an explicit action. `sync` never moves it for
// an emphasis change; it fits when the set of stops changes while `following`, on `fitToken`, and
// pans only when an opened item or a previewed place is off screen. A fit takes the emphasised
// day (the first day with places when that has none); Show all days is the explicit whole trip.
import { MarkerClusterer, SuperClusterAlgorithm } from '@googlemaps/markerclusterer'
import type { MapStop } from '@lib/trips/mapScene'
import type { MapViewProps } from '../mapView'
import type { MapsConfig } from './config'
import { centreFor, isVisible, projector, type Bounds } from './geometry'
import { eligibleIds, pillSize, pillText, resolvePills, type PillSize } from './labels'
import type { Google } from './loader'
import {
  clusterElement,
  createPin,
  pinState,
  pipColours,
  previewElement,
  updatePin,
  type PinSpec,
} from './pin'

const MAX_FIT_ZOOM = 15
const CLUSTER_RADIUS = 28
// A pill stands above its anchor and reaches ~100px to each side: keep them inside the fit.
const FIT_PADDING = { top: 84, bottom: 56, left: 112, right: 112 }

type Pin = {
  stop: MapStop
  marker: google.maps.marker.AdvancedMarkerElement
  el: HTMLElement
  name: string
  time: string
  size: PillSize
  hidden: boolean
}

const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

export type ControllerInit = {
  google: Google
  container: HTMLElement
  config: MapsConfig
  props: MapViewProps
  onReady?: () => void
  // The emphasised day is (true) or is not (false) off the map: the page's chip shows or hides.
  onOffMap?: (off: boolean) => void
}

export class MapController {
  readonly map: google.maps.Map
  private g: Google
  private container: HTMLElement
  private props!: MapViewProps
  private pins = new Map<string, Pin>()
  private lines: google.maps.Polyline[] = []
  private clusterer: MarkerClusterer
  private preview: google.maps.marker.AdvancedMarkerElement | null = null
  private hotId: string | null = null
  private lastFit = ''
  // Token of our own camera move that has not reported idle yet (0: none), so the move is not
  // mistaken for the person moving the map. Each move gets its own token; a move's fallback timer
  // and the idle that ends it only clear their own, never a later move's.
  private moveSeq = 0
  private activeMove = 0
  private programmaticTimer = 0
  // A fit asked for before the map was up (the first idle): run once it is, so its own idle is
  // the one that ends it and the map's start-up idle is not taken for it.
  private pendingFit: 'auto' | 'forced' | null = null
  private raf = 0
  private disposed = false
  private ready = false
  private offMap = false
  private onReady?: () => void
  private onOffMap?: (off: boolean) => void

  constructor({ google: g, container, config, props, onReady, onOffMap }: ControllerInit) {
    this.g = g
    this.container = container
    this.onReady = onReady
    this.onOffMap = onOffMap
    const interactive = props.interactive
    this.map = new g.maps.Map(container, {
      mapId: config.mapId,
      center: { lat: 20, lng: 0 },
      zoom: 2,
      // Our own +/− and Fit buttons; only the Google logo and terms stay.
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      // View only: Google's place icons are not clickable and there is no info window.
      clickableIcons: false,
      keyboardShortcuts: interactive,
      backgroundColor: cssVar('--trip-map-ground', '#E9EEE6'),
      headingInteractionEnabled: false,
      tiltInteractionEnabled: false,
    })
    this.clusterer = new MarkerClusterer({
      map: this.map,
      markers: [],
      algorithm: new SuperClusterAlgorithm({ radius: CLUSTER_RADIUS, maxZoom: MAX_FIT_ZOOM }),
      renderer: {
        render: ({ count, position }) =>
          new g.marker.AdvancedMarkerElement({
            position,
            content: clusterElement(count),
            zIndex: 400,
          }),
      },
      // Clicking a cluster zooms in on it; that is the person looking around.
      onClusterClick: (_e, cluster, map) => {
        this.markProgrammatic(false)
        if (cluster.bounds) map.fitBounds(cluster.bounds, 64)
      },
    })

    this.map.addListener('dragstart', () => this.userMoved())
    this.map.addListener('zoom_changed', () => {
      if (!this.activeMove) this.userMoved()
    })
    this.map.addListener('idle', () => {
      this.activeMove = 0
      window.clearTimeout(this.programmaticTimer)
      this.scheduleLabels()
      if (!this.ready) {
        this.ready = true
        this.onReady?.()
        const pending = this.pendingFit
        this.pendingFit = null
        if (pending) this.fit(pending === 'forced')
      }
      this.checkOffMap()
    })
    this.clusterer.addListener('clusteringend', () => this.scheduleLabels())
    this.sync(props, true)
  }

  /** Feed the latest props in. Cheap to call on every render: only changes do work. */
  sync(next: MapViewProps, first = false) {
    const prev = this.props
    this.props = next
    if (
      first ||
      next.scene !== prev.scene ||
      next.labelLimit !== prev.labelLimit ||
      next.nextPrefix !== prev.nextPrefix
    ) {
      this.renderPins()
      this.renderRoutes()
      this.fit(false)
      // An emphasis change moves nothing, but may leave the day off the map (or bring it back).
      if (!this.activeMove) this.checkOffMap()
    }
    if (!first && next.fitToken !== prev.fitToken) this.fit(true)
    if (first || next.preview !== prev.preview) this.renderPreview()
    if (first || (next.hotId ?? null) !== this.hotId) this.setHot(next.hotId ?? null)
    if (
      next.focusPoint &&
      (first ||
        next.focusPoint.lat !== prev.focusPoint?.lat ||
        next.focusPoint.lng !== prev.focusPoint?.lng ||
        next.focusInset !== prev.focusInset)
    )
      this.focus(next.focusPoint, next.focusInset ?? 0)
  }

  // ---- camera ------------------------------------------------------------------------------

  /** Start one of our own camera moves (`on`), or hand the camera to the person (`off`). */
  private markProgrammatic(on: boolean) {
    window.clearTimeout(this.programmaticTimer)
    if (!on) {
      this.activeMove = 0
      return
    }
    const token = ++this.moveSeq
    this.activeMove = token
    // A move that changes nothing never reports idle: do not stay "ours" forever.
    this.programmaticTimer = window.setTimeout(() => {
      if (this.activeMove === token) this.activeMove = 0
    }, 1500)
  }

  private userMoved() {
    this.props.onUserMove?.()
  }

  private bounds(): Bounds | null {
    const b = this.map.getBounds()
    if (!b) return null
    const j = b.toJSON()
    return { north: j.north, south: j.south, east: j.east, west: j.west }
  }

  /** The stops a fit takes: the emphasised day. When it has none, an explicit fit takes the whole
   *  scene and the automatic one the first day with places. No emphasis (Show all days, the phone's
   *  one day, the ideas): every stop. */
  private fitStops(force: boolean): MapStop[] {
    const { scene } = this.props
    const all = scene.stops
    const day = scene.emphasisDay
    if (day === undefined || day === null) return all
    const ofDay = all.filter((s) => s.dayIndex === day)
    if (ofDay.length) return ofDay
    if (force || !all.length) return all
    const first = Math.min(...all.map((s) => s.dayIndex))
    return all.filter((s) => s.dayIndex === first)
  }

  /** Fit the stops in view, clear of the view's own chrome. */
  fit(force: boolean) {
    const p = this.props
    const stops = this.fitStops(force)
    if (!stops.length) return
    const key = p.scene.stops.map((s) => `${s.id}:${s.lat}:${s.lng}`).join('|')
    if (!force && (!p.following || key === this.lastFit)) return
    if (!this.ready) {
      this.pendingFit = force || this.pendingFit === 'forced' ? 'forced' : 'auto'
      return
    }
    this.lastFit = key
    this.markProgrammatic(true)
    const first = stops[0]
    if (stops.every((s) => s.lat === first.lat && s.lng === first.lng)) {
      this.map.setCenter({ lat: first.lat, lng: first.lng })
      this.map.setZoom(MAX_FIT_ZOOM)
      return
    }
    const b = new this.g.core.LatLngBounds()
    for (const s of stops) b.extend({ lat: s.lat, lng: s.lng })
    this.map.fitBounds(b, p.fitPadding ?? FIT_PADDING)
    // A few close stops must not zoom in to the rooftops.
    this.g.core.event.addListenerOnce(this.map, 'idle', () => {
      if ((this.map.getZoom() ?? 0) > MAX_FIT_ZOOM) this.map.setZoom(MAX_FIT_ZOOM)
    })
  }

  /** An open item: bring its pin into the space left of a docked panel, only if it is hidden. */
  private focus(point: { lat: number; lng: number }, inset: number) {
    const b = this.bounds()
    if (b && isVisible(b, point, this.container.clientWidth, inset)) return
    this.markProgrammatic(true)
    this.map.panTo(centreFor(point, this.map.getZoom() ?? 2, inset))
  }

  zoomBy(delta: number) {
    this.map.setZoom((this.map.getZoom() ?? 2) + delta)
    this.userMoved()
  }

  /** Whether the emphasised day is off the map: none of its stops in view, or (zoomed out) all of
   *  them sitting on top of one another. Reported to the page, which shows its chip. */
  private checkOffMap() {
    if (this.disposed || !this.ready) return
    const { scene } = this.props
    const day = scene.emphasisDay
    let off = false
    const b = this.bounds()
    if (day !== undefined && day !== null && b) {
      const stops = scene.stops.filter((s) => s.dayIndex === day)
      if (stops.length) {
        if (!stops.some((s) => isVisible(b, s, 0))) off = true
        else if (stops.length > 1 && (this.map.getZoom() ?? 0) < MAX_FIT_ZOOM) {
          const at = projector(b, this.map.getZoom() ?? 2)
          const pts = stops.map((s) => at(s.lat, s.lng))
          const xs = pts.map((q) => q.x)
          const ys = pts.map((q) => q.y)
          off =
            Math.max(...xs) - Math.min(...xs) < CLUSTER_RADIUS &&
            Math.max(...ys) - Math.min(...ys) < CLUSTER_RADIUS
        }
      }
    }
    if (off === this.offMap) return
    this.offMap = off
    this.onOffMap?.(off)
  }

  // ---- pins, routes, preview ---------------------------------------------------------------

  private spec(pin: Pin): PinSpec {
    const { scene, nextPrefix } = this.props
    return {
      name: pin.name,
      time: pin.time,
      title: pin.stop.label,
      ...pipColours(pin.stop, scene),
      state: pinState(pin.stop, scene, {
        hot: pin.stop.id === this.hotId,
        hidden: pin.hidden,
        kicker: nextPrefix,
      }),
    }
  }

  private zFor(pin: Pin) {
    // Lower priority numbers sit on top: selected, then next, then the day's order.
    return 1000 - Math.min(pin.stop.priority, 500)
  }

  private renderPins() {
    const p = this.props
    const { scene } = p
    const emphasis = scene.emphasisDay
    const seen = new Set<string>()
    const toCluster: google.maps.marker.AdvancedMarkerElement[] = []
    const lit: google.maps.marker.AdvancedMarkerElement[] = []
    for (const s of scene.stops) {
      seen.add(s.id)
      let pin = this.pins.get(s.id)
      if (!pin) {
        const el = createPin()
        const marker = new this.g.marker.AdvancedMarkerElement({
          position: { lat: s.lat, lng: s.lng },
          content: el,
          gmpClickable: true,
        })
        marker.addEventListener('gmp-click', () => this.props.onPinClick(s.id))
        // Hover-linking: the pointer on a pill lights its row.
        el.addEventListener('pointerenter', () => this.pinHover(s.id))
        el.addEventListener('pointerleave', () => this.pinHover(null))
        pin = {
          stop: s,
          marker,
          el,
          name: '',
          time: '',
          size: { w: 0, h: 0 },
          hidden: false,
        }
        this.pins.set(s.id, pin)
      } else {
        pin.stop = s
        pin.marker.position = { lat: s.lat, lng: s.lng }
      }
      pin.name = pillText(s, p.labelLimit)
      // The time is for the desk; the phone's pill is smaller and leaves it out.
      pin.time = p.interactive ? (s.time ?? '') : ''
      pin.size = pillSize({
        name: pin.name,
        time: pin.time,
        kicker: p.nextPrefix && s.id === scene.nextId,
        compact: !p.interactive,
      })
      pin.marker.title = s.label
      pin.marker.zIndex = this.zFor(pin)
      updatePin(pin.el, this.spec(pin))
      // The next and selected stops, and every stop of the emphasised day, are never clustered;
      // only the other days cluster.
      const never =
        s.id === scene.nextId ||
        s.id === scene.selectedId ||
        (emphasis !== undefined && emphasis !== null && s.dayIndex === emphasis)
      if (never) lit.push(pin.marker)
      else toCluster.push(pin.marker)
    }
    for (const [id, pin] of this.pins) {
      if (seen.has(id)) continue
      this.clusterer.removeMarker(pin.marker, true)
      pin.marker.map = null
      this.pins.delete(id)
    }
    this.clusterer.clearMarkers(true)
    for (const m of lit) m.map = this.map
    this.clusterer.addMarkers(toCluster)
    this.scheduleLabels()
  }

  private pinHover(id: string | null) {
    const pin = id ? this.pins.get(id) : undefined
    // A hovered pill rises above its neighbours; the page lights its row.
    for (const q of this.pins.values()) if (q !== pin) q.marker.zIndex = this.zFor(q)
    if (pin) pin.marker.zIndex = 1100
    this.props.onPinHover?.(id)
  }

  private renderRoutes() {
    for (const l of this.lines) l.setMap(null)
    this.lines = []
    const { scene } = this.props
    if (!scene.route || scene.stops.length < 2) return
    const days = new Map<number, MapStop[]>()
    for (const s of scene.stops) days.set(s.dayIndex, [...(days.get(s.dayIndex) ?? []), s])
    const one = days.size === 1
    const emphasis = scene.emphasisDay
    for (const [dayIndex, stops] of days) {
      if (stops.length < 2) continue
      const colour = cssVar(one ? scene.colourVar : `--trip-day-${dayIndex % 6}`, '#2348A6')
      const dim = emphasis !== undefined && emphasis !== null && dayIndex !== emphasis
      // A leg to a train, flight or car is dotted; the rest of the day is one solid line.
      let run: MapStop[] = [stops[0]]
      for (let i = 1; i < stops.length; i++) {
        const prev = stops[i - 1]
        const to = stops[i]
        if (to.category === 'transport') {
          if (run.length > 1) this.solid(run, colour, dim)
          this.dotted(prev, to, dim)
          run = [to]
        } else run.push(to)
      }
      if (run.length > 1) this.solid(run, colour, dim)
    }
  }

  private path(stops: MapStop[]) {
    return stops.map((s) => ({ lat: s.lat, lng: s.lng }))
  }

  /** A 5px day-colour line on a 10px white casing, with white chevrons ~100px apart. */
  private solid(stops: MapStop[], colour: string, dim: boolean) {
    const path = this.path(stops)
    const fade = dim ? 0.35 : 1
    this.lines.push(
      new this.g.maps.Polyline({
        map: this.map,
        path,
        strokeColor: '#ffffff',
        strokeOpacity: 0.95 * fade,
        strokeWeight: 10,
        zIndex: 1,
        clickable: false,
      }),
      new this.g.maps.Polyline({
        map: this.map,
        path,
        strokeColor: colour,
        strokeOpacity: fade,
        strokeWeight: 5,
        zIndex: 2,
        clickable: false,
        icons: [
          {
            icon: {
              // A chevron pointing along the line, filled white and edged in the day colour.
              path: 'M -3 3 L 0 -3 L 3 3 L 0 1.2 Z',
              scale: 1.5,
              strokeColor: colour,
              strokeOpacity: fade,
              strokeWeight: 1.5,
              fillColor: '#ffffff',
              fillOpacity: fade,
            },
            offset: '50px',
            repeat: '100px',
          },
        ],
      }),
    )
  }

  /** A transport leg: dots in --trip-transport on a white casing. */
  private dotted(from: MapStop, to: MapStop, dim: boolean) {
    const path = this.path([from, to])
    const fade = dim ? 0.35 : 1
    this.lines.push(
      new this.g.maps.Polyline({
        map: this.map,
        path,
        strokeColor: '#ffffff',
        strokeOpacity: 0.95 * fade,
        strokeWeight: 9,
        zIndex: 1,
        clickable: false,
      }),
      new this.g.maps.Polyline({
        map: this.map,
        path,
        // The line itself is invisible; the repeated dots are the leg.
        strokeOpacity: 0,
        zIndex: 2,
        clickable: false,
        icons: [
          {
            icon: {
              path: this.g.core.SymbolPath.CIRCLE,
              scale: 2.2,
              fillColor: cssVar('--trip-transport', '#4B5563'),
              fillOpacity: fade,
              strokeOpacity: 0,
            },
            offset: '0',
            repeat: '10px',
          },
        ],
      }),
    )
  }

  private renderPreview() {
    const pv = this.props.preview
    if (!pv) {
      if (this.preview) this.preview.map = null
      return
    }
    if (!this.preview)
      this.preview = new this.g.marker.AdvancedMarkerElement({
        content: previewElement(),
        zIndex: 900,
      })
    this.preview.position = { lat: pv.lat, lng: pv.lng }
    this.preview.map = this.map
    // A place being considered: bring it into view only if it is off screen.
    const b = this.bounds()
    if (b && !isVisible(b, pv, 0)) {
      this.markProgrammatic(true)
      this.map.panTo({ lat: pv.lat, lng: pv.lng })
    }
  }

  private setHot(id: string | null) {
    const before = this.hotId
    this.hotId = id
    for (const key of [before, id]) {
      const pin = key ? this.pins.get(key) : undefined
      if (!pin) continue
      pin.marker.zIndex = key === id ? 1100 : this.zFor(pin)
      updatePin(pin.el, this.spec(pin))
    }
    this.scheduleLabels()
  }

  // ---- pill collision ------------------------------------------------------------------------

  private scheduleLabels() {
    if (this.raf || this.disposed) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.layoutLabels()
    })
  }

  /** After the map settles: collapse the pills that would overlap (the anchor and dot stay). */
  layoutLabels() {
    if (this.disposed) return
    const b = this.bounds()
    if (!b) return
    const { scene } = this.props
    const project = projector(b, this.map.getZoom() ?? 2)
    const eligible = eligibleIds(scene, this.hotId)
    const items = []
    const obstacles = []
    for (const [id, pin] of this.pins) {
      // Clustered stops have no marker on the map: nothing to place or to avoid.
      if (!pin.marker.map) continue
      const at = project(pin.stop.lat, pin.stop.lng)
      if (eligible.has(id))
        items.push({
          id,
          x: at.x,
          y: at.y,
          w: pin.size.w,
          h: pin.size.h,
          priority: pin.stop.priority,
          hot: id === this.hotId,
        })
      else obstacles.push(at)
    }
    const kept = resolvePills(items, obstacles)
    for (const [id, pin] of this.pins) {
      const hidden = eligible.has(id) && !!pin.marker.map && !kept.has(id)
      if (pin.hidden === hidden) continue
      pin.hidden = hidden
      updatePin(pin.el, this.spec(pin))
    }
  }

  // ---- lifetime --------------------------------------------------------------------------------

  destroy() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.clearTimeout(this.programmaticTimer)
    this.clusterer.clearMarkers()
    this.clusterer.setMap(null)
    for (const pin of this.pins.values()) pin.marker.map = null
    this.pins.clear()
    for (const l of this.lines) l.setMap(null)
    this.lines = []
    if (this.preview) this.preview.map = null
    this.g.core.event.clearInstanceListeners(this.map)
    this.container.replaceChildren()
  }
}
