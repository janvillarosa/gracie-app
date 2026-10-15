import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shortDay, shortRange } from '@lib/trips/schedule'
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
const place = (name: string, lat = 38.7, lng = -9.1) => ({
  name,
  lat,
  lng,
  source: 'photon' as const,
})

beforeEach(async () => {
  await resetTripsWorld()
  Element.prototype.scrollIntoView = vi.fn()
  setViewport('desktop')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await resetTripsWorld()
})

describe('Trip settings: structure', () => {
  it('opens from the trip menu, with a back link in the top bar and no extra Back button', async () => {
    seed(TRIP)
    renderTrips(`/app/trips/${TRIP.trip_id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'More trip options' }))
    await userEvent.click(await screen.findByText('Trip settings'))
    expect(await screen.findByLabelText('Trip name')).toBeInTheDocument()
    expect(screen.getByTestId('where').textContent).toBe(`/app/trips/${TRIP.trip_id}/settings`)
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Back to Lisbon & Porto' }))
    expect(await screen.findByRole('heading', { name: 'Lisbon & Porto' })).toBeInTheDocument()
  })

  it('is grouped rows, with no labelled boxed inputs', async () => {
    seed(TRIP)
    settings()
    await screen.findByLabelText('Trip name')
    expect(screen.getByRole('region', { name: 'This trip' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Just for you' })).toBeInTheDocument()
    for (const row of ['Where', 'When', 'Packing list'])
      expect(screen.getByText(row)).toBeInTheDocument()
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
    expect(screen.queryByText('Icon')).not.toBeInTheDocument()
    expect(screen.queryByText('Destination')).not.toBeInTheDocument()
    expect(document.querySelector('input[type="date"]')).toBeNull()
    // No stray search feedback while no search is open.
    expect(screen.queryByText(/No match/)).not.toBeInTheDocument()
  })

  it('puts Delete trip last, after "Just for you", as a quiet text button', async () => {
    seed(TRIP)
    settings()
    const del = await screen.findByRole('button', { name: 'Delete trip' })
    const justForYou = screen.getByRole('region', { name: 'Just for you' })
    expect(justForYou.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(del).toHaveClass('trip-delete')
  })
})

describe('Trip settings: identity', () => {
  it('renames the trip inline', async () => {
    seed(TRIP)
    settings()
    const title = await screen.findByLabelText('Trip name')
    await userEvent.clear(title)
    await userEvent.type(title, 'Lisbon, Sintra & Porto{Enter}')
    await waitFor(() => expect(serverTrip()?.fields.title).toBe('Lisbon, Sintra & Porto'))
  })

  it('changes the icon from the travel set, never the list icons', async () => {
    seed(TRIP)
    settings()
    await userEvent.click(await screen.findByRole('button', { name: 'Change icon' }))
    const sheet = await screen.findByRole('dialog')
    expect(
      within(sheet)
        .getAllByRole('button')
        .filter((b) => b.hasAttribute('aria-pressed')),
    ).toHaveLength(12)
    expect(within(sheet).queryByRole('button', { name: 'Apple' })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Tv' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Suitcase' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(within(sheet).getByRole('button', { name: 'Plane' }))
    await waitFor(() => expect(serverTrip()?.fields.icon).toBe('PLANE'))
    expect(await screen.findByRole('button', { name: 'Change icon' })).toHaveTextContent('✈️')
  })
})

describe('Trip settings: Where', () => {
  it('shows one route, and builds it in a sheet where the first place is the destination', async () => {
    seed(makeTrip(7, { title: 'Draft' }))
    settings(makeTrip(7).trip_id)
    const row = (await screen.findByText('Where')).closest('button') as HTMLElement
    expect(within(row).getByText('Add a place')).toBeInTheDocument()
    await userEvent.click(row)
    const sheet = await screen.findByRole('dialog')
    for (const name of ['Lisbon', 'Porto']) {
      await userEvent.type(within(sheet).getByRole('combobox', { name: 'Add a place' }), name)
      await userEvent.click(await within(sheet).findByRole('option', { name: new RegExp(name) }))
      await within(sheet).findByText(name, { selector: '.trip-stop-name' })
    }
    const t = () => tripServer.trips.get(makeTrip(7).trip_id)?.fields
    await waitFor(() => expect(t()?.stops?.map((s) => s.name)).toEqual(['Lisbon', 'Porto']))
    expect(t()?.destination?.name).toBe('Lisbon')

    await userEvent.click(within(sheet).getByRole('button', { name: 'Move Porto earlier' }))
    await waitFor(() => expect(t()?.stops?.map((s) => s.name)).toEqual(['Porto', 'Lisbon']))
    expect(t()?.destination?.name).toBe('Porto')

    await userEvent.click(
      within(sheet).getByRole('button', { name: 'Remove Porto from the route' }),
    )
    await waitFor(() => expect(t()?.stops?.map((s) => s.name)).toEqual(['Lisbon']))
    expect(t()?.destination?.name).toBe('Lisbon')
    await userEvent.click(
      within(sheet).getByRole('button', { name: 'Remove Lisbon from the route' }),
    )
    await waitFor(() => expect(t()?.destination ?? null).toBeNull())
  })

  it('reads the route as Lisbon → Porto', async () => {
    seed({ ...TRIP, stops: [place('Lisbon'), place('Porto', 41.1, -8.6)] })
    settings()
    expect(await screen.findByText('Lisbon → Porto')).toBeInTheDocument()
  })

  it('removes a place with a swipe', async () => {
    seed({ ...TRIP, stops: [place('Lisbon'), place('Porto', 41.1, -8.6)] })
    settings()
    await userEvent.click((await screen.findByText('Where')).closest('button') as HTMLElement)
    const sheet = await screen.findByRole('dialog')
    class TouchPointer extends MouseEvent {
      pointerType = 'touch'
      pointerId = 1
    }
    const row = (await within(sheet).findByText('Porto', { selector: '.trip-stop-name' })).closest(
      'li',
    ) as HTMLElement
    const slide = row.querySelector('.item-slide') as Element
    const at = (type: string, x: number) =>
      fireEvent(slide, new TouchPointer(type, { bubbles: true, clientX: x, clientY: 20 }))
    at('pointerdown', 300)
    at('pointermove', 280)
    at('pointermove', 200)
    at('pointermove', 150)
    at('pointerup', 150)
    await waitFor(() => expect(serverTrip()?.fields.stops?.map((s) => s.name)).toEqual(['Lisbon']))
  })

  it('shows search feedback only inside the place search, after a search ran', async () => {
    seed(TRIP)
    settings()
    await userEvent.click((await screen.findByText('Where')).closest('button') as HTMLElement)
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).queryByText(/No match/)).not.toBeInTheDocument()
    await userEvent.type(within(sheet).getByRole('combobox', { name: 'Add a place' }), 'zzzzqx')
    expect(await within(sheet).findByText(/No match/)).toBeInTheDocument()
  })
})

describe('Trip settings: When', () => {
  it('says "Add dates" for a draft, and the range and length for a dated trip', async () => {
    seed(makeTrip(7, { title: 'Draft' }))
    settings(makeTrip(7).trip_id)
    expect(await screen.findByText('Add dates')).toBeInTheDocument()
  })

  it('reads the dates as a short range with the number of days', async () => {
    seed(TRIP)
    settings()
    expect(await screen.findByText(`${shortRange(rel(-2), rel(2))} · 5 days`)).toBeInTheDocument()
  })

  it('picks a range on one calendar: first day, then last, and saves as it goes', async () => {
    seed(makeTrip(7, { title: 'Draft' }))
    settings(makeTrip(7).trip_id)
    await userEvent.click((await screen.findByText('When')).closest('button') as HTMLElement)
    const sheet = await screen.findByRole('dialog')
    const label = (d: string) => new RegExp(shortDay(d).replace(/\s/, '.*'))
    await userEvent.click(within(sheet).getByRole('button', { name: label(rel(1)) }))
    const t = () => tripServer.trips.get(makeTrip(7).trip_id)?.fields
    // The first tap is already a one-day trip.
    await waitFor(() => expect(t()?.start_date).toBe(rel(1)))
    expect(t()?.end_date).toBe(rel(1))
    await userEvent.click(within(sheet).getByRole('button', { name: label(rel(3)) }))
    await waitFor(() => expect(t()?.end_date).toBe(rel(3)))
    expect(t()?.start_date).toBe(rel(1))
    // No native date inputs anywhere.
    expect(sheet.querySelector('input[type="date"]')).toBeNull()
  })

  it('never changes height between taps, and offers Done once a range exists', async () => {
    seed(makeTrip(7, { title: 'Draft' }))
    settings(makeTrip(7).trip_id)
    await userEvent.click((await screen.findByText('When')).closest('button') as HTMLElement)
    const sheet = await screen.findByRole('dialog')
    const grid = () => sheet.querySelector('.trip-cal-grid') as HTMLElement
    const foot = () => sheet.querySelector('.trip-cal-foot') as HTMLElement
    // Six weeks always: the grid has the same number of cells before and after.
    const cells = grid().children.length
    expect(cells).toBe(7 + 42)
    // The footer row exists from the start; its keys are only hidden until needed.
    expect(foot()).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
    const label = (d: string) => new RegExp(shortDay(d).replace(/\s/, '.*'))
    await userEvent.click(within(sheet).getByRole('button', { name: label(rel(1)) }))
    expect(grid().children.length).toBe(cells)
    expect(sheet.querySelector('.trip-cal-foot')).toBe(foot())
    await userEvent.click(within(sheet).getByRole('button', { name: label(rel(3)) }))
    expect(grid().children.length).toBe(cells)
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps a single day when the same day is tapped twice, and clears the dates', async () => {
    seed(makeTrip(7, { title: 'Draft', start_date: rel(5), end_date: rel(5) }))
    settings(makeTrip(7).trip_id)
    await userEvent.click((await screen.findByText('When')).closest('button') as HTMLElement)
    const sheet = await screen.findByRole('dialog')
    const t = () => tripServer.trips.get(makeTrip(7).trip_id)?.fields
    await userEvent.click(within(sheet).getByRole('button', { pressed: true }))
    expect(t()?.start_date).toBe(rel(5))
    expect(t()?.end_date).toBe(rel(5))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Clear dates' }))
    await waitFor(() => expect(t()?.start_date ?? null).toBeNull())
    expect(t()?.end_date ?? null).toBeNull()
  })
})

describe('Trip settings: packing list', () => {
  const list = {
    list_id: 'list_packing',
    room_id: 'room_1',
    name: 'Packing · Lisbon & Porto',
    is_deleted: false,
  }

  it('shows a linked list as a row with its item count, and opens it', async () => {
    meState.lists = [list]
    meState.items = [{ item_id: 'a' }, { item_id: 'b' }, { item_id: 'c' }]
    seed({ ...TRIP, packing_list_id: 'list_packing' })
    settings()
    const row = (await screen.findByText('Packing list')).closest('a') as HTMLElement
    expect(row).toHaveAttribute('href', '/app/lists/list_packing')
    expect(await within(row).findByText('3 items')).toBeInTheDocument()
    expect(screen.queryByText('Make a packing list')).not.toBeInTheDocument()
  })

  it('says so when the linked list is empty', async () => {
    meState.lists = [list]
    meState.items = []
    seed({ ...TRIP, packing_list_id: 'list_packing' })
    settings()
    expect(await screen.findByText('Empty · add items')).toBeInTheDocument()
  })

  it('treats a missing or deleted list as unlinked', async () => {
    meState.lists = [{ ...list, is_deleted: true }]
    seed({ ...TRIP, packing_list_id: 'list_packing' })
    settings()
    expect(await screen.findByText('Make a packing list')).toBeInTheDocument()
  })

  it('makes the list online and then shows it as linked', async () => {
    seed(TRIP)
    settings()
    const row = (await screen.findByText('Packing list')).closest('button') as HTMLElement
    meState.lists = [list]
    await userEvent.click(row)
    await waitFor(() => expect(serverTrip()?.fields.packing_list_id).toBe('list_packing'))
    expect(await screen.findByText(/items?$/)).toBeInTheDocument()
  })

  it('says why it could not be made', async () => {
    seed(TRIP)
    settings()
    server.use(
      http.post('/api/rooms/:roomId/trips/:tripId/packing-list', () =>
        HttpResponse.json({ error: 'nope' }, { status: 500 }),
      ),
    )
    await userEvent.click(
      (await screen.findByText('Packing list')).closest('button') as HTMLElement,
    )
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('is disabled offline, with a reason', async () => {
    seed(TRIP)
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    settings()
    const row = (await screen.findByText('Packing list')).closest('button') as HTMLElement
    expect(row).toBeDisabled()
    expect(within(row).getByText('Connect to make one')).toBeInTheDocument()
  })
})

describe('Trip settings: delete', () => {
  it('confirms in House voice, then lands on the trip with a Restore banner', async () => {
    seed(TRIP)
    settings()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete trip' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete Lisbon & Porto?' })
    expect(
      within(dialog).getByText('Anyone in the House can restore it for 30 days.'),
    ).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(serverTrip()?.deleted_by).toBeUndefined()
    await userEvent.click(screen.getByRole('button', { name: 'Delete trip' }))
    const again = await screen.findByRole('dialog', { name: 'Delete Lisbon & Porto?' })
    await userEvent.click(within(again).getByRole('button', { name: 'Delete' }))
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
    await userEvent.click(screen.getByRole('link', { name: 'Back to Lisbon & Porto' }))
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
  })
})
