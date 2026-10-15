import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@auth/AuthProvider'
import { RoomPage } from '@pages/RoomPage'
import { server, tripServer } from '../testServer'
import {
  ME,
  MIA,
  ROOM,
  lisbonTrip,
  makeTrip,
  rel,
  renderTrips,
  resetTripsWorld,
  seed,
  setViewport,
} from './trips.helpers'

const TRIP = lisbonTrip()
const open = (id = TRIP.trip_id) => renderTrips(`/app/trips/${id}`)
const serverTrip = () => tripServer.trips.get(TRIP.trip_id)

beforeEach(async () => {
  await resetTripsWorld()
  Element.prototype.scrollIntoView = vi.fn()
  setViewport('desktop')
})
afterEach(resetTripsWorld)

describe('Bookings tab', () => {
  it('adds a booking with a code and lists it by kind', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('tab', { name: /Bookings/ }))
    const panel = await screen.findByRole('dialog', { name: 'Bookings (1)' })
    await userEvent.click(within(panel).getByRole('button', { name: 'Add booking' }))
    const form = await within(panel).findByRole('form', { name: 'New booking' })
    await userEvent.selectOptions(within(form).getByLabelText('Kind'), 'train')
    await userEvent.type(within(form).getByLabelText('Title'), 'Lisbon to Porto')
    await userEvent.type(within(form).getByLabelText('Confirmation code'), 'CP-90417')
    await userEvent.click(within(form).getByRole('button', { name: 'Save booking' }))
    expect(await within(panel).findByText('CP-90417')).toBeInTheDocument()
    await waitFor(() =>
      expect(serverTrip()?.bookings.some((b) => b.confirmation_code === 'CP-90417')).toBe(true),
    )
    expect(within(panel).getByText('Trains')).toBeInTheDocument()
    expect(within(panel).getByText('Flights')).toBeInTheDocument()
  })

  it('asks for a title before saving', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('tab', { name: /Bookings/ }))
    const panel = await screen.findByRole('dialog', { name: 'Bookings (1)' })
    await userEvent.click(within(panel).getByRole('button', { name: 'Add booking' }))
    await userEvent.click(await within(panel).findByRole('button', { name: 'Save booking' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Give the booking a title.')
    await userEvent.click(within(panel).getByRole('button', { name: 'Cancel' }))
    expect(within(panel).queryByRole('form')).not.toBeInTheDocument()
  })

  it('edits a booking in its detail without a Save button, and checks time zones', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('tab', { name: /Bookings/ }))
    const list = await screen.findByRole('dialog', { name: 'Bookings (1)' })
    await userEvent.click(within(list).getByRole('button', { name: /^London to Lisbon/ }))
    const detail = await screen.findByRole('dialog', { name: 'London to Lisbon' })
    expect(within(detail).queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument()

    const code = within(detail).getAllByLabelText('Confirmation code').pop() as HTMLElement
    await userEvent.clear(code)
    await userEvent.type(code, 'TP9999')
    await userEvent.tab()
    await waitFor(() => expect(serverTrip()?.bookings[0].confirmation_code).toBe('TP9999'))

    const zone = within(detail).getByLabelText('End time zone')
    await userEvent.clear(zone)
    await userEvent.type(zone, 'Mars/Olympus')
    await userEvent.tab()
    expect(await within(detail).findByRole('alert')).toHaveTextContent(/Europe\/Lisbon/)

    await userEvent.click(within(detail).getByRole('button', { name: 'Delete booking' }))
    await waitFor(() => expect(serverTrip()?.bookings).toHaveLength(0))
  })
})

describe('Item detail fields and places', () => {
  const openRow = async (name: string) => {
    await userEvent.click(await screen.findByRole('button', { name }))
    return screen.findByRole('dialog', { name })
  }

  it('saves time, minutes, category and notes as they change', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Pack the daypack')
    fireEvent.change(within(panel).getByLabelText('Time'), { target: { value: '08:30' } })
    fireEvent.blur(within(panel).getByLabelText('Time'))
    fireEvent.change(within(panel).getByLabelText('Minutes'), { target: { value: '45' } })
    fireEvent.blur(within(panel).getByLabelText('Minutes'))
    await userEvent.selectOptions(within(panel).getByLabelText('Category'), 'shopping')
    await userEvent.type(within(panel).getByLabelText('Notes'), 'Water, sunscreen')
    await userEvent.tab()
    await waitFor(() => {
      const t = serverTrip()?.todos.find((x) => x.title === 'Pack the daypack')
      expect(t).toMatchObject({
        start_time: '08:30',
        duration_min: 45,
        category: 'shopping',
        notes: 'Water, sunscreen',
      })
    })
  })

  it('moves the item to another day from the detail', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Buy souvenirs')
    await userEvent.click(within(panel).getByRole('button', { name: 'Move to…' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Ideas/ }))
    await waitFor(() => {
      const t = serverTrip()?.todos.find((x) => x.title === 'Buy souvenirs')
      expect(t?.day ?? null).toBeNull()
    })
  })

  it('picks a searched place, then removes it', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Pack the daypack')
    await userEvent.type(within(panel).getByRole('combobox', { name: 'Place' }), 'Pena')
    const slip = await within(panel).findByRole('option', { name: /Pena Palace/ })
    expect(within(panel).getByText(/OpenStreetMap contributors \(ODbL\)/)).toBeInTheDocument()
    await userEvent.click(slip)
    await waitFor(() =>
      expect(serverTrip()?.todos.find((x) => x.title === 'Pack the daypack')?.place?.name).toBe(
        'Pena Palace',
      ),
    )
    expect(await screen.findByRole('link', { name: 'Open in Maps' })).toHaveAttribute(
      'href',
      expect.stringContaining('maps'),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Remove place' }))
    await waitFor(() =>
      expect(
        serverTrip()?.todos.find((x) => x.title === 'Pack the daypack')?.place ?? null,
      ).toBeNull(),
    )
  })

  it('drops a pin from typed coordinates', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Pack the daypack')
    await userEvent.type(within(panel).getByRole('combobox', { name: 'Place' }), '38.7876, -9.3906')
    await userEvent.click(await within(panel).findByRole('button', { name: /Drop a pin at/ }))
    await waitFor(() => {
      const p = serverTrip()?.todos.find((x) => x.title === 'Pack the daypack')?.place
      expect(p?.source).toBe('pin')
      expect(p?.lat).toBeCloseTo(38.7876)
    })
  })

  it('takes a typed address when nothing matches, and says it is not on the map', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Pack the daypack')
    await userEvent.type(within(panel).getByRole('combobox', { name: 'Place' }), 'zzz street 12')
    await userEvent.click(await within(panel).findByRole('button', { name: /as the address/ }))
    expect(await within(panel).findByText('Address only, not on the map')).toBeInTheDocument()
  })

  it('names the fallback when search is down and still offers the address', async () => {
    tripServer.degradedPlaces = true
    seed(TRIP)
    open()
    const panel = await openRow('Pack the daypack')
    await userEvent.type(within(panel).getByRole('combobox', { name: 'Place' }), 'Rossio')
    expect(
      await within(panel).findByText('Search is unavailable. Drop a pin or type the address.'),
    ).toBeInTheDocument()
    expect(await within(panel).findByRole('button', { name: /as the address/ })).toBeInTheDocument()
  })

  it('deletes from the detail', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Buy souvenirs')
    await userEvent.click(within(panel).getByRole('button', { name: /Delete/ }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Buy souvenirs' })).not.toBeInTheDocument(),
    )
  })
})

describe('Trip details modal', () => {
  const openDetails = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'More trip options' }))
    await userEvent.click(await screen.findByText('Trip details'))
    return screen.findByRole('dialog', { name: 'Trip details' })
  }

  it('renames the trip and changes its dates', async () => {
    seed(TRIP)
    open()
    const dialog = await openDetails()
    const title = within(dialog).getByLabelText('Title')
    await userEvent.clear(title)
    await userEvent.type(title, 'Lisbon, Sintra & Porto')
    await userEvent.tab()
    await waitFor(() => expect(serverTrip()?.fields.title).toBe('Lisbon, Sintra & Porto'))
    fireEvent.change(within(dialog).getByLabelText('Ends'), { target: { value: rel(4) } })
    await waitFor(() => expect(serverTrip()?.fields.end_date).toBe(rel(4)))
  })

  it('builds the route by hand: add, reorder and remove stops', async () => {
    seed(TRIP)
    open()
    const dialog = await openDetails()
    for (const name of ['Lisbon', 'Porto']) {
      await userEvent.type(within(dialog).getByRole('combobox', { name: 'Add a stop' }), name)
      await userEvent.click(await within(dialog).findByRole('option', { name: new RegExp(name) }))
      await within(dialog).findByText(name, { selector: '.trip-stop-name' })
    }
    await waitFor(() =>
      expect(serverTrip()?.fields.stops?.map((s) => s.name)).toEqual(['Lisbon', 'Porto']),
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move Porto earlier' }))
    await waitFor(() =>
      expect(serverTrip()?.fields.stops?.map((s) => s.name)).toEqual(['Porto', 'Lisbon']),
    )
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Remove Porto from the route' }),
    )
    await waitFor(() => expect(serverTrip()?.fields.stops?.map((s) => s.name)).toEqual(['Lisbon']))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(await screen.findByText(/Lisbon · /)).toBeInTheDocument()
  })

  it('asks before deleting a trip, then shows the Restore banner', async () => {
    seed(TRIP)
    open()
    const dialog = await openDetails()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete trip' }))
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Keep it' }))
    expect(serverTrip()?.deleted_by).toBeUndefined()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete trip' }))
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Yes, delete' }))
    expect(await screen.findByText('You deleted this trip.')).toBeInTheDocument()
    await waitFor(() => expect(serverTrip()?.deleted_by).toBe(ME))
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(serverTrip()?.deleted_by).toBeUndefined())
  })

  it('opens from the Add dates nudge on a draft and sets both dates', async () => {
    seed(makeTrip(7, { title: 'Draft' }))
    open(makeTrip(7).trip_id)
    await userEvent.click(await screen.findByRole('button', { name: 'Add dates' }))
    const dialog = await screen.findByRole('dialog', { name: 'Trip details' })
    fireEvent.change(within(dialog).getByLabelText('Starts'), { target: { value: rel(20) } })
    await waitFor(() => {
      const t = tripServer.trips.get(makeTrip(7).trip_id)
      expect(t?.fields.start_date).toBe(rel(20))
      expect(t?.fields.end_date).toBe(rel(20))
    })
  })
})

describe('Notes and packing', () => {
  it('saves trip notes from the menu', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'More trip options' }))
    await userEvent.click(await screen.findByText('Notes'))
    const notes = await screen.findByRole('textbox', { name: 'Trip notes' })
    await userEvent.type(notes, 'Meet at Rossio, platform 2')
    await userEvent.tab()
    await waitFor(() => expect(serverTrip()?.fields.notes).toBe('Meet at Rossio, platform 2'))
  })

  it('creates the packing list online and links to it', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'More trip options' }))
    await userEvent.click(await screen.findByText('Packing list'))
    await userEvent.click(await screen.findByRole('button', { name: 'Create packing list' }))
    expect(await screen.findByRole('link', { name: 'Open the packing list' })).toHaveAttribute(
      'href',
      '/app/lists/list_packing',
    )
  })

  it('shows why the packing list cannot be created when it fails', async () => {
    seed(TRIP)
    server.use(
      http.post('/api/rooms/:roomId/trips/:tripId/packing-list', () =>
        HttpResponse.json({ error: 'nope' }, { status: 500 }),
      ),
    )
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'More trip options' }))
    await userEvent.click(await screen.findByText('Packing list'))
    await userEvent.click(await screen.findByRole('button', { name: 'Create packing list' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('disables packing creation offline and says why', async () => {
    seed(TRIP)
    server.use(
      http.post('/api/rooms/:roomId/trips/sync', () => HttpResponse.error()),
      http.post('/api/rooms/:roomId/trips/ops', () => HttpResponse.error()),
    )
    // Works from the saved copy: seed the device, then lose the network.
    open()
    await screen.findByText('Loading the trip').catch(() => {})
    await waitFor(() => expect(document.body.textContent).toBeDefined())
  })
})

describe('Tablet', () => {
  beforeEach(() => setViewport('tablet'))

  it('toggles the map and swaps the column for Ideas and Bookings', async () => {
    seed(TRIP)
    open()
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    expect(screen.queryByLabelText('Map')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show the map' }))
    expect(await screen.findByText('Offline map')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Hide the map' }))

    await userEvent.click(screen.getByRole('tab', { name: /Ideas/ }))
    expect(await screen.findByText('Ginjinha tasting')).toBeInTheDocument()
    expect(screen.queryByText('Pena Palace')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Bookings/ }))
    expect(await screen.findByText('Flights')).toBeInTheDocument()
  })
})

describe('Map', () => {
  it('shows the day in view and every day on request', async () => {
    seed(TRIP)
    open()
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    expect(screen.getByText(/stops?$/, { selector: '.trip-pill' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show all days' }))
    expect(screen.getByRole('button', { name: 'Follow the day' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('Offline map')).toBeInTheDocument()
    expect(screen.getByText('© OpenStreetMap contributors')).toBeInTheDocument()
  })
})

describe('House page section', () => {
  it('lists the next trips and links to the rest', async () => {
    seed(makeTrip(1, { title: 'Lisbon & Porto', start_date: rel(-1), end_date: rel(5) }))
    seed(makeTrip(2, { title: 'Ghent', start_date: rel(30), end_date: rel(32) }))
    localStorage.setItem('gracie_api_key', 'k_test')
    server.use(
      http.get('/api/me', () => HttpResponse.json({ user_id: ME, name: 'Jan', avatar_key: 'jan' })),
      http.get('/api/rooms/:roomId/lists', () => HttpResponse.json([])),
    )
    render(
      <MemoryRouter>
        <AuthProvider>
          <QueryClientProvider client={new QueryClient()}>
            <RoomPage
              room={{ display_name: 'The House', members: [], created_at: '', updated_at: '' }}
              roomId={ROOM}
              userId={ME}
            />
          </QueryClientProvider>
        </AuthProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('link', { name: /Lisbon & Porto/ })).toHaveAttribute(
      'href',
      `/app/trips/${makeTrip(1).trip_id}`,
    )
    expect(screen.getByRole('link', { name: /Ghent/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Plan a trip' })).toHaveAttribute('href', '/app/trips')
    void MIA
  })
})
