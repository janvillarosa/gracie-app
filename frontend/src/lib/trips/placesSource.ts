// Where place suggestions come from. Two sources behind one interface:
//  - Google Places API (New), called from the browser with the referrer-restricted key
//    (AutocompleteSuggestion with a session token per search session);
//  - a small synthetic "demo" list, used only when there is no key (dev and tests), clearly
//    labelled in the UI, so the add bar can still be exercised without Google.
// The Google libraries load lazily and never offline.
import { mapsConfig, type MapsConfig } from '@components/trips/gmap/config'
import { loadPlaces } from '@components/trips/gmap/loader'
import type { Place } from '@api/tripTypes'
import { placesOverride } from './placesOverride'
import { googlePlace, type LatLng, type PlaceInfo } from './places'

export type Bounds = { west: number; south: number; east: number; north: number }

/** One search session: every keystroke's request and the pick that ends it share it. The token
 *  is created lazily by the source; a pick (or clearing the search) starts a new session. */
export type Session = { token?: unknown; id: number }
let sessionSeq = 0
export const newSession = (): Session => ({ id: ++sessionSeq })

export type Suggestion = {
  id: string
  main: string
  secondary: string
  // The source's own object, kept to resolve this suggestion within its session.
  prediction?: unknown
}

export type Resolved = { place: Place; info: PlaceInfo }
export type Details = { info: PlaceInfo; at: LatLng | null }

export interface PlacesSource {
  readonly kind: 'google' | 'demo'
  suggest(input: string, o: { bias?: Bounds | null; session: Session }): Promise<Suggestion[]>
  /** The pick: fetches the place's fields with the session's token, which ends the session. */
  resolve(s: Suggestion, session: Session): Promise<Resolved>
  /** Fields for one place id, outside a search session (display cache, coordinate refresh). */
  details(placeId: string, fields: DetailField[]): Promise<Details>
}

export type DetailField = 'displayName' | 'formattedAddress' | 'addressComponents' | 'location'
/** Everything shown for a place: Essentials-style fields only. */
export const DISPLAY_FIELDS: DetailField[] = [
  'displayName',
  'formattedAddress',
  'addressComponents',
  'location',
]
/** What a pick asks for (the same token ends the session). */
export const PICK_FIELDS = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'addressComponents',
] as const

/** A box of about 50 km around a point, for biasing a search to a trip's area. */
export function biasBox(point: LatLng, km = 50): Bounds {
  // Rounded to 0.1 degree (about 10 km) before it leaves the device.
  const c = { lat: Math.round(point.lat * 10) / 10, lng: Math.round(point.lng * 10) / 10 }
  const dLat = km / 111
  const dLng = km / (111 * Math.max(0.2, Math.cos((c.lat * Math.PI) / 180)))
  return { west: c.lng - dLng, south: c.lat - dLat, east: c.lng + dLng, north: c.lat + dLat }
}

// ---- Google ----------------------------------------------------------------------------------

type Component = { longText?: string | null; types?: string[] }
export function localityOf(components?: Component[] | null): string | undefined {
  if (!components) return undefined
  for (const type of ['locality', 'postal_town', 'administrative_area_level_2']) {
    const c = components.find((x) => x.types?.includes(type))
    if (c?.longText) return c.longText
  }
  return undefined
}

function infoOf(p: {
  displayName?: string | null
  formattedAddress?: string | null
  addressComponents?: Component[] | null
}): PlaceInfo {
  return {
    name: p.displayName ?? undefined,
    address: p.formattedAddress ?? undefined,
    locality: localityOf(p.addressComponents),
  }
}
const pointOf = (loc?: { lat: () => number; lng: () => number } | null): LatLng | null =>
  loc ? { lat: loc.lat(), lng: loc.lng() } : null

export function googleSource(config: MapsConfig): PlacesSource {
  return {
    kind: 'google',
    async suggest(input, { bias, session }) {
      const lib = await loadPlaces(config)
      if (!session.token) session.token = new lib.AutocompleteSessionToken()
      const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken: session.token as google.maps.places.AutocompleteSessionToken,
        ...(bias ? { locationBias: bias } : {}),
        ...(typeof navigator !== 'undefined' && navigator.language
          ? { language: navigator.language }
          : {}),
      })
      return suggestions.flatMap((s) => {
        const p = s.placePrediction
        if (!p) return []
        return [
          {
            id: p.placeId,
            main: p.mainText?.text ?? p.text.text,
            secondary: p.secondaryText?.text ?? '',
            prediction: p,
          },
        ]
      })
    },
    async resolve(s, _session) {
      // toPlace() carries the session token of the suggestion, so this call ends the session.
      const place = (s.prediction as google.maps.places.PlacePrediction).toPlace()
      await place.fetchFields({ fields: [...PICK_FIELDS] })
      return { place: googlePlace(s.id, pointOf(place.location)), info: infoOf(place) }
    },
    async details(placeId, fields) {
      const lib = await loadPlaces(config)
      const place = new lib.Place({ id: placeId })
      await place.fetchFields({ fields })
      return { info: infoOf(place), at: pointOf(place.location) }
    },
  }
}

// ---- demo (no key) -----------------------------------------------------------------------------

type DemoPlace = { id: string; name: string; locality: string; address: string; tz?: string } & LatLng
export const DEMO_PLACES: DemoPlace[] = [
  { id: 'demo:lisbon', name: 'Lisbon', locality: 'Lisbon', address: 'Lisbon, Portugal', lat: 38.7223, lng: -9.1393, tz: 'Europe/Lisbon' },
  { id: 'demo:porto', name: 'Porto', locality: 'Porto', address: 'Porto, Portugal', lat: 41.1579, lng: -8.6291, tz: 'Europe/Lisbon' },
  { id: 'demo:heathrow', name: 'Heathrow Airport', locality: 'London', address: 'Longford, London', lat: 51.47, lng: -0.4543, tz: 'Europe/London' },
  {
    id: 'demo:se',
    name: 'Sé de Lisboa',
    locality: 'Lisboa',
    address: 'Largo da Sé, Lisboa',
    lat: 38.7101,
    lng: -9.133,
  },
  {
    id: 'demo:castelo',
    name: 'Castelo de São Jorge',
    locality: 'Lisboa',
    address: 'R. de Santa Cruz do Castelo, Lisboa',
    lat: 38.7139,
    lng: -9.1335,
  },
  {
    id: 'demo:belem',
    name: 'Torre de Belém',
    locality: 'Lisboa',
    address: 'Av. Brasília, Lisboa',
    lat: 38.6916,
    lng: -9.216,
  },
  {
    id: 'demo:jeronimos',
    name: 'Mosteiro dos Jerónimos',
    locality: 'Lisboa',
    address: 'Praça do Império, Lisboa',
    lat: 38.6979,
    lng: -9.2068,
  },
  {
    id: 'demo:pasteis',
    name: 'Pastéis de Belém',
    locality: 'Lisboa',
    address: 'R. de Belém 84, Lisboa',
    lat: 38.6975,
    lng: -9.2033,
  },
  {
    id: 'demo:timeout',
    name: 'Time Out Market',
    locality: 'Lisboa',
    address: 'Av. 24 de Julho, Lisboa',
    lat: 38.7067,
    lng: -9.1457,
  },
  {
    id: 'demo:pena',
    name: 'Pena Palace',
    locality: 'Sintra',
    address: 'Estrada da Pena, Sintra',
    lat: 38.7876,
    lng: -9.3906,
  },
  {
    id: 'demo:regaleira',
    name: 'Quinta da Regaleira',
    locality: 'Sintra',
    address: 'R. Barbosa du Bocage, Sintra',
    lat: 38.7966,
    lng: -9.3959,
  },
  {
    id: 'demo:cabo',
    name: 'Cabo da Roca',
    locality: 'Colares',
    address: 'Cabo da Roca, Colares',
    lat: 38.7804,
    lng: -9.4989,
  },
  {
    id: 'demo:aeroporto',
    name: 'Humberto Delgado Airport',
    locality: 'Lisboa',
    address: 'Alameda das Comunidades Portuguesas, Lisboa',
    lat: 38.7742,
    lng: -9.1342,
  },
  {
    id: 'demo:ribeira',
    name: 'Ribeira, Porto',
    locality: 'Porto',
    address: 'Cais da Ribeira, Porto',
    lat: 41.1406,
    lng: -8.6125,
  },
  {
    id: 'demo:livraria',
    name: 'Livraria Lello',
    locality: 'Porto',
    address: 'R. das Carmelitas 144, Porto',
    lat: 41.1469,
    lng: -8.6148,
  },
]

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const asInfo = (d: DemoPlace): PlaceInfo => ({
  name: d.name,
  address: d.address,
  locality: d.locality,
})

/** Synthetic places for dev without a key. Same interface, no network. */
export const demoSource: PlacesSource = {
  kind: 'demo',
  async suggest(input, { bias }) {
    const q = fold(input.trim())
    const near = (d: DemoPlace) =>
      bias
        ? Math.hypot(d.lat - (bias.north + bias.south) / 2, d.lng - (bias.east + bias.west) / 2)
        : 0
    return DEMO_PLACES.filter((d) => fold(d.name).includes(q) || fold(d.locality).includes(q))
      .sort((a, b) => near(a) - near(b))
      .slice(0, 5)
      .map((d) => ({ id: d.id, main: d.name, secondary: d.address, prediction: d }))
  },
  async resolve(s) {
    const d = s.prediction as DemoPlace
    return { place: googlePlace(d.id, d, new Date(), d.tz), info: asInfo(d) }
  },
  async details(placeId) {
    const d = DEMO_PLACES.find((x) => x.id === placeId)
    return d ? { info: asInfo(d), at: d } : { info: {}, at: null }
  },
}

let cached: { key: string; source: PlacesSource } | null = null
export { setPlacesSource } from './placesOverride'

/** Google when there is a key, else the demo list. */
export function getPlacesSource(): PlacesSource {
  const forced = placesOverride()
  if (forced) return forced
  const config = mapsConfig()
  if (!config.key) return demoSource
  // One source per key, so hooks that depend on it do not re-run every render.
  if (!cached || cached.key !== config.key)
    cached = { key: config.key, source: googleSource(config) }
  return cached.source
}
