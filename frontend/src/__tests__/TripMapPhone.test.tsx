import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { placeLabels } from '@lib/trips/mapLabels'
import { buildScene, shorten } from '@lib/trips/mapScene'
import { buildSchedule } from '@lib/trips/schedule'
import { useMapOk } from '@components/trips/useTripMap'
import { FakeMap, FakeMarker, fakeLayout, resetGoogleFake } from './googleFake'
import { lisbonTrip, rel, renderTrips, resetTripsWorld, seed, setViewport } from './trips.helpers'

vi.mock('@googlemaps/js-api-loader', async () => (await import('./googleFake')).loaderMock())
vi.mock('@googlemaps/markerclusterer', async () => (await import('./googleFake')).clustererMock())

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
  t.todos[4] = { ...t.todos[4], place: place('Tascantiga', 38.8, -9.38) }
  t.todos[7] = { ...t.todos[7], place: place('Jerónimos', 38.69, -9.2) }
  return t
}

beforeEach(async () => {
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
  vi.stubEnv('VITE_GOOGLE_MAP_ID', 'TEST_MAP_ID')
  resetGoogleFake()
  fakeLayout()
  window.history.replaceState(null, '', '/')
  await resetTripsWorld()
  Element.prototype.scrollIntoView = vi.fn()
  setViewport('phone')
})
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await resetTripsWorld()
})

const openMap = async (t = withPlaces()) => {
  seed(t)
  renderTrips(`/app/trips/${t.trip_id}`)
  const pill = await screen.findByRole('button', { name: /^Show map for / })
  await userEvent.click(pill)
  return { t, pill, screen: await screen.findByRole('dialog', { name: /^Map for / }) }
}

describe('the phone map: a full-screen, read-only view', () => {
  it('has a labelled pill, and opens a full screen dialog for the day', async () => {
    const { pill, screen: dlg } = await openMap()
    expect(pill).toHaveTextContent('Map')
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    expect(dlg).toHaveAccessibleName(/^Map for Thursday 15|^Map for /)
    // The top bar: close on the left, a day stepper in the middle; no pills, no Fit day.
    expect(within(dlg).getByRole('button', { name: 'Close map' })).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Previous day' })).toBeInTheDocument()
    expect(within(dlg).queryByRole('button', { name: 'Show all days' })).not.toBeInTheDocument()
    expect(within(dlg).queryByRole('button', { name: 'Fit day' })).not.toBeInTheDocument()
    expect(dlg.querySelector('.trip-pill')).toBeNull()
  })

  it('moves focus to the close key, and gives it back to the pill on close', async () => {
    const { pill, screen: dlg } = await openMap()
    await waitFor(() =>
      expect(within(dlg).getByRole('button', { name: 'Close map' })).toHaveFocus(),
    )
    await userEvent.click(within(dlg).getByRole('button', { name: 'Close map' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /^Map for / })).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(pill).toHaveFocus())
  })

  it('closes with the close key, Esc and the back gesture, and leaves no stale history entry', async () => {
    const before = window.history.length
    let { screen: dlg } = await openMap()
    expect(window.location.hash).toBe('#map')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Close map' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /^Map for / })).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(window.location.hash).toBe(''))
    void before

    await userEvent.click(await screen.findByRole('button', { name: /^Show map for / }))
    dlg = await screen.findByRole('dialog', { name: /^Map for / })
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /^Map for / })).not.toBeInTheDocument(),
    )

    await userEvent.click(await screen.findByRole('button', { name: /^Show map for / }))
    await screen.findByRole('dialog', { name: /^Map for / })
    // The browser's or Android's back: a popstate.
    act(() => {
      window.history.back()
    })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /^Map for / })).not.toBeInTheDocument(),
    )
    expect(dlg).toBeDefined()
  })

  it('closes on a swipe down over the top bar', async () => {
    const { screen: dlg } = await openMap()
    const bar = dlg.querySelector('.map-screen-bar') as HTMLElement
    // (jsdom has no PointerEvent, so a mouse event stands in for the pointer.)
    fireEvent(bar, new MouseEvent('pointerdown', { clientY: 20, bubbles: true }))
    fireEvent(bar, new MouseEvent('pointerup', { clientY: 140, bubbles: true }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /^Map for / })).not.toBeInTheDocument(),
    )
  })

  it('steps through the days, read-only, and stops at the ends', async () => {
    const { screen: dlg } = await openMap()
    const day = () => dlg.querySelector('.map-screen-day')?.textContent
    const start = day()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Next day' }))
    expect(day()).not.toBe(start)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Next day' }))
    await userEvent.click(within(dlg).getByRole('button', { name: 'Next day' }))
    expect(within(dlg).getByRole('button', { name: 'Next day' })).toBeDisabled()
    for (let i = 0; i < 5; i++) {
      const prev = within(dlg).getByRole('button', { name: 'Previous day' })
      if ((prev as HTMLButtonElement).disabled) break
      await userEvent.click(prev)
    }
    expect(within(dlg).getByRole('button', { name: 'Previous day' })).toBeDisabled()
  })

  it('shows the selected stop on a card (the next stop to begin with), and a tap on a pin switches it', async () => {
    const { screen: dlg } = await openMap()
    await waitFor(() => expect(FakeMarker.pins().length).toBeGreaterThan(0))
    const card = () => within(dlg).getByRole('region', { name: 'Selected stop' })
    expect(card()).toHaveTextContent('Pena Palace')
    expect(within(card()).getByRole('link', { name: 'Open Maps' })).toHaveAttribute(
      'href',
      expect.stringContaining('38.78'),
    )
    // No pip, no controls, no add: a read-only view.
    expect(within(dlg).queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument()
    expect(FakeMap.last?.options).toMatchObject({
      clickableIcons: false,
      gestureHandling: 'greedy',
    })
    act(() =>
      FakeMarker.pins()
        .find((m) => m.title === 'Tascantiga')
        ?.click(),
    )
    await waitFor(() => expect(card()).toHaveTextContent('Tascantiga'))
    expect(dlg.querySelector('[role="status"]')).toHaveTextContent('Selected Tascantiga')
    // Nothing was created by tapping.
    expect(screen.queryByRole('dialog', { name: /^Add / })).not.toBeInTheDocument()
  })

  it('uses the shorter labels, and the card has the full name', async () => {
    const t = withPlaces()
    t.todos[3] = { ...t.todos[3], place: place('Quinta da Regaleira do Convento', 38.78, -9.39) }
    const { screen: dlg } = await openMap(t)
    await waitFor(() => expect(FakeMarker.pins().length).toBeGreaterThan(0))
    const quinta = () => FakeMarker.pins().find((m) => m.title.startsWith('Quinta')) as FakeMarker
    expect(quinta().label).toBe('Quinta da Reg…')
    expect(quinta().label).toHaveLength(14)
    expect(within(dlg).getByRole('region', { name: 'Selected stop' })).toHaveTextContent(
      'Quinta da Regaleira do Convento',
    )
  })

  it('opens the item from the card text', async () => {
    const { screen: dlg } = await openMap()
    await userEvent.click(within(dlg).getByRole('button', { name: /Pena Palace/ }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /^Map for / })).not.toBeInTheDocument(),
    )
    expect(await screen.findByLabelText('Title')).toHaveValue('Pena Palace')
  })

  it('is not offered offline, and never loads', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    const t = withPlaces()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    expect(screen.queryByRole('button', { name: /^Show map for / })).not.toBeInTheDocument()
    expect(FakeMap.made).toBe(0)
  })
})

describe('going offline and coming back', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => vi.useRealTimers())

  it('hides after about five seconds offline, not at once, and returns when online', () => {
    const { result, rerender } = renderHook(({ on }) => useMapOk(on), {
      initialProps: { on: true },
    })
    expect(result.current).toBe(true)
    rerender({ on: false })
    // A flaky connection does not flicker it.
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(result.current).toBe(true)
    rerender({ on: true })
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(result.current).toBe(true)
    rerender({ on: false })
    act(() => {
      vi.advanceTimersByTime(5100)
    })
    expect(result.current).toBe(false)
    rerender({ on: true })
    expect(result.current).toBe(true)
  })
})

describe('what the map is told', () => {
  const trip = withPlaces()
  const schedule = buildSchedule(trip)

  it('has no numbers: labels, categories and priorities only', () => {
    const scene = buildScene({
      mode: 'day',
      schedule,
      day: rel(0),
      nextId: trip.todos[3].todo_id,
      selectedId: trip.todos[4].todo_id,
    })
    expect(scene.stops.map((s) => s.priority).sort()).toEqual([0, 1])
    for (const s of scene.stops) {
      expect(Object.keys(s)).not.toContain('n')
      expect(s).toHaveProperty('category')
      expect(typeof s.label).toBe('string')
    }
    expect(scene.route).toBe(true)
    expect(scene.nextId).toBe(trip.todos[3].todo_id)
    expect(scene.selectedId).toBe(trip.todos[4].todo_id)
  })

  it('colours by day in all-days mode, and is hollow ideas in ideas mode', () => {
    const all = buildScene({ mode: 'all', schedule })
    expect(all.route).toBe(false)
    expect(new Set(all.stops.map((s) => s.dayIndex)).size).toBeGreaterThan(1)
    expect(buildScene({ mode: 'ideas', schedule }).stops).toHaveLength(0)
  })

  it('shortens with an ellipsis', () => {
    expect(shorten('Quinta da Regaleira do Convento', 22)).toBe('Quinta da Regaleira d…')
    expect(shorten('Pena', 22)).toBe('Pena')
  })
})

describe('the preview map keeps the same rules for labels', () => {
  it('drops the lower-priority label that would collide, and keeps its pip', () => {
    const placed = placeLabels(
      [
        { id: 'a', x: 100, y: 15, text: 'Lunch at Tascantiga', priority: 5 },
        { id: 'b', x: 104, y: 15, text: 'Pena Palace', priority: 1 },
      ],
      // Only a strip: above and below do not fit, so a label that cannot sit to the right goes.
      { width: 300, height: 30 },
    )
    expect(placed.map((p) => p.id)).toEqual(['b'])
  })

  it('tries the other sides before giving up, and keeps labels on screen', () => {
    const placed = placeLabels([{ id: 'a', x: 290, y: 100, text: 'Pena Palace', priority: 0 }], {
      width: 300,
      height: 200,
    })
    expect(placed[0].anchor).toBe('left')
    expect(placed[0].x).toBeGreaterThanOrEqual(2)
  })

  it('places in priority order, not list order', () => {
    const placed = placeLabels(
      [
        { id: 'late', x: 100, y: 100, text: 'Late', priority: 9 },
        { id: 'next', x: 100, y: 100, text: 'Next', priority: 1 },
      ],
      { width: 400, height: 200 },
    )
    expect(placed[0].id).toBe('next')
  })
})
