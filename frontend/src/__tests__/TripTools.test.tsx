import { demoSource, setPlacesSource } from '../lib/trips/placesSource'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tripServer } from '../testServer'
import {
  MIA,
  lisbonTrip,
  makeTrip,
  meState,
  rel,
  renderTrips,
  resetTripsWorld,
  seed,
  setViewport,
} from './trips.helpers'

const TRIP = lisbonTrip()
const open = (id = TRIP.trip_id) => renderTrips(`/app/trips/${id}`)
const serverTrip = () => tripServer.trips.get(TRIP.trip_id)

// The seeded flight is two days old, so it sits behind "N used".
const showUsed = async () => {
  await userEvent.click(await screen.findByRole('tab', { name: 'Bookings' }))
  await userEvent.click(await screen.findByRole('button', { name: /1 used/ }))
}

beforeEach(async () => {
  await resetTripsWorld()
  Element.prototype.scrollIntoView = vi.fn()
  setViewport('desktop')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await resetTripsWorld()
})

describe('Bookings tab', () => {
  it('folds bookings that are over into one line, with a Used stamp when shown', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('tab', { name: 'Bookings' }))
    expect(screen.queryByText('Flights')).not.toBeInTheDocument()
    const fold = await screen.findByRole('button', { name: '1 used · Show' })
    expect(fold).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(fold)
    const row = (await screen.findByText('London to Lisbon')).closest('li') as HTMLElement
    expect(within(row).getByText('Used')).toBeInTheDocument()
    // A row is the trip and its day, not a button for the code.
    expect(within(row).queryByRole('button', { name: 'Show code' })).not.toBeInTheDocument()
    expect(within(row).getByText(/^\w{3} \d+ · 07:05 → 09:40$/)).toBeInTheDocument()
  })

  it('links a todo to a booking from the detail, and clears the link when the booking goes', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Lunch at Tascantiga' }))
    const panel = await screen.findByRole('dialog')
    await userEvent.selectOptions(
      within(panel).getByRole('combobox', { name: 'Linked booking' }),
      TRIP.bookings[0].booking_id,
    )
    const todo = () => serverTrip()?.todos.find((t) => t.title === 'Lunch at Tascantiga')
    await waitFor(() => expect(todo()?.booking_id).toBe(TRIP.bookings[0].booking_id))
    await userEvent.keyboard('{Escape}')
    // Deleting the booking clears the link.
    await showUsed()
    await userEvent.click(await screen.findByRole('button', { name: /^London to Lisbon/ }))
    const detail = await screen.findByRole('dialog')
    await userEvent.click(within(detail).getByRole('button', { name: 'Delete booking' }))
    await waitFor(() => expect(todo()?.booking_id ?? null).toBeNull())
  })
})

describe('Item sheet fields and places', () => {
  const openRow = async (name: string) => {
    await userEvent.click(await screen.findByRole('button', { name }))
    return screen.findByRole('dialog')
  }
  const todo = (title: string) => serverTrip()?.todos.find((x) => x.title === title)

  it('saves time, length, category and notes as they change, in place on a desk', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Pack the daypack')
    // Length only appears once there is a time.
    expect(within(panel).queryByRole('group', { name: 'Length' })).not.toBeInTheDocument()
    await userEvent.type(within(panel).getByLabelText('Time'), '08:30{Enter}')
    await userEvent.click(
      within(within(panel).getByRole('group', { name: 'Length' })).getByRole('button', {
        name: '1 h',
      }),
    )
    await userEvent.click(
      within(within(panel).getByRole('group', { name: 'Category' })).getByRole('button', {
        name: 'Shopping',
      }),
    )
    await userEvent.type(within(panel).getByLabelText('Notes'), 'Water, sunscreen')
    await userEvent.tab()
    await waitFor(() => {
      expect(todo('Pack the daypack')).toMatchObject({
        start_time: '08:30',
        duration_min: 60,
        category: 'shopping',
        notes: 'Water, sunscreen',
      })
    })
  })

  it('shows only the locality when the place is named like the item', async () => {
    const t = lisbonTrip()
    t.todos[4] = {
      ...t.todos[4],
      title: 'Quinta da Regaleira',
      place: {
        name: 'Quinta da Regaleira',
        locality: 'Sintra',
        lat: 38.79,
        lng: -9.39,
        source: 'pin',
      },
    }
    seed(t)
    open()
    const panel = await openRow('Quinta da Regaleira')
    const place = within(panel).getByText('Sintra')
    expect(place).toBeInTheDocument()
    expect(within(panel).queryByText(/Regaleira · Sintra/)).not.toBeInTheDocument()
  })

  it('picks day, time and length in one When picker (24-hour times, no native inputs)', async () => {
    // The picker sheets are the phone's editor; a desk edits in place.
    setViewport('phone')
    seed(TRIP)
    open()
    const panel = await openRow('Lunch at Tascantiga')
    await userEvent.click(within(panel).getByRole('button', { name: /^When / }))
    const times = await screen.findByRole('group', { name: 'Time options' })
    expect(within(times).getByRole('button', { name: '12:30' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(times).queryByText(/[ap]m/i)).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Length options' })).toBeInTheDocument()
    expect(document.querySelector('select, input[type="time"]')).toBeNull()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Time options' })).toBeNull())
    // Esc closed only the picker; the sheet is still there.
    expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0)
  })

  it('offers a custom length', async () => {
    // The picker sheets are the phone's editor; a desk edits in place.
    setViewport('phone')
    seed(TRIP)
    open()
    const panel = await openRow('Lunch at Tascantiga')
    await userEvent.click(within(panel).getByRole('button', { name: /^When / }))
    await userEvent.click(await screen.findByRole('button', { name: 'Custom' }))
    const minutes = await screen.findByLabelText('Duration in minutes')
    await userEvent.type(minutes, '45{Enter}')
    await waitFor(() => expect(todo('Lunch at Tascantiga')?.duration_min).toBe(45))
  })

  it('moves the item to another day, or to Ideas, from the When picker', async () => {
    // The picker sheets are the phone's editor; a desk edits in place.
    setViewport('phone')
    seed(TRIP)
    open()
    const panel = await openRow('Buy souvenirs')
    await userEvent.click(within(panel).getByRole('button', { name: /^When / }))
    await userEvent.click(await screen.findByRole('button', { name: /^Ideas/ }))
    await waitFor(() => expect(todo('Buy souvenirs')?.day ?? null).toBeNull())
  })

  it('picks a searched place in a sub-view, then removes it', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Pack the daypack')
    await userEvent.click(within(panel).getByRole('button', { name: /^Place Add a place/ }))
    await userEvent.type(await screen.findByRole('combobox', { name: 'Place' }), 'Pena')
    const slip = await screen.findByRole('option', { name: /Pena Palace/ })
    expect(screen.getByText(/OpenStreetMap contributors \(ODbL\)/)).toBeInTheDocument()
    await userEvent.click(slip)
    await waitFor(() => expect(todo('Pack the daypack')?.place?.name).toBe('Pena Palace'))
    // Back on the sheet: the place shows as a row, and Open Maps appears.
    expect(await within(panel).findByRole('link', { name: 'Open Maps' })).toHaveAttribute(
      'href',
      expect.stringContaining('maps'),
    )
    await userEvent.click(within(panel).getByRole('button', { name: /^Place Pena Palace/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove place' }))
    await waitFor(() => expect(todo('Pack the daypack')?.place ?? null).toBeNull())
  })

  it('drops a pin from typed coordinates', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Pack the daypack')
    await userEvent.click(within(panel).getByRole('button', { name: /^Place Add a place/ }))
    await userEvent.type(await screen.findByRole('combobox', { name: 'Place' }), '38.7876, -9.3906')
    await userEvent.click(await screen.findByRole('button', { name: /Drop a pin at/ }))
    await waitFor(() => {
      const p = todo('Pack the daypack')?.place
      expect(p?.source).toBe('pin')
      expect(p?.lat).toBeCloseTo(38.7876)
    })
  })

  it('takes a typed address when nothing matches, and says it is not on the map', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Pack the daypack')
    await userEvent.click(within(panel).getByRole('button', { name: /^Place Add a place/ }))
    await userEvent.type(await screen.findByRole('combobox', { name: 'Place' }), 'zzz street 12')
    await userEvent.click(await screen.findByRole('button', { name: /as the address/ }))
    await waitFor(() => expect(todo('Pack the daypack')?.place?.source).toBe('manual'))
  })

  it('names the fallback when search is down and still offers the address', async () => {
    setPlacesSource({
      ...demoSource,
      suggest: async () => {
        throw new Error('search is down')
      },
    })
    seed(TRIP)
    open()
    const panel = await openRow('Pack the daypack')
    await userEvent.click(within(panel).getByRole('button', { name: /^Place Add a place/ }))
    await userEvent.type(await screen.findByRole('combobox', { name: 'Place' }), 'Rossio')
    expect(
      await screen.findByText('Search is unavailable. Type the address instead.'),
    ).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /as the address/ })).toBeInTheDocument()
  })

  it('shows the linked booking as a row, with its code behind the same slip', async () => {
    // The picker sheets are the phone's editor; a desk edits in place.
    setViewport('phone')
    const t = lisbonTrip()
    t.todos[4] = { ...t.todos[4], booking_id: t.bookings[0].booking_id }
    seed(t)
    open()
    const panel = await openRow('Lunch at Tascantiga')
    expect(within(panel).getByRole('button', { name: /London to Lisbon/ })).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Show code' }))
    expect(
      await screen.findByLabelText(/Confirmation code for London to Lisbon/),
    ).toBeInTheDocument()
  })
})

describe('Notes and packing from the menu', () => {
  it('saves trip notes', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'More trip options' }))
    await userEvent.click(await screen.findByText('Notes'))
    const notes = await screen.findByRole('textbox', { name: 'Trip notes' })
    await userEvent.type(notes, 'Meet at Rossio, platform 2')
    await userEvent.tab()
    await waitFor(() => expect(serverTrip()?.fields.notes).toBe('Meet at Rossio, platform 2'))
  })

  const packList = {
    list_id: 'list_packing',
    room_id: 'room_1',
    name: 'Packing',
    is_deleted: false,
  }
  const menu = async () =>
    userEvent.click(await screen.findByRole('button', { name: 'More trip options' }))

  it('carries the packing state in the menu and goes straight to the list', async () => {
    meState.lists = [packList]
    meState.items = [
      { item_id: 'a', completed: true },
      { item_id: 'b', completed: false },
      { item_id: 'c', completed: false },
    ]
    seed({ ...TRIP, packing_list_id: 'list_packing' })
    open()
    await menu()
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Packing list · 1 of 3 packed' }),
    )
    // No sheet in between: the List page, told where we came from.
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/app/lists/list_packing'),
    )
    expect(JSON.parse(screen.getByTestId('arrival').textContent ?? '{}')).toEqual({
      from: `trip:${TRIP.trip_id}`,
      fromLabel: 'Lisbon & Porto',
    })
  })

  it('makes the list when there is none, then goes to it', async () => {
    seed(TRIP)
    open()
    await menu()
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Make a packing list' }))
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/app/lists/list_packing'),
    )
    await waitFor(() => expect(serverTrip()?.fields.packing_list_id).toBe('list_packing'))
    expect(screen.queryByRole('button', { name: 'Create packing list' })).not.toBeInTheDocument()
  })

  it('is disabled offline, with a reason', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    seed(TRIP)
    open()
    await menu()
    const item = await screen.findByRole('menuitem', { name: 'Connect to make one' })
    expect(item).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('Packing line before the trip', () => {
  const list = { list_id: 'list_packing', room_id: 'room_1', name: 'Packing', is_deleted: false }
  const trip = (startIn: number) => ({
    ...makeTrip(9, {
      title: 'Ghent',
      start_date: rel(startIn),
      end_date: rel(startIn + 2),
      packing_list_id: 'list_packing',
    }),
  })
  const items = (n: number, packed: number) =>
    Array.from({ length: n }, (_, i) => ({ item_id: `i${i}`, completed: i < packed }))

  it('shows one quiet line within three days of leaving, and goes to the list', async () => {
    meState.lists = [list]
    meState.items = items(12, 4)
    setViewport('phone')
    seed(trip(2))
    renderTrips(`/app/trips/${trip(2).trip_id}`)
    const line = await screen.findByRole('button', { name: /Packing · 4 of 12 packed/ })
    await userEvent.click(line)
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/app/lists/list_packing'),
    )
  })

  it('stays away when it is early, when all is packed, and once the trip has started', async () => {
    meState.lists = [list]
    meState.items = items(12, 4)
    seed(trip(5))
    renderTrips(`/app/trips/${trip(5).trip_id}`)
    await screen.findByRole('heading', { name: 'Ghent' })
    expect(screen.queryByRole('button', { name: /Packing ·/ })).not.toBeInTheDocument()
  })

  it('is hidden when everything is packed', async () => {
    meState.lists = [list]
    meState.items = items(3, 3)
    seed(trip(1))
    renderTrips(`/app/trips/${trip(1).trip_id}`)
    await screen.findByRole('heading', { name: 'Ghent' })
    await waitFor(() => expect(meState.items).toHaveLength(3))
    expect(screen.queryByRole('button', { name: /Packing ·/ })).not.toBeInTheDocument()
  })

  it('is hidden once the trip has started', async () => {
    meState.lists = [list]
    meState.items = items(12, 4)
    const started = { ...trip(0), start_date: rel(-1), end_date: rel(2) }
    seed(started)
    renderTrips(`/app/trips/${started.trip_id}`)
    await screen.findByRole('heading', { name: 'Ghent' })
    expect(screen.queryByRole('button', { name: /Packing ·/ })).not.toBeInTheDocument()
  })
})

describe('Map', () => {
  it('shows the day in view and every day on request', async () => {
    const t = lisbonTrip()
    t.todos[4] = {
      ...t.todos[4],
      place: { name: 'Tasca', lat: 38.78, lng: -9.39, source: 'pin' },
    }
    seed(t)
    open()
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    await userEvent.click(screen.getByRole('button', { name: 'Show all days' }))
    expect(screen.getByRole('button', { name: 'Follow the day' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('Map preview')).toBeInTheDocument()
    // The preview has no map data on it, so no map credit.
    expect(screen.queryByText(/OpenStreetMap/)).not.toBeInTheDocument()
  })

  it('hides the map when there is no connection, and says when it returns', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    seed(TRIP)
    open()
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    expect(screen.queryByText('Map preview')).not.toBeInTheDocument()
    expect(document.querySelector('.trip-map')).toBeNull()
    expect(screen.getByText('The map comes back when you’re online.')).toBeInTheDocument()
  })

  it('lifts the next stop on the map with a ring', async () => {
    const t = lisbonTrip()
    // Pena (10:15) leads the deck; give it and the lunch a place.
    t.todos[3] = {
      ...t.todos[3],
      place: { name: 'Pena', lat: 38.78, lng: -9.39, source: 'pin' },
    }
    t.todos[4] = {
      ...t.todos[4],
      place: { name: 'Tasca', lat: 38.8, lng: -9.38, source: 'pin' },
    }
    seed(t)
    open()
    await screen.findByRole('region', { name: 'Next stop' })
    // The desk map holds every day (the day in view is in colour, the others dimmed), so more than
    // the two stops of today are drawn.
    await waitFor(() =>
      expect(document.querySelectorAll('.map-pin').length).toBeGreaterThanOrEqual(2),
    )
    expect(document.querySelectorAll('.map-pin-ring')).toHaveLength(1)
    // No numbers anywhere on the pins.
    expect(document.querySelectorAll('.map-pin text')).toHaveLength(0)
  })

  it('keeps Ideas in a column beside the days on desktops, not a tab or a drawer', async () => {
    seed(TRIP)
    open()
    await screen.findByRole('heading', { name: 'Later today' })
    expect(screen.queryByRole('tab', { name: 'Ideas' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Plan', 'Bookings'])
    const column = document.querySelector('.trip-ideas-col') as HTMLElement
    expect(within(column).getByText('Ginjinha tasting')).toBeInTheDocument()
    expect(within(column).getByText('Drag onto a day')).toBeInTheDocument()
    // No add field of its own: the one add bar under the days has Ideas in its target chip.
    expect(within(column).queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getAllByPlaceholderText(/^Add (a|an|to) /)).toHaveLength(1)
    // The days are right there to drop an idea on.
    expect(screen.getByRole('heading', { name: 'Later today' })).toBeInTheDocument()
  })
})
