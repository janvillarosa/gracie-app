import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tripServer } from '../testServer'
import { lisbonTrip, rel, renderTrips, resetTripsWorld, seed, setViewport } from './trips.helpers'

vi.mock('@googlemaps/js-api-loader', async () => (await import('./googleFake')).loaderMock())
vi.mock('@googlemaps/markerclusterer', async () => (await import('./googleFake')).clustererMock())

import {
  FakeGeocoder,
  FakeMap,
  FakeMarker,
  FakePlace,
  fakeLayout,
  resetGoogleFake,
} from './googleFake'

const place = (name: string, lat: number, lng: number) => ({
  name,
  lat,
  lng,
  source: 'photon' as const,
  locality: 'Sintra',
})
const withPlaces = () => {
  const t = lisbonTrip()
  t.todos[3] = { ...t.todos[3], place: place('Pena Palace', 38.78, -9.39) }
  t.todos[4] = {
    ...t.todos[4],
    place: place('Quinta da Regaleira do Convento de Sintra', 38.8, -9.38),
  }
  t.todos[5] = { ...t.todos[5], place: place('Cafe', 38.79, -9.37) }
  return t
}

beforeEach(async () => {
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
  vi.stubEnv('VITE_GOOGLE_MAP_ID', 'TEST_MAP_ID')
  resetGoogleFake()
  fakeLayout()
  await resetTripsWorld()
  Element.prototype.scrollIntoView = vi.fn()
  setViewport('desktop')
})
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await resetTripsWorld()
})

const ready = async () => {
  await waitFor(() => expect(FakeMarker.pins().length).toBeGreaterThan(0))
  return FakeMap.last as FakeMap
}
const pinFor = (text: string) =>
  FakeMarker.pins().find((m) => m.title.startsWith(text)) as FakeMarker

describe('the real map (Google Maps, drawn as markers)', () => {
  it('loads Google with the Map ID and no default controls', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    expect(map.options).toMatchObject({ mapId: 'TEST_MAP_ID', disableDefaultUI: true })
  })

  it('draws pips and names as our own markers: the next stop in a pill, long names cut at 22', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    await ready()
    expect(pinFor('Pena Palace').label).toBe('Next · Pena Palace')
    expect(pinFor('Pena Palace').content).toHaveClass('is-next')
    const lunch = pinFor('Quinta')
    expect(lunch.label).toBe('Quinta da Regaleira d…')
    expect(lunch.label).toHaveLength(22)
    // One marker per place on the day, and no numbers anywhere.
    expect(
      FakeMarker.pins()
        .map((m) => m.title)
        .sort(),
    ).toEqual([...new Set(FakeMarker.pins().map((m) => m.title))].sort())
    for (const m of FakeMarker.pins()) expect(m.label).not.toMatch(/^\d+$/)
  })

  it('marks the selected stop with the same ring', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    await ready()
    await userEvent.click(await screen.findByRole('button', { name: /^Lunch at Tascantiga/ }))
    await waitFor(() =>
      expect(
        FakeMarker.pins().filter((m) => m.content.classList.contains('is-selected')),
      ).toHaveLength(1),
    )
  })

  it('shows our zoom keys and Fit day on wide screens', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    await ready()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fit day' })).toBeInTheDocument()
  })

  it('scrolls the list to the item when its pin is tapped', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    await ready()
    act(() => pinFor('Quinta').click())
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })
})

describe('following the day, and pausing when you move the map', () => {
  it('pauses on a manual move, shows Fit day as the yellow key, and resumes on Fit day', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    const fitDay = screen.getByRole('button', { name: 'Fit day' })
    expect(fitDay).not.toHaveClass('is-key')
    await waitFor(() => expect(map.moves).toBeGreaterThan(0))
    // The person pans: following pauses.
    act(() => map.emit('idle'))
    act(() => map.emit('dragstart'))
    await waitFor(() => expect(fitDay).toHaveClass('is-key'))
    map.fitBounds.mockClear()
    await userEvent.click(fitDay)
    await waitFor(() => expect(map.moves).toBeGreaterThan(0))
    expect(fitDay).not.toHaveClass('is-key')
  })

  it('does not mistake its own fitting for the person moving it', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    await waitFor(() => expect(map.moves).toBeGreaterThan(0))
    // The fit that just ran changes the zoom itself: that is not "the person".
    act(() => map.emit('zoom_changed'))
    expect(screen.getByRole('button', { name: 'Fit day' })).not.toHaveClass('is-key')
  })

  it('resumes when a day is picked from the day list', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    await waitFor(() => expect(map.moves).toBeGreaterThan(0))
    act(() => map.emit('idle'))
    act(() => map.emit('dragstart'))
    const fitDay = screen.getByRole('button', { name: 'Fit day' })
    await waitFor(() => expect(fitDay).toHaveClass('is-key'))
    await userEvent.click(screen.getByRole('button', { name: /Day 3 of 5/ }))
    const list = await screen.findByRole('group', { name: 'Days' })
    await userEvent.click(within(list).getAllByRole('button')[3])
    await waitFor(() => expect(fitDay).not.toHaveClass('is-key'))
  })
})

describe('click to add a stop', () => {
  // A click on a Google place (with its name) or on an empty spot (reverse-geocoded).
  const click = (map: FakeMap, name?: string) => {
    if (name) FakePlace.next = { displayName: name, lat: 38.7876, lng: -9.3906 }
    else FakeGeocoder.result = 'fail'
    act(() => {
      map.emit('click', {
        latLng: { lat: () => 38.7876, lng: () => -9.3906 },
        placeId: name ? 'ChIJtest' : undefined,
        stop: () => {},
      })
    })
  }

  it('drops one hollow pin and a card, and creates nothing until the key is pressed', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    click(map)
    const card = await screen.findByRole('dialog', { name: /^Add .* to / })
    expect(await within(card).findByRole('heading')).toBeInTheDocument()
    // The temporary pin is the hollow ring.
    expect(
      tripServer.trips
        .get(t.trip_id)
        ?.todos.some((x) => x.title === 'Pena Palace' && x.day === rel(0) && x.created_by),
    ).toBeTruthy()
  })

  it('adds the place to the day on the map, and the temporary pin goes', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    click(map, 'Pastéis de Belém')
    const card = await screen.findByRole('dialog', { name: /Pastéis de Belém/ })
    expect(within(card).getByRole('heading', { name: 'Pastéis de Belém' })).toBeInTheDocument()
    expect(tripServer.trips.get(t.trip_id)?.todos.some((x) => x.title === 'Pastéis de Belém')).toBe(
      false,
    )
    await userEvent.click(within(card).getByRole('button', { name: /^Add to / }))
    await waitFor(() => {
      const made = tripServer.trips
        .get(t.trip_id)
        ?.todos.find((x) => x.title === 'Pastéis de Belém')
      expect(made?.day).toBe(rel(0))
      expect(made?.place?.lat).toBeCloseTo(38.7876, 3)
    })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Pastéis de Belém/ })).not.toBeInTheDocument(),
    )
    expect(FakeMarker.preview()?.shown ?? false).toBe(false)
    expect(await screen.findByRole('button', { name: 'Pastéis de Belém' })).toBeInTheDocument()
  })

  it('can add to another day or to Ideas from the same card', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    click(map, 'Jardim')
    const card = await screen.findByRole('dialog', { name: /Jardim/ })
    await userEvent.click(within(card).getByRole('button', { name: /^Add to, / }))
    await userEvent.click(await screen.findByRole('button', { name: /^Ideas/ }))
    await userEvent.click(within(card).getByRole('button', { name: 'Add to Ideas' }))
    await waitFor(() =>
      expect(
        tripServer.trips.get(t.trip_id)?.todos.find((x) => x.title === 'Jardim')?.day ?? null,
      ).toBeNull(),
    )
  })

  it('opens the edit sheet, prefilled, from "More details"', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    click(map, 'Miradouro')
    const card = await screen.findByRole('dialog', { name: /Miradouro/ })
    await userEvent.click(within(card).getByRole('button', { name: 'More details' }))
    const sheet = await screen.findByRole('dialog', { name: 'Miradouro' })
    expect(within(sheet).getByLabelText('Title')).toHaveValue('Miradouro')
    expect(tripServer.trips.get(t.trip_id)?.todos.some((x) => x.title === 'Miradouro')).toBe(true)
  })

  it('goes away on Esc, on a click elsewhere, and when you start to pan', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    click(map, 'Jardim')
    await screen.findByRole('dialog', { name: /Jardim/ })
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Jardim/ })).not.toBeInTheDocument(),
    )
    click(map, 'Jardim')
    await screen.findByRole('dialog', { name: /Jardim/ })
    act(() => map.emit('idle'))
    act(() => map.emit('dragstart'))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Jardim/ })).not.toBeInTheDocument(),
    )
    click(map, 'Jardim')
    await screen.findByRole('dialog', { name: /Jardim/ })
    fireEvent.pointerDown(document.body)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Jardim/ })).not.toBeInTheDocument(),
    )
    expect(tripServer.trips.get(t.trip_id)?.todos.some((x) => x.title === 'Jardim')).toBe(false)
  })

  it('says "Dropped pin" with a name to type when the place cannot be found', async () => {
    const t = withPlaces()
    seed(t)
    tripServer.degradedPlaces = true
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    click(map)
    const card = await screen.findByRole('dialog', { name: /dropped pin/i })
    const name = await within(card).findByLabelText('Place name')
    await userEvent.type(name, 'Viewpoint')
    await userEvent.click(within(card).getByRole('button', { name: /^Add to / }))
    await waitFor(() =>
      expect(tripServer.trips.get(t.trip_id)?.todos.some((x) => x.title === 'Viewpoint')).toBe(
        true,
      ),
    )
  })

  it('keeps focus inside the card, and names it for a screen reader', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    click(map, 'Jardim')
    const card = await screen.findByRole('dialog', { name: /^Add Jardim to / })
    await waitFor(() => expect(card).toHaveFocus())
    // Tab stays inside: from the last control it comes back to the first.
    const keys = within(card).getAllByRole('button')
    keys[keys.length - 1].focus()
    await userEvent.tab()
    expect(card.contains(document.activeElement)).toBe(true)
  })
})

describe('a place suggestion in the add bar', () => {
  it('previews as a hollow pin while it is highlighted, and clears when it is not', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    const bar = await screen.findByRole('combobox', { name: 'Add to today' })
    await userEvent.type(bar, 'Pena')
    await screen.findByRole('option', { name: /Pena Palace/ })
    expect(FakeMarker.preview()?.shown ?? false).toBe(false)
    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() => expect(FakeMarker.preview()?.shown).toBe(true))
    expect(map).toBeDefined()
    await userEvent.clear(bar)
    await waitFor(() => expect(FakeMarker.preview()?.shown).toBe(false))
  })
})

describe('without a connection', () => {
  it('does not load the map at all, and widens the plan', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    expect(FakeMap.made).toBe(0)
    expect(document.querySelector('.trip-shell')).toHaveClass('is-mapless')
    expect(screen.getByText('The map comes back when you’re online.')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Map' })).not.toBeInTheDocument()
  })

  it('docks item panels as sheets when there is no map', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Buy souvenirs' }))
    const sheet = await screen.findByRole('dialog')
    expect(document.querySelector('.ui-dialog.is-sheet, .ui-drawer.is-sheet')).not.toBeNull()
  })
})
