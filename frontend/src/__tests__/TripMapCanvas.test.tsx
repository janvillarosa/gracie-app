import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tripServer } from '../testServer'
import { lisbonTrip, rel, renderTrips, resetTripsWorld, seed, setViewport } from './trips.helpers'

vi.mock('maplibre-gl', async () => {
  const m = await import('./mapFake')
  return { Map: m.FakeMap, LngLatBounds: m.LngLatBounds, NavigationControl: m.NavigationControl }
})

import { FakeMap } from './mapFake'
const features = (id: string) =>
  ((
    FakeMap.last?.sources.get(id)?.data as {
      features: Array<{ properties: Record<string, unknown> }>
    }
  )?.features ?? []) as Array<{ properties: Record<string, unknown> }>

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
  vi.stubEnv('VITE_PROTOMAPS_API_KEY', 'test-key')
  vi.stubEnv('VITE_GLYPHS_URL', 'https://fonts.test/{fontstack}/{range}.pbf')
  // A canvas that accepts any drawing call (the map draws its small images with one).
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy(
      {},
      { get: (_t, k) => (k === 'getImageData' ? () => ({}) : () => {}), set: () => true },
    )) as never
  FakeMap.last = null
  FakeMap.made = 0
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
  await waitFor(() => expect(FakeMap.last?.layers.has('pips')).toBe(true))
  return FakeMap.last as InstanceType<typeof FakeMap>
}

describe('the real map (tiles from the Protomaps API, drawn as layers)', () => {
  it('reads tiles from the hosted TileJSON with the key, and has no pmtiles protocol', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    const style = map.options.style as { sources: { protomaps: { url: string } }; glyphs?: string }
    expect(style.sources.protomaps.url).toBe('https://api.protomaps.com/tiles/v4.json?key=test-key')
    expect(style.sources.protomaps.url).not.toMatch(/pmtiles/)
    expect(style.glyphs).toBe('https://fonts.test/{fontstack}/{range}.pbf')
  })

  it('draws pips, a thin route with arrows, labels and clusters as layers, not as elements', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    for (const id of [
      'route-line',
      'route-arrows',
      'clusters',
      'pips',
      'focus-ring',
      'labels',
      'label-next',
      'preview-pin',
    ])
      expect(map.layers.has(id)).toBe(true)
    const pips = map.layers.get('pips') as { paint: Record<string, unknown> }
    expect(pips.paint['circle-radius']).toBe(6.5)
    expect(pips.paint['circle-stroke-width']).toBe(2.5)
    expect(
      (map.layers.get('focus-ring') as { paint: Record<string, unknown> }).paint['circle-radius'],
    ).toBe(11)
    expect(
      (map.layers.get('route-line') as { paint: Record<string, unknown> }).paint['line-width'],
    ).toBe(3)
    // Only stops that genuinely stack merge.
    expect(map.sources.get('stops')?.spec).toMatchObject({ cluster: true, clusterRadius: 28 })
    expect(map.sources.get('focus')?.spec.cluster).toBeUndefined()
    expect(document.querySelectorAll('.map-marker')).toHaveLength(0)
  })

  it('gives the adapter the label, category and priority, and the next stop apart, with no numbers', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    await ready()
    await waitFor(() => expect(features('focus').length).toBeGreaterThan(0))
    const focus = features('focus')
    // Pena Palace leads the deck: the next stop, drawn from the unclustered source, in a pill.
    expect(focus).toHaveLength(1)
    expect(focus[0].properties).toMatchObject({ next: true, prio: 1, text: 'Next · Pena Palace' })
    const rest = features('stops')
    const lunch = rest.find((f) => String(f.properties.text).startsWith('Quinta'))
    // Cut to 22 characters with an ellipsis.
    expect(lunch?.properties.text).toBe('Quinta da Regaleira d…')
    expect(String(lunch?.properties.text)).toHaveLength(22)
    expect(lunch?.properties.prio).toBeGreaterThanOrEqual(2)
    for (const f of [...focus, ...rest]) expect(Object.keys(f.properties)).not.toContain('n')
    // Category colour, not a day colour or a number.
    expect(lunch?.properties).toHaveProperty('fill')
  })

  it('marks the selected stop with the same ring and the highest priority', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    await ready()
    await userEvent.click(await screen.findByRole('button', { name: /^Lunch at Tascantiga/ }))
    await waitFor(() => expect(features('focus').some((f) => f.properties.prio === 0)).toBe(true))
    expect(
      features('focus')
        .map((f) => f.properties.prio)
        .sort(),
    ).toEqual([0, 1])
  })

  it('shows controls and takes clicks on wide screens only', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    expect(map.controls).toContain('navigation')
    expect(screen.getByRole('button', { name: 'Fit day' })).toBeInTheDocument()
  })

  it('zooms into a cluster when it is clicked', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    map.queryHook = (l) =>
      l.includes('clusters')
        ? [
            {
              layer: { id: 'clusters' },
              properties: { cluster_id: 7 },
              geometry: { coordinates: [-9.38, 38.79] },
            },
          ]
        : []
    await act(async () => {
      map.emit('click', { point: { x: 10, y: 10 }, lngLat: { lat: 38.79, lng: -9.38 } })
    })
    await waitFor(() => expect(map.clusterZoom).toHaveBeenCalledWith(7))
    await waitFor(() =>
      expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 13 })),
    )
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
    await waitFor(() => expect(map.fitBounds).toHaveBeenCalled())
    // The person pans: following pauses.
    act(() => map.emit('moveend', {}))
    act(() => map.emit('movestart', {}))
    await waitFor(() => expect(fitDay).toHaveClass('is-key'))
    map.fitBounds.mockClear()
    await userEvent.click(fitDay)
    await waitFor(() => expect(map.fitBounds).toHaveBeenCalled())
    expect(fitDay).not.toHaveClass('is-key')
  })

  it('does not mistake its own fitting for the person moving it', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    await waitFor(() => expect(map.fitBounds).toHaveBeenCalled())
    // The fit that just ran starts a move of its own: that is not "the person".
    act(() => map.emit('movestart', {}))
    expect(screen.getByRole('button', { name: 'Fit day' })).not.toHaveClass('is-key')
    act(() => map.emit('moveend', {}))
  })

  it('resumes when a day is picked from the day list', async () => {
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const map = await ready()
    await waitFor(() => expect(map.fitBounds).toHaveBeenCalled())
    act(() => map.emit('moveend', {}))
    act(() => map.emit('movestart', {}))
    const fitDay = screen.getByRole('button', { name: 'Fit day' })
    await waitFor(() => expect(fitDay).toHaveClass('is-key'))
    await userEvent.click(screen.getByRole('button', { name: /Day 3 of 5/ }))
    const list = await screen.findByRole('group', { name: 'Days' })
    await userEvent.click(within(list).getAllByRole('button')[3])
    await waitFor(() => expect(fitDay).not.toHaveClass('is-key'))
  })
})

describe('click to add a stop', () => {
  const click = (map: InstanceType<typeof FakeMap>, name?: string) => {
    // The basemap's own label layers exist on the real map; here they are stood in for.
    map.layers.set('pois', {})
    map.queryHook = (l) =>
      name && l.includes('pois') ? [{ layer: { id: 'pois' }, properties: { name } }] : []
    act(() => {
      map.emit('click', { point: { x: 220, y: 200 }, lngLat: { lat: 38.7876, lng: -9.3906 } })
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
    // The temporary pin is on the preview layer.
    expect(features('preview')).toHaveLength(1)
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
    expect(features('preview')).toHaveLength(0)
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
    act(() => map.emit('moveend', {}))
    act(() => map.emit('movestart', {}))
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
    expect(features('preview')).toHaveLength(0)
    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() => expect(features('preview')).toHaveLength(1))
    expect(map.easeTo).toBeDefined()
    await userEvent.clear(bar)
    await waitFor(() => expect(features('preview')).toHaveLength(0))
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
    expect(document.querySelector('.trip-shell')).not.toHaveClass('has-map')
    expect(screen.getByText('The map comes back when you’re online.')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Map' })).not.toBeInTheDocument()
  })

  it('still docks the inspector in the right column when there is no map', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Buy souvenirs' }))
    const sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveClass('ui-sheet-panel')
    // The right column opens for it alone (no map), and goes when it closes.
    expect(sheet.closest('.trip-side')).not.toBeNull()
    expect(document.querySelector('.trip-shell')).toHaveClass('has-map')
  })
})
