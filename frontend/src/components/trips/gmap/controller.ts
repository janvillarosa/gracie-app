// The Google map behind the MapView adapter, as plain imperative code (the React component in
// MapCanvas.tsx only owns its lifetime). It draws a MapScene as AdvancedMarkerElements with our
// own HTML, clusters stacked stops, joins a day with a Polyline, and answers clicks.
//
// Camera rule (brief 6q): the camera moves only on an explicit action. `sync` never moves it for
// an emphasis change; it fits when the set of stops changes while `following`, on `fitToken`, and
// pans only when an opened item or a previewed place is off screen.
import { MarkerClusterer, SuperClusterAlgorithm } from '@googlemaps/markerclusterer'
import type { MapClick, MapStop } from '@lib/trips/mapScene'
import type { MapViewProps } from '../mapView'
import type { MapsConfig } from './config'
import { centreFor, isVisible, projector, type Bounds } from './geometry'
import { eligibleIds, labelText, resolveLabels, type Anchor } from './labels'
import { loadGeocoding, loadPlaces, type Google } from './loader'
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
const GEOCODE_WAIT_MS = 1500

type Pin = {
  stop: MapStop
  marker: google.maps.marker.AdvancedMarkerElement
  el: HTMLElement
  text: string
  anchor: Anchor
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
  // True while our own camera move runs, so it is not mistaken for the person moving the map.
  private programmatic = true
  private programmaticTimer = 0
  private raf = 0
  private clickSeq = 0
  private disposed = false
  private ready = false
  private onReady?: () => void

  constructor({ google: g, container, config, props, onReady }: ControllerInit) {
    this.g = g
    this.container = container
    this.onReady = onReady
    const interactive = props.interactive
    this.map = new g.maps.Map(container, {
      mapId: config.mapId,
      center: { lat: 20, lng: 0 },
      zoom: 2,
      // Our own +/− and Fit buttons; only the Google logo and terms stay.
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      clickableIcons: interactive,
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
      if (!this.programmatic) this.userMoved()
    })
    this.map.addListener('idle', () => {
      this.programmatic = false
      window.clearTimeout(this.programmaticTimer)
      this.scheduleLabels()
      if (!this.ready) {
        this.ready = true
        this.onReady?.()
      }
    })
    this.map.addListener('click', (e: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => {
      void this.handleClick(e)
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

  private markProgrammatic(on: boolean) {
    this.programmatic = on
    window.clearTimeout(this.programmaticTimer)
    // A move that changes nothing never reports idle: do not stay "ours" forever.
    if (on) this.programmaticTimer = window.setTimeout(() => (this.programmatic = false), 1500)
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

  /** Fit every stop in the scene, clear of the view's own chrome. An explicit fit (Fit day, a day
   *  picked) of a scene with a day in emphasis fits that day's stops; the automatic fit on load
   *  always takes the whole scene, so scrolling the list never moves the camera. */
  fit(force: boolean) {
    const p = this.props
    const all = p.scene.stops
    const day = p.scene.emphasisDay
    const ofDay =
      force && day !== undefined && day !== null ? all.filter((s) => s.dayIndex === day) : []
    const stops = ofDay.length ? ofDay : all
    if (!stops.length) return
    const key = all.map((s) => `${s.id}:${s.lat}:${s.lng}`).join('|')
    if (!force && (!p.following || key === this.lastFit)) return
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
    this.map.fitBounds(b, p.fitPadding ?? { top: 56, bottom: 56, left: 56, right: 56 })
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

  // ---- pins, routes, preview ---------------------------------------------------------------

  private spec(pin: Pin): PinSpec {
    const { scene } = this.props
    const colours = pipColours(pin.stop, scene)
    return {
      text: pin.text,
      title: pin.stop.label,
      ...colours,
      state: pinState(pin.stop, scene, {
        hot: pin.stop.id === this.hotId,
        hidden: pin.hidden,
        anchor: pin.anchor,
      }),
    }
  }

  private renderPins() {
    const p = this.props
    const { scene } = p
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
        pin = { stop: s, marker, el, text: '', anchor: 'right', hidden: false }
        this.pins.set(s.id, pin)
      } else {
        pin.stop = s
        pin.marker.position = { lat: s.lat, lng: s.lng }
      }
      pin.text = labelText(s, scene, p.labelLimit, p.nextPrefix)
      pin.marker.title = s.label
      // Lower priority numbers sit on top: selected, then next, then the day's order.
      pin.marker.zIndex = 1000 - Math.min(s.priority, 500)
      updatePin(pin.el, this.spec(pin))
      // The next and selected stops are never clustered.
      if (s.id === scene.nextId || s.id === scene.selectedId) lit.push(pin.marker)
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
      this.lines.push(
        new this.g.maps.Polyline({
          map: this.map,
          path: stops.map((s) => ({ lat: s.lat, lng: s.lng })),
          strokeColor: colour,
          strokeOpacity: dim ? 0.2 : 0.55,
          strokeWeight: 3,
          clickable: false,
          // Arrows along the line show the order.
          icons: [
            {
              icon: {
                path: this.g.core.SymbolPath.FORWARD_CLOSED_ARROW,
                scale: 2.2,
                strokeColor: colour,
                strokeOpacity: dim ? 0.3 : 0.85,
                fillColor: colour,
                fillOpacity: dim ? 0.3 : 0.85,
              },
              offset: '50%',
              repeat: '120px',
            },
          ],
        }),
      )
    }
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
      pin.marker.zIndex = key === id ? 1100 : 1000 - Math.min(pin.stop.priority, 500)
      updatePin(pin.el, this.spec(pin))
    }
    this.scheduleLabels()
  }

  // ---- label collision ----------------------------------------------------------------------

  private scheduleLabels() {
    if (this.raf || this.disposed) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.layoutLabels()
    })
  }

  /** After the map settles: hide the names that would overlap (pips always stay). */
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
      // Clustered stops have no marker on the map: nothing to label or to avoid.
      if (!pin.marker.map) continue
      const at = project(pin.stop.lat, pin.stop.lng)
      if (eligible.has(id))
        items.push({
          id,
          x: at.x,
          y: at.y,
          text: pin.text,
          priority: pin.stop.priority,
          hot: id === this.hotId,
        })
      else obstacles.push(at)
    }
    const placed = resolveLabels(
      items,
      { width: this.container.clientWidth, height: this.container.clientHeight },
      obstacles,
    )
    for (const [id, pin] of this.pins) {
      const anchor = placed.get(id)
      const hidden = eligible.has(id) && !anchor
      if (pin.hidden === hidden && (!anchor || pin.anchor === anchor)) continue
      pin.hidden = hidden
      if (anchor) pin.anchor = anchor
      updatePin(pin.el, this.spec(pin))
    }
  }

  // ---- click to add ---------------------------------------------------------------------------

  private pixel(lat: number, lng: number) {
    const b = this.bounds()
    return b ? projector(b, this.map.getZoom() ?? 2)(lat, lng) : { x: 0, y: 0 }
  }

  /** A click on a Google place gives its place_id (Place Details, Essentials fields); an empty
   *  spot is reverse-geocoded. The display name is Google content: shown, never stored. */
  private async handleClick(e: google.maps.MapMouseEvent | google.maps.IconMouseEvent) {
    const p = this.props
    if (!p.interactive || !p.onMapClick || !e.latLng) return
    // No Google info window on top of our own card.
    e.stop()
    const my = ++this.clickSeq
    let lat = e.latLng.lat()
    let lng = e.latLng.lng()
    const placeId = (e as google.maps.IconMouseEvent).placeId ?? undefined
    let displayName: string | undefined
    let typeName: string | undefined
    let place_id: string | undefined
    try {
      if (placeId) {
        const { Place } = await loadPlaces()
        const place = new Place({ id: placeId })
        await place.fetchFields({
          fields: [
            'id',
            'displayName',
            'formattedAddress',
            'location',
            'primaryTypeDisplayName',
          ],
        })
        place_id = placeId
        displayName = place.displayName ?? undefined
        typeName = place.primaryTypeDisplayName ?? undefined
        if (place.location) {
          lat = place.location.lat()
          lng = place.location.lng()
        }
      } else {
        const { Geocoder } = await loadGeocoding()
        const found = await Promise.race([
          new Geocoder().geocode({ location: { lat, lng } }),
          new Promise<null>((r) => window.setTimeout(() => r(null), GEOCODE_WAIT_MS)),
        ])
        displayName = found?.results?.[0]?.formatted_address || undefined
      }
    } catch {
      // The card still opens, as a dropped pin the person can name.
      if (placeId) place_id = placeId
    }
    if (my !== this.clickSeq || this.disposed) return
    const at = this.pixel(lat, lng)
    const click: MapClick = {
      lat,
      lng,
      x: at.x,
      y: at.y,
      ...(place_id ? { place_id } : {}),
      ...(displayName ? { displayName, name: displayName } : {}),
      ...(typeName ? { typeName } : {}),
    }
    this.props.onMapClick?.(click)
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
