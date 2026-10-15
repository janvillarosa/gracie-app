import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Place, Trip } from '../api/tripTypes'
import * as endpoints from '../api/tripEndpoints'
import {
  enrichTrip,
  googlePlace,
  needsRefresh,
  placeInfo,
  placeText,
  REFRESH_AFTER_MS,
  refreshPatch,
  resetPlaceInfo,
  sanitizePatch,
  sanitizePlace,
  SAVED_PLACE,
  selectRefresh,
  setPlaceInfo,
  todoTitle,
  worthRefreshing,
} from '../lib/trips/places'
import { DEMO_PLACES, demoSource, localityOf, setPlacesSource } from '../lib/trips/placesSource'
import { DEBOUNCE_MS, MIN_QUERY, usePlaceSuggest, type Suggest } from '../lib/trips/usePlaces'
import {
  FakeAutocomplete,
  FakePlace,
  FakeToken,
  fakeLayout,
  resetGoogleFake,
} from './googleFake'

vi.mock('@googlemaps/js-api-loader', async () => (await import('./googleFake')).loaderMock())
vi.mock('@googlemaps/markerclusterer', async () => (await import('./googleFake')).clustererMock())

const NOW = Date.parse('2026-10-15T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const google = (id: string, over: Partial<Place> = {}): Place => ({
  source: 'google',
  place_id: id,
  lat: 38.7,
  lng: -9.1,
  coords_fetched_at: iso(DAY),
  ...over,
})
const trip = (over: Partial<Trip> = {}): Trip =>
  ({
    trip_id: 'trip_1',
    title: 'T',
    todos: [],
    bookings: [],
    version: 1,
    ...over,
  }) as Trip
const todo = (id: string, place: Place | null, title = '') =>
  ({ todo_id: id, title, done: false, order: 1, category: 'other', place }) as Trip['todos'][number]

beforeEach(() => {
  resetGoogleFake()
  fakeLayout()
  resetPlaceInfo()
})
afterEach(() => {
  setPlacesSource(null)
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('what gets stored on a pick', () => {
  it('keeps only the source, place id, coordinates and the fetch time: no name, no address', () => {
    const p = googlePlace('ChIJabc', { lat: 38.7, lng: -9.1 }, new Date(NOW))
    expect(p).toEqual({
      source: 'google',
      place_id: 'ChIJabc',
      lat: 38.7,
      lng: -9.1,
      coords_fetched_at: new Date(NOW).toISOString(),
    })
    expect(Object.keys(p)).not.toContain('name')
    expect(Object.keys(p)).not.toContain('address')
  })

  it('has no coordinates (and no fetch time) when Google gave none', () => {
    expect(googlePlace('ChIJabc', null)).toEqual({ source: 'google', place_id: 'ChIJabc' })
  })

  it('strips Google content from a patch on its way out, whatever a sheet spreads in', () => {
    setPlaceInfo('ChIJabc', { name: 'Sé', address: 'Largo da Sé', locality: 'Lisboa' })
    const enriched = enrichTrip(trip({ todos: [todo('t', google('ChIJabc'))] })).todos[0].place as Place
    expect(enriched.name).toBe('Sé')
    const clean = sanitizePatch({ title: 'x', place: { ...enriched, tz: 'Europe/Lisbon' } })
    expect(clean.place).toEqual({ ...google('ChIJabc'), tz: 'Europe/Lisbon' })
    expect(JSON.stringify(clean)).not.toContain('Largo da Sé')
    // The user's own locality survives; the one the cache supplied does not.
    expect(sanitizePlace({ ...google('ChIJabc'), locality: 'Alfama', name: 'Sé' }).locality).toBe(
      'Alfama',
    )
    expect(sanitizePlace({ ...google('ChIJabc'), locality: 'Lisboa' }).locality).toBeUndefined()
    // Pins and manual places are user content.
    const pin: Place = { source: 'pin', name: 'Dropped', lat: 1, lng: 2 }
    expect(sanitizePlace(pin)).toBe(pin)
    expect(sanitizePatch({ stops: [{ ...enriched }] }).stops).toEqual([google('ChIJabc')])
  })
})

describe('display from the session cache', () => {
  it('shows the title, else the Google name, else "Saved place"', () => {
    const p = google('ChIJabc')
    expect(todoTitle(todo('t', p, 'Lunch'))).toBe('Lunch')
    expect(todoTitle(todo('t', p))).toBe(SAVED_PLACE)
    setPlaceInfo('ChIJabc', { name: 'Time Out Market', locality: 'Lisboa' })
    expect(todoTitle(todo('t', p))).toBe('Time Out Market')
    expect(todoTitle(todo('t', p, 'Lunch'))).toBe('Lunch')
    expect(todoTitle(todo('t', null))).toBe('')
  })

  it('fills places for display and leaves the same trip object when there is nothing to add', () => {
    const t = trip({ todos: [todo('t', google('ChIJabc'))], destination: google('ChIJdest') })
    expect(enrichTrip(t)).toBe(t)
    setPlaceInfo('ChIJabc', { name: 'Pena', address: 'Estrada da Pena', locality: 'Sintra' })
    const e = enrichTrip(t)
    expect(e).not.toBe(t)
    expect(e.todos[0].place).toMatchObject({ name: 'Pena', address: 'Estrada da Pena', locality: 'Sintra' })
    expect(e.destination).toBe(t.destination)
    // The stored trip is untouched.
    expect(t.todos[0].place?.name).toBeUndefined()
  })

  it('has a name line for a place: the cache while online, "Saved place" when nothing is known', () => {
    expect(placeText(google('ChIJabc'))).toEqual({ name: SAVED_PLACE, sub: '' })
    setPlaceInfo('ChIJabc', { name: 'Pena', address: 'Estrada da Pena, Sintra' })
    expect(placeText(google('ChIJabc'))).toEqual({ name: 'Pena', sub: 'Estrada da Pena, Sintra' })
    // A user's own pin keeps its name and says nothing of Google.
    expect(placeText({ source: 'pin', name: 'Dropped', lat: 1, lng: 2 }).name).toBe('Dropped')
    expect(placeText(null)).toEqual({ name: '', sub: '' })
  })

  it('lives in memory only: nothing is written to browser storage', () => {
    const local = vi.spyOn(Storage.prototype, 'setItem')
    setPlaceInfo('ChIJabc', { name: 'Pena' })
    expect(local).not.toHaveBeenCalled()
    expect(placeInfo('ChIJabc')?.name).toBe('Pena')
    resetPlaceInfo()
    expect(placeInfo('ChIJabc')).toBeUndefined()
  })

  it('takes the locality from the address components', () => {
    expect(localityOf([{ longText: 'Rua', types: ['route'] }, { longText: 'Sintra', types: ['locality'] }])).toBe(
      'Sintra',
    )
    expect(localityOf([{ longText: 'Porto', types: ['postal_town'] }])).toBe('Porto')
    expect(localityOf(null)).toBeUndefined()
  })
})

describe('refreshing coordinates (pure selection)', () => {
  it('wants Google places with no coordinates, or coordinates older than 25 days', () => {
    expect(needsRefresh(google('a'), NOW)).toBe(false)
    expect(needsRefresh(google('a', { coords_fetched_at: iso(REFRESH_AFTER_MS + 1000) }), NOW)).toBe(true)
    expect(needsRefresh(google('a', { coords_fetched_at: iso(24 * DAY) }), NOW)).toBe(false)
    expect(needsRefresh({ source: 'google', place_id: 'a' }, NOW)).toBe(true)
    // Pins, manual places and a place with no id are not ours to refresh.
    expect(needsRefresh({ source: 'pin', name: 'x', lat: 1, lng: 2 }, NOW)).toBe(false)
    expect(needsRefresh({ source: 'google' }, NOW)).toBe(false)
    expect(needsRefresh(null, NOW)).toBe(false)
  })

  it('finds every stale slot of a trip, in order', () => {
    const stale = google('old', { coords_fetched_at: iso(26 * DAY) })
    const t = trip({
      destination: stale,
      stops: [google('fresh'), google('gone', { lat: undefined, lng: undefined, coords_fetched_at: undefined })],
      todos: [todo('t1', stale), todo('t2', google('fresh'))],
      bookings: [
        {
          booking_id: 'b1',
          kind: 'flight',
          title: 'F',
          place: google('fresh'),
          end_place: stale,
        } as Trip['bookings'][number],
      ],
    })
    expect(selectRefresh(t, NOW).map((x) => x.slot)).toEqual([
      { kind: 'trip', field: 'destination' },
      { kind: 'trip', field: 'stops', index: 1 },
      { kind: 'todo', id: 't1', field: 'place' },
      { kind: 'booking', id: 'b1', field: 'end_place' },
    ])
  })

  it('writes fresh coordinates as an ordinary patch, with no name', () => {
    setPlaceInfo('old', { name: 'Old place' })
    const stale = google('old', { coords_fetched_at: iso(26 * DAY) })
    const t = trip({ stops: [google('a'), stale], todos: [todo('t1', stale)] })
    const targets = selectRefresh(t, NOW)
    const now = new Date(NOW)
    expect(refreshPatch(t, targets.find((x) => x.slot.kind === 'todo') as never, { lat: 1, lng: 2 }, now)).toEqual({
      place: { source: 'google', place_id: 'old', lat: 1, lng: 2, coords_fetched_at: now.toISOString() },
    })
    const stops = refreshPatch(t, targets.find((x) => x.slot.kind === 'trip') as never, { lat: 1, lng: 2 }, now)
      .stops as Place[]
    expect(stops).toHaveLength(2)
    expect(stops[0]).toEqual(google('a'))
    expect(stops[1].lat).toBe(1)
    expect(JSON.stringify(stops)).not.toContain('Old place')
  })

  it('only bothers with current and upcoming trips', () => {
    expect(worthRefreshing(trip({ end_date: '2026-10-20' }), '2026-10-15')).toBe(true)
    expect(worthRefreshing(trip({ end_date: '2026-10-01' }), '2026-10-15')).toBe(false)
    expect(worthRefreshing(trip({}), '2026-10-15')).toBe(true)
    expect(worthRefreshing(trip({ end_date: '2026-12-01', deleted: { by: 'x' } }), '2026-10-15')).toBe(false)
  })
})

// A small harness around the hook, to watch its search sessions.
let hook: Suggest
const Harness: React.FC<{ q: string }> = ({ q }) => {
  hook = usePlaceSuggest(q, { lat: 38.7, lng: -9.1 })
  return <div data-testid="n">{hook.suggestions.length}</div>
}

describe('suggestions from Google (one session token per search)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  const settle = async (ms = DEBOUNCE_MS + 10) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  it('waits 250 ms and two characters before asking', async () => {
    expect(DEBOUNCE_MS).toBeGreaterThanOrEqual(250)
    expect(MIN_QUERY).toBe(2)
    const { rerender } = render(<Harness q="p" />)
    await settle()
    expect(FakeAutocomplete.requests).toHaveLength(0)
    rerender(<Harness q="pe" />)
    await settle(DEBOUNCE_MS - 50)
    expect(FakeAutocomplete.requests).toHaveLength(0)
    await settle(100)
    expect(FakeAutocomplete.requests).toHaveLength(1)
    // A burst of typing makes one request, for the last text.
    rerender(<Harness q="pen" />)
    await settle(100)
    rerender(<Harness q="pena" />)
    await settle()
    expect(FakeAutocomplete.requests.map((r) => r.input)).toEqual(['pe', 'pena'])
  })

  it('reuses one session token while typing, and ends the session with the pick', async () => {
    const { rerender } = render(<Harness q="pe" />)
    await settle()
    rerender(<Harness q="pena" />)
    await settle()
    const [a, b] = FakeAutocomplete.requests
    expect(a.sessionToken).toBeInstanceOf(FakeToken)
    expect(b.sessionToken).toBe(a.sessionToken)
    expect(FakeToken.made).toBe(1)

    // The pick fetches the fields from a place made from the prediction, so it carries the token.
    let picked: Place | null = null
    await act(async () => {
      picked = await hook.pick(hook.suggestions[0])
    })
    expect(FakePlace.fetches).toEqual([
      {
        id: 'ChIJpena',
        fields: ['id', 'displayName', 'formattedAddress', 'location', 'addressComponents'],
        token: a.sessionToken,
      },
    ])
    expect(picked).toEqual({
      source: 'google',
      place_id: 'ChIJpena',
      lat: 38.711,
      lng: -9.142,
      coords_fetched_at: expect.any(String),
    })
    // The name is remembered for display, not stored.
    expect(placeInfo('ChIJpena')).toEqual({
      name: 'Livraria Bertrand',
      address: 'Rua Augusta 10, Lisboa',
      locality: 'Lisboa',
    })

    // The next search is a new session.
    rerender(<Harness q="" />)
    rerender(<Harness q="se" />)
    await settle()
    const last = FakeAutocomplete.requests[FakeAutocomplete.requests.length - 1]
    expect(last?.sessionToken).not.toBe(a.sessionToken)
    expect(FakeToken.made).toBe(2)
  })

  it('biases the search to the trip area, rounded, and degrades when Google says no', async () => {
    render(<Harness q="pena" />)
    await settle()
    const bias = FakeAutocomplete.requests[0].locationBias as Record<string, number>
    expect(bias.north).toBeGreaterThan(bias.south)
    // Centre rounded to a tenth of a degree before it leaves the device.
    expect((bias.north + bias.south) / 2).toBeCloseTo(38.7, 5)
    expect((bias.east + bias.west) / 2).toBeCloseTo(-9.1, 5)

    FakeAutocomplete.fail = true
    const { rerender } = render(<Harness q="pen" />)
    await settle()
    rerender(<Harness q="pena" />)
    await settle()
    expect(hook.degraded).toBe(true)
    expect(hook.suggestions).toEqual([])
    expect(hook.attribution).toBe('google')
  })

  it('answers null when the pick cannot reach Google, so nothing is added', async () => {
    render(<Harness q="pena" />)
    await settle()
    FakePlace.next = 'fail'
    let picked: Place | null | undefined
    await act(async () => {
      picked = await hook.pick(hook.suggestions[0])
    })
    expect(picked).toBeNull()
  })
})

describe('without a key', () => {
  it('uses a labelled demo list, never Google', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    render(<Harness q="sé" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10)
    })
    expect(hook.attribution).toBe('demo')
    expect(hook.suggestions.map((s) => s.main)).toContain('Sé de Lisboa')
    expect(FakeAutocomplete.requests).toHaveLength(0)
    expect(DEMO_PLACES.every((d) => d.id.startsWith('demo:'))).toBe(true)
    const r = await demoSource.resolve(hook.suggestions[0], { id: 1 })
    expect(r.place.source).toBe('google')
    expect(r.place).not.toHaveProperty('name')
  })
})

describe('the Photon proxy is gone', () => {
  it('has no places endpoints on the client', () => {
    expect(Object.keys(endpoints)).not.toContain('searchPlaces')
    expect(Object.keys(endpoints)).not.toContain('reversePlace')
  })
})

// A page-level check that a pick stores only the allowed fields and the row shows the name.
describe('the row after a pick', () => {
  it('is shown by its Google name once fetched', async () => {
    setPlaceInfo('ChIJpena', { name: 'Pena Palace' })
    const Row: React.FC = () => <span>{todoTitle(todo('t', google('ChIJpena')))}</span>
    render(<Row />)
    expect(await screen.findByText('Pena Palace')).toBeInTheDocument()
    await waitFor(() => expect(placeInfo('ChIJpena')?.name).toBe('Pena Palace'))
  })
})
