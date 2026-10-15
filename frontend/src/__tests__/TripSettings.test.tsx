import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server, tripServer } from '../testServer'
import {
  ME,
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
const settings = (id = TRIP.trip_id) => renderTrips(`/app/trips/${id}/settings`)
const serverTrip = () => tripServer.trips.get(TRIP.trip_id)

beforeEach(async () => {
  await resetTripsWorld()
  Element.prototype.scrollIntoView = vi.fn()
  setViewport('desktop')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await resetTripsWorld()
})

describe('Trip settings page', () => {
  it('opens from the trip menu as a full page with two sections', async () => {
    seed(TRIP)
    renderTrips(`/app/trips/${TRIP.trip_id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'More trip options' }))
    await userEvent.click(await screen.findByText('Trip settings'))
    expect(await screen.findByRole('heading', { name: 'Trip settings' })).toBeInTheDocument()
    expect(screen.getByTestId('where').textContent).toBe(`/app/trips/${TRIP.trip_id}/settings`)
    expect(screen.getByRole('heading', { name: 'This trip' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Just for you' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'Lisbon & Porto' })).toBeInTheDocument()
  })

  it('renames the trip and changes its dates through the outbox', async () => {
    seed(TRIP)
    settings()
    const title = await screen.findByLabelText('Title')
    await userEvent.clear(title)
    await userEvent.type(title, 'Lisbon, Sintra & Porto')
    await userEvent.tab()
    await waitFor(() => expect(serverTrip()?.fields.title).toBe('Lisbon, Sintra & Porto'))
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: rel(4) } })
    await waitFor(() => expect(serverTrip()?.fields.end_date).toBe(rel(4)))
  })

  it('picks an icon for the trip', async () => {
    seed(TRIP)
    settings()
    await userEvent.click(await screen.findByRole('button', { name: '✈️' }))
    await waitFor(() => expect(serverTrip()?.fields.icon).toBe('PLANE'))
  })

  it('builds the route by hand: add, reorder and remove stops', async () => {
    seed(TRIP)
    settings()
    for (const name of ['Lisbon', 'Porto']) {
      await userEvent.type(await screen.findByRole('combobox', { name: 'Add a stop' }), name)
      await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }))
      await screen.findByText(name, { selector: '.trip-stop-name' })
    }
    await waitFor(() =>
      expect(serverTrip()?.fields.stops?.map((s) => s.name)).toEqual(['Lisbon', 'Porto']),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Move Porto earlier' }))
    await waitFor(() =>
      expect(serverTrip()?.fields.stops?.map((s) => s.name)).toEqual(['Porto', 'Lisbon']),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Remove Porto from the route' }))
    await waitFor(() => expect(serverTrip()?.fields.stops?.map((s) => s.name)).toEqual(['Lisbon']))
  })

  it('says there are no dates yet, and sets both when one is chosen', async () => {
    seed(makeTrip(7, { title: 'Draft' }))
    settings(makeTrip(7).trip_id)
    expect(await screen.findByText(/No dates yet/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: rel(20) } })
    await waitFor(() => {
      const t = tripServer.trips.get(makeTrip(7).trip_id)
      expect(t?.fields.start_date).toBe(rel(20))
      expect(t?.fields.end_date).toBe(rel(20))
    })
  })

  it('creates the packing list online and links to it', async () => {
    seed(TRIP)
    settings()
    await userEvent.click(await screen.findByRole('button', { name: 'Create packing list' }))
    expect(await screen.findByRole('link', { name: 'Open the packing list' })).toHaveAttribute(
      'href',
      '/app/lists/list_packing',
    )
  })

  it('says why the packing list could not be made', async () => {
    seed(TRIP)
    server.use(
      http.post('/api/rooms/:roomId/trips/:tripId/packing-list', () =>
        HttpResponse.json({ error: 'bad request' }, { status: 400 }),
      ),
    )
    settings()
    await userEvent.click(await screen.findByRole('button', { name: 'Create packing list' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('asks before deleting, then lands on the trip with a Restore banner', async () => {
    seed(TRIP)
    settings()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete trip' }))
    expect(screen.getByText(/restore it for 30 days/i)).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Keep it' }))
    expect(serverTrip()?.deleted_by).toBeUndefined()
    await userEvent.click(screen.getByRole('button', { name: 'Delete trip' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Yes, delete' }))
    expect(await screen.findByText('You deleted this trip.')).toBeInTheDocument()
    await waitFor(() => expect(serverTrip()?.deleted_by).toBe(ME))
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(serverTrip()?.deleted_by).toBeUndefined())
  })
})

describe('Show next stop preference', () => {
  const lisbon = () => renderTrips(`/app/trips/${TRIP.trip_id}`)

  it('is on by default, and hides the deck when switched off from the trip settings', async () => {
    seed(TRIP)
    settings()
    const sw = await screen.findByRole('switch', { name: /Show next stop when I’m travelling/ })
    expect(sw).toBeChecked()
    expect(screen.getByText(/Opens your trips on the next place to go/)).toBeInTheDocument()
    await userEvent.click(sw)
    await waitFor(() => expect(meState.prefs.trips_show_next_stop).toBe(false))
    expect(sw).not.toBeChecked()

    // Back on the trip: no deck, today leads as a normal day with a "Next up" line.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText(/Next up:/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Next stop' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pena Palace' })).toBeInTheDocument()
  })

  it('shows the deck when the preference is on', async () => {
    seed(TRIP)
    lisbon()
    expect(await screen.findByRole('region', { name: 'Next stop' })).toBeInTheDocument()
    expect(screen.queryByText(/Next up:/)).not.toBeInTheDocument()
  })

  it('opens trips without the deck when the account says so', async () => {
    meState.prefs = { trips_show_next_stop: false }
    seed(TRIP)
    lisbon()
    expect(await screen.findByText(/Next up:/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Next stop' })).not.toBeInTheDocument()
  })

  it('is also on the account page, from the same component', async () => {
    renderTrips('/app/account')
    expect(await screen.findByRole('heading', { name: 'Trips' })).toBeInTheDocument()
    const sw = await screen.findByRole('switch', { name: /Show next stop when I’m travelling/ })
    await userEvent.click(sw)
    await waitFor(() => expect(meState.prefs.trips_show_next_stop).toBe(false))
  })

  it('is disabled offline, with a reason, and keeps the cached value', async () => {
    seed(TRIP)
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    settings()
    const sw = await screen.findByRole('switch', { name: /Show next stop when I’m travelling/ })
    expect(sw).toBeDisabled()
    expect(sw).toBeChecked()
    expect(screen.getByText('Connect to change this.')).toBeInTheDocument()
  })

  it('rolls back with a message when the server refuses', async () => {
    seed(TRIP)
    settings()
    // Registered after the page's own handlers, so it wins.
    server.use(
      http.put('/api/me', () => HttpResponse.json({ error: 'bad request' }, { status: 400 })),
    )
    const sw = await screen.findByRole('switch', { name: /Show next stop when I’m travelling/ })
    await userEvent.click(sw)
    expect(await screen.findByText('Couldn’t save that. Try again.')).toBeInTheDocument()
    await waitFor(() => expect(sw).toBeChecked())
    expect(meState.prefs.trips_show_next_stop).toBe(true)
    void within
  })
})
