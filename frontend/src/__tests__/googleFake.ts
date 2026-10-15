import { vi } from 'vitest'

// A stand-in for the Google Maps JavaScript API and the marker clusterer: it records what the
// page puts on the map and lets a test act as the person (move, click, tap a pin, cluster pins)
// with no network and no WebGL. Used with:
//
//   vi.mock('@googlemaps/js-api-loader', async () => (await import('./googleFake')).loaderMock())
//   vi.mock('@googlemaps/markerclusterer', async () => (await import('./googleFake')).clustererMock())
type Fn = (e?: any) => void

export type View = { north: number; south: number; east: number; west: number; zoom: number }

export class FakeMap {
  static last: FakeMap | null = null
  static made = 0
  listeners = new Map<string, Fn[]>()
  once = new Map<string, Fn[]>()
  options: Record<string, unknown>
  // About 800 x 600 px around Lisbon at zoom 10.
  view: View = { north: 39.0, south: 38.36, east: -8.6, west: -9.7, zoom: 10 }
  fitBounds = vi.fn()
  setCenter = vi.fn()
  panTo = vi.fn()
  setZoom = vi.fn((z: number) => {
    this.view.zoom = z
  })
  constructor(
    public container: HTMLElement,
    options: Record<string, unknown>,
  ) {
    FakeMap.last = this
    FakeMap.made++
    this.options = options
    // The first idle: the map is up.
    setTimeout(() => this.emit('idle'), 0)
  }
  addListener(type: string, fn: Fn) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
    return { remove: () => {} }
  }
  emit(type: string, e?: unknown) {
    // One-shot listeners added while this event runs wait for the next one, as on Google's map.
    const once = type === 'idle' ? (this.once.get('idle') ?? []) : []
    if (type === 'idle') this.once.delete('idle')
    for (const fn of this.listeners.get(type) ?? []) fn(e)
    for (const fn of once) fn()
  }
  getBounds() {
    const v = this.view
    return {
      toJSON: () => ({ north: v.north, south: v.south, east: v.east, west: v.west }),
      contains: (p: { lat: number; lng: number }) =>
        p.lat <= v.north && p.lat >= v.south && p.lng >= v.west && p.lng <= v.east,
    }
  }
  getZoom() {
    return this.view.zoom
  }
  /** Everything that moved the camera. */
  get moves() {
    return (
      this.fitBounds.mock.calls.length +
      this.setCenter.mock.calls.length +
      this.panTo.mock.calls.length
    )
  }
  clearMoves() {
    this.fitBounds.mockClear()
    this.setCenter.mockClear()
    this.panTo.mockClear()
    this.setZoom.mockClear()
  }
}

export class FakeMarker {
  static all: FakeMarker[] = []
  static reset() {
    FakeMarker.all = []
  }
  position: { lat: number; lng: number } | null
  content: HTMLElement
  map: FakeMap | null = null
  zIndex: number | undefined
  title = ''
  gmpClickable: boolean
  listeners = new Map<string, Fn[]>()
  constructor(o: {
    position?: { lat: number; lng: number }
    content: HTMLElement
    zIndex?: number
    gmpClickable?: boolean
  }) {
    this.position = o.position ?? null
    this.content = o.content
    this.zIndex = o.zIndex
    this.gmpClickable = !!o.gmpClickable
    FakeMarker.all.push(this)
  }
  addEventListener(type: string, fn: Fn) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  click() {
    for (const fn of this.listeners.get('gmp-click') ?? []) fn()
  }
  /** A stop's pin, by its label text. */
  static pins() {
    return FakeMarker.all.filter((m) => m.content.classList.contains('gm-pin'))
  }
  static clusters() {
    return FakeMarker.all.filter((m) => m.content.classList.contains('gm-cluster'))
  }
  static preview() {
    return FakeMarker.all.find((m) => m.content.classList.contains('gm-preview'))
  }
  /** The pill's name. */
  get label() {
    return this.content.querySelector('.gm-name')?.textContent ?? ''
  }
  get time() {
    return this.content.querySelector('.gm-time')?.textContent ?? ''
  }
  get shown() {
    return this.map !== null
  }
}

export class FakePolyline {
  static all: FakePolyline[] = []
  static reset() {
    FakePolyline.all = []
  }
  map: unknown
  constructor(public options: Record<string, any>) {
    this.map = options.map
    FakePolyline.all.push(this)
  }
  setMap(m: unknown) {
    this.map = m
  }
  get live() {
    return !!this.map
  }
}

export class FakeBounds {
  points: Array<{ lat: number; lng: number }> = []
  extend(p: { lat: number; lng: number }) {
    this.points.push(p)
  }
}

export class FakeClusterer {
  static last: FakeClusterer | null = null
  markers: FakeMarker[] = []
  listeners = new Map<string, Fn[]>()
  renderer: { render: (c: { count: number; position: unknown }) => FakeMarker }
  onClusterClick: (e: unknown, cluster: { bounds?: unknown }, map: FakeMap) => void
  map: FakeMap | null
  constructor(o: {
    map: FakeMap
    renderer: FakeClusterer['renderer']
    onClusterClick: FakeClusterer['onClusterClick']
    algorithm?: unknown
  }) {
    FakeClusterer.last = this
    this.map = o.map
    this.renderer = o.renderer
    this.onClusterClick = o.onClusterClick
  }
  addListener(type: string, fn: Fn) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  addMarkers(list: FakeMarker[]) {
    this.markers.push(...list)
    // By default nothing is stacked: every marker is drawn.
    for (const m of list) m.map = this.map
    for (const fn of this.listeners.get('clusteringend') ?? []) fn()
  }
  removeMarker(m: FakeMarker) {
    this.markers = this.markers.filter((x) => x !== m)
  }
  clearMarkers() {
    this.markers = []
  }
  setMap(m: FakeMap | null) {
    this.map = m
  }
  /** Stack these markers into one cluster, as the clusterer does when they sit on top of each other. */
  stack(ids: FakeMarker[]) {
    for (const m of ids) m.map = null
    const first = ids[0]
    const cluster = this.renderer.render({ count: ids.length, position: first.position })
    cluster.map = this.map
    for (const fn of this.listeners.get('clusteringend') ?? []) fn()
    return cluster
  }
}

export class FakePlace {
  static fetches: Array<{ id: string; fields: string[]; token?: unknown }> = []
  static next: { displayName?: string; lat: number; lng: number } | 'fail' = {
    displayName: 'Livraria Bertrand',
    lat: 38.711,
    lng: -9.142,
  }
  displayName: string | null = null
  formattedAddress: string | null = null
  addressComponents: Array<{ longText: string; types: string[] }> | null = null
  location: { lat: () => number; lng: () => number } | null = null
  constructor(public o: { id: string; sessionToken?: unknown }) {}
  async fetchFields(f: { fields: string[] }) {
    FakePlace.fetches.push({ id: this.o.id, fields: f.fields, token: this.o.sessionToken })
    const n = FakePlace.next
    if (n === 'fail') throw new Error('nope')
    this.displayName = n.displayName ?? null
    this.formattedAddress = 'Rua Augusta 10, Lisboa'
    this.addressComponents = [{ longText: 'Lisboa', types: ['locality'] }]
    this.location = { lat: () => n.lat, lng: () => n.lng }
  }
}

export class FakeGeocoder {
  static calls: Array<{ location: { lat: number; lng: number } }> = []
  static result: { formatted_address: string; place_id: string }[] | 'fail' | 'hang' = [
    { formatted_address: 'Rua Augusta 10, Lisboa', place_id: 'ChIJstreet' },
  ]
  async geocode(r: { location: { lat: number; lng: number } }) {
    FakeGeocoder.calls.push(r)
    const res = FakeGeocoder.result
    if (res === 'fail') throw new Error('nope')
    if (res === 'hang') return new Promise<never>(() => {})
    return { results: res }
  }
}

export class FakeToken {
  static made = 0
  id = ++FakeToken.made
}

type Result = { id: string; main: string; secondary: string }
/** google.maps.places.AutocompleteSuggestion: fetchAutocompleteSuggestions with a session token. */
export class FakeAutocomplete {
  static requests: Array<Record<string, unknown>> = []
  static results: Result[] = [
    { id: 'ChIJpena', main: 'Pena Palace', secondary: 'Sintra, Portugal' },
    { id: 'ChIJse', main: 'Sé de Lisboa', secondary: 'Lisboa, Portugal' },
  ]
  static fail = false
  static async fetchAutocompleteSuggestions(req: Record<string, unknown>) {
    FakeAutocomplete.requests.push(req)
    if (FakeAutocomplete.fail) throw new Error('quota')
    return {
      suggestions: FakeAutocomplete.results.map((r) => ({
        placePrediction: {
          placeId: r.id,
          mainText: { text: r.main },
          secondaryText: { text: r.secondary },
          text: { text: `${r.main}, ${r.secondary}` },
          // A place made from a prediction carries its session token.
          toPlace: () => new FakePlace({ id: r.id, sessionToken: req.sessionToken }),
        },
      })),
    }
  }
}

export const libs = () => ({
  maps: { Map: FakeMap, Polyline: FakePolyline },
  marker: { AdvancedMarkerElement: FakeMarker },
  core: {
    LatLngBounds: FakeBounds,
    SymbolPath: { FORWARD_CLOSED_ARROW: 1, CIRCLE: 0 },
    event: {
      addListenerOnce: (map: FakeMap, type: string, fn: Fn) =>
        map.once.set(type, [...(map.once.get(type) ?? []), fn]),
      clearInstanceListeners: () => {},
    },
  },
  places: {
    Place: FakePlace,
    AutocompleteSuggestion: FakeAutocomplete,
    AutocompleteSessionToken: FakeToken,
  },
  geocoding: { Geocoder: FakeGeocoder },
})

export const importLibrary = vi.fn(async (name: string) => (libs() as any)[name])
export const setOptions = vi.fn()

export const loaderMock = () => ({ importLibrary, setOptions })
export const clustererMock = () => ({
  MarkerClusterer: FakeClusterer,
  SuperClusterAlgorithm: class {},
})

export function resetGoogleFake() {
  FakeMap.last = null
  FakeMap.made = 0
  FakeMarker.reset()
  FakePolyline.reset()
  FakeClusterer.last = null
  FakePlace.fetches = []
  FakeAutocomplete.requests = []
  FakeAutocomplete.fail = false
  FakeToken.made = 0
  FakeGeocoder.calls = []
  FakeGeocoder.result = [{ formatted_address: 'Rua Augusta 10, Lisboa', place_id: 'ChIJstreet' }]
  FakePlace.next = { displayName: 'Livraria Bertrand', lat: 38.711, lng: -9.142 }
  importLibrary.mockClear()
  setOptions.mockClear()
}

/** jsdom has no layout: give every element a map-sized box so the label pass has room. */
export function fakeLayout(w = 800, h = 600) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: w })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: h })
}
