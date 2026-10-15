import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Booking } from '@api/tripTypes'
import { groupBookings, inferKind, normalizeZone } from '@lib/trips/bookings'
import { tripServer } from '../testServer'
import {
  MIA,
  lisbonTrip,
  rel,
  renderTrips,
  resetTripsWorld,
  seed,
  setViewport,
} from './trips.helpers'
import { expectAtMostOneKey } from './ui.helpers'

const TRIP = lisbonTrip()
const serverTrip = () => tripServer.trips.get(TRIP.trip_id)
const open = () => renderTrips(`/app/trips/${TRIP.trip_id}`)
const bk = (n: number, p: Partial<Booking>): Booking => ({
  booking_id: `tbk_${String(n).padStart(32, '0')}`,
  kind: 'ticket',
  title: `Booking ${n}`,
  created_by: MIA,
  ...p,
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

const toBookings = async () => userEvent.click(await screen.findByRole('tab', { name: 'Bookings' }))
const newSheet = async (typed?: string) => {
  await toBookings()
  const bar = await screen.findByRole('combobox', { name: 'Add a booking' })
  if (typed) await userEvent.type(bar, `${typed}{Enter}`)
  else await userEvent.click(screen.getByRole('button', { name: 'Add a booking, add' }))
  return screen.findByRole('dialog', { name: 'New booking' })
}

describe('guessing a kind from what was typed', () => {
  it.each([
    ['TP1355 to Lisbon', 'flight'],
    ['✈ Lisbon', 'flight'],
    ['Hotel Ribeira', 'stay'],
    ['Alfama flat', 'stay'],
    ['Train to Porto', 'train'],
    ['Car hire', 'car'],
    ['Museum ticket', 'ticket'],
    ['Pastéis', undefined],
    ['', undefined],
  ])('%s → %s', (text, kind) => {
    expect(inferKind(text as string)).toBe(kind)
  })
})

describe('time zone names', () => {
  it('are sent in their canonical form, and only when they are zones', () => {
    expect(normalizeZone('europe/lisbon')).toBe('Europe/Lisbon')
    expect(normalizeZone(' Europe/London ')).toBe('Europe/London')
    expect(normalizeZone('UTC')).toBe('UTC')
    expect(normalizeZone('Mars/Olympus')).toBeNull()
    expect(normalizeZone('')).toBeNull()
  })
})

describe('the Bookings list', () => {
  it('has one add bar: what you type becomes the title, and the kind is guessed', async () => {
    seed(TRIP)
    open()
    await toBookings()
    expect(screen.queryByRole('button', { name: 'Add booking' })).not.toBeInTheDocument()
    expect(screen.getAllByPlaceholderText(/^Add /)).toHaveLength(1)
    const sheet = await newSheet('Hotel Ribeira')
    expect(within(sheet).getByLabelText('Title')).toHaveValue('Hotel Ribeira')
    expect(within(sheet).getByRole('button', { name: 'Kind, Stay' })).toBeInTheDocument()
  })

  it('says what an empty list is for', async () => {
    const t = lisbonTrip()
    t.bookings = []
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    await toBookings()
    expect(
      await screen.findByText('No bookings yet. Flights, stays and tickets go here.'),
    ).toBeInTheDocument()
  })

  it('is chronological: Now, then Next, then what is coming, then used (folded)', async () => {
    const t = lisbonTrip()
    t.bookings = [
      bk(1, { kind: 'train', title: 'Porto to London', starts_at: `${rel(2)}T18:00` }),
      bk(2, {
        kind: 'stay',
        title: 'Alfama flat',
        starts_at: `${rel(-1)}T15:00`,
        ends_at: `${rel(2)}T11:00`,
      }),
      bk(3, {
        kind: 'flight',
        title: 'London to Lisbon',
        starts_at: `${rel(-2)}T07:05`,
        ends_at: `${rel(-2)}T09:40`,
      }),
      bk(4, {
        kind: 'train',
        title: 'Rossio to Sintra',
        starts_at: `${rel(1)}T09:15`,
        ends_at: `${rel(1)}T09:55`,
      }),
    ]
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    await toBookings()
    const titles = () =>
      [...document.querySelectorAll('.trip-bookings .trip-bcard .trip-title')].map(
        (e) => e.textContent,
      )
    await waitFor(() =>
      expect(titles()).toEqual(['Alfama flat', 'Rossio to Sintra', 'Porto to London']),
    )
    const rows = [...document.querySelectorAll('.trip-bookings .trip-bcard')]
    expect(within(rows[0] as HTMLElement).getByText(/^Now · until /)).toBeInTheDocument()
    expect(within(rows[1] as HTMLElement).getByText(/^Next · /)).toBeInTheDocument()
    expect(within(rows[2] as HTMLElement).queryByText(/^(Now|Next)/)).not.toBeInTheDocument()
    // The kind is the leading icon, not a group heading.
    expect(screen.queryByText('Flights')).not.toBeInTheDocument()
    expect(screen.queryByText('Trains')).not.toBeInTheDocument()
    // Used: folded, with the stamp when shown.
    await userEvent.click(screen.getByRole('button', { name: '1 used · Show' }))
    const used = (await screen.findByText('London to Lisbon')).closest('li') as HTMLElement
    expect(within(used).getByText('Used')).toBeInTheDocument()
  })

  it('groups with the helper: under way, next, coming, over', () => {
    const now = Date.parse(`${rel(0)}T12:00:00Z`)
    const g = groupBookings(
      [
        bk(1, { starts_at: `${rel(0)}T08:00`, ends_at: `${rel(0)}T09:00` }),
        bk(2, { starts_at: `${rel(0)}T11:00`, ends_at: `${rel(0)}T13:00` }),
        bk(3, { starts_at: `${rel(0)}T15:00` }),
        bk(4, { starts_at: `${rel(1)}T15:00` }),
      ],
      now,
      'UTC',
    )
    expect(g.used.map((b) => b.booking_id.slice(-1))).toEqual(['1'])
    expect(g.now.map((b) => b.booking_id.slice(-1))).toEqual(['2'])
    expect(g.next?.booking_id.slice(-1)).toBe('3')
    expect(g.upcoming.map((b) => b.booking_id.slice(-1))).toEqual(['4'])
  })
})

describe('adding a booking', () => {
  it('opens on kind first, with the fields hidden until one is picked', async () => {
    seed(TRIP)
    open()
    const sheet = await newSheet()
    const kinds = within(sheet).getByRole('group', { name: 'Kind of booking' })
    expect(
      within(kinds)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Flight', 'Stay', 'Train', 'Car', 'Ticket', 'Other'])
    expect(within(sheet).queryByLabelText('Title')).not.toBeInTheDocument()
    await userEvent.click(within(kinds).getByRole('button', { name: 'Ticket' }))
    expect(await within(sheet).findByLabelText('Title')).toHaveValue('')
    // No labels above boxed inputs: rows and chips, like a todo.
    expect(sheet.querySelector('select, input[type="datetime-local"]')).toBeNull()
  })

  it('shows rows for the kind: flight, stay, car and ticket', async () => {
    seed(TRIP)
    open()
    const sheet = await newSheet()
    const row = (name: RegExp) => within(sheet).queryByRole('button', { name })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Flight' }))
    expect(row(/^From /)).toBeInTheDocument()
    expect(row(/^Depart /)).toBeInTheDocument()
    expect(row(/^Arrive /)).toBeInTheDocument()
    const change = async (from: string, to: string) => {
      await userEvent.click(within(sheet).getByRole('button', { name: `Kind, ${from}` }))
      await userEvent.click(await screen.findByRole('button', { name: to }))
    }
    await change('Flight', 'Stay')
    expect(row(/^Check-in /)).toBeInTheDocument()
    expect(row(/^Check-out /)).toBeInTheDocument()
    expect(row(/^Arrive /)).not.toBeInTheDocument()
    await change('Stay', 'Car')
    expect(row(/^Pick-up /)).toBeInTheDocument()
    expect(row(/^Drop-off /)).toBeInTheDocument()
    await change('Car', 'Ticket')
    expect(row(/^When /)).toBeInTheDocument()
    expect(row(/^Drop-off /)).not.toBeInTheDocument()
  })

  it('enables the yellow key only with a kind and a title, and creates the booking', async () => {
    seed(TRIP)
    open()
    const sheet = await newSheet()
    expect(within(sheet).queryByRole('button', { name: 'Add booking' })).not.toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Train' }))
    const create = within(sheet).getByRole('button', { name: 'Add booking' })
    expectAtMostOneKey(sheet)
    expect(create).toBeDisabled()
    await userEvent.type(within(sheet).getByLabelText('Title'), 'Lisbon to Porto{Enter}')
    expect(create).toBeEnabled()
    await userEvent.click(create)
    await waitFor(() =>
      expect(
        serverTrip()?.bookings.some((b) => b.title === 'Lisbon to Porto' && b.kind === 'train'),
      ).toBe(true),
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New booking' })).not.toBeInTheDocument(),
    )
    expect(await screen.findByText('Lisbon to Porto')).toBeInTheDocument()
  })

  it('falls back to the trip zone when there is no place, so times are in a defined zone', async () => {
    seed(TRIP)
    open()
    const sheet = await newSheet('Hotel Extra')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add booking' }))
    await waitFor(() => {
      const made = serverTrip()?.bookings.find((x) => x.title === 'Hotel Extra')
      expect(made?.start_tz).toBe(TRIP.tz)
      expect(made?.end_tz).toBe(TRIP.tz)
    })
  })

  it('never asks for a time zone: it comes from the place, and shows only when it differs', async () => {
    seed(TRIP)
    open()
    const sheet = await newSheet('Flight home')
    expect(within(sheet).queryByLabelText(/time zone/i)).not.toBeInTheDocument()
    const departs = () => within(sheet).getByRole('button', { name: /^Depart / })
    const pickPlace = async (query: string, option: RegExp) => {
      await userEvent.click(within(sheet).getByRole('button', { name: /^From / }))
      const remove = screen.queryByRole('button', { name: 'Remove booking place' })
      if (remove) await userEvent.click(remove)
      await userEvent.type(await screen.findByRole('combobox', { name: 'Booking place' }), query)
      await userEvent.click(await screen.findByRole('option', { name: option }))
    }
    // A place in the trip's own zone: nothing to say.
    await pickPlace('Lisbon', /Lisbon/)
    expect(departs()).toHaveTextContent(/\d\d:\d\d$/)
    // A place in another zone: its zone is a muted suffix on the time.
    await pickPlace('Heathrow', /Heathrow/)
    await waitFor(() => expect(departs()).toHaveTextContent(/\d\d:\d\d London$/))
    // And it is what gets saved (the trip's own zone is saved as nothing).
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add booking' }))
    await waitFor(() => {
      const made = serverTrip()?.bookings.find((x) => x.title === 'Flight home')
      expect(made?.start_tz).toBe('Europe/London')
      expect(made?.place?.name).toBe('Heathrow Airport')
    })
  })

  it('asks before throwing away something entered, and not otherwise', async () => {
    seed(TRIP)
    open()
    let sheet = await newSheet()
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New booking' })).not.toBeInTheDocument(),
    )

    sheet = await newSheet('Hotel Ribeira')
    await userEvent.click(within(sheet).getByLabelText('Title'))
    await userEvent.type(within(sheet).getByLabelText('Title'), ' two{Enter}')
    await userEvent.keyboard('{Escape}')
    expect(
      await screen.findByRole('heading', { name: 'Discard this booking?' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('dialog', { name: 'New booking' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New booking' })).not.toBeInTheDocument(),
    )
    expect(serverTrip()?.bookings.some((b) => b.title.startsWith('Hotel Ribeira'))).toBe(false)
  })
})

describe('a booking with a start and an end place', () => {
  const lis = {
    name: 'Lisbon LIS',
    locality: 'Lisbon',
    lat: 38.77,
    lng: -9.13,
    source: 'photon' as const,
  }
  const opo = {
    name: 'Porto OPO',
    locality: 'Porto',
    lat: 41.24,
    lng: -8.68,
    source: 'photon' as const,
  }
  const flight = (over: Partial<Booking> = {}) =>
    bk(9, { kind: 'flight', title: 'Hop', place: lis, end_place: opo, ...over })
  const seedWith = (b: Booking) => {
    const t = lisbonTrip()
    t.bookings = [b]
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
  }
  const openHop = async () => {
    await toBookings()
    await userEvent.click(await screen.findByRole('button', { name: /^Hop/ }))
    return screen.findByRole('dialog', { name: 'Hop' })
  }

  it('shows From and To rows for flights, trains and cars, and one Place row for a stay', async () => {
    seed(TRIP)
    open()
    const sheet = await newSheet()
    const row = (name: RegExp) => within(sheet).queryByRole('button', { name })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Car' }))
    expect(row(/^From /)).toBeInTheDocument()
    expect(row(/^To /)).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Kind, Car' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Stay' }))
    expect(row(/^Place /)).toBeInTheDocument()
    expect(row(/^To /)).not.toBeInTheDocument()
  })

  // The shared mock server (mocks/tripsServer.ts) still rejects `end_place`: add it to BOOKING_KEYS
  // there (the cleanup agent owns that file), then turn this on.
  it('saves the To place as end_place and leaves place as the start', async () => {
    seed(TRIP)
    open()
    const sheet = await newSheet('Flight home')
    await userEvent.click(within(sheet).getByRole('button', { name: /^To / }))
    await userEvent.type(
      await screen.findByRole('combobox', { name: 'Booking end place' }),
      'Heathrow',
    )
    await userEvent.click(await screen.findByRole('option', { name: /Heathrow/ }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add booking' }))
    await waitFor(() => {
      const made = serverTrip()?.bookings.find((x) => x.title === 'Flight home')
      expect(made?.end_place?.name).toBe('Heathrow Airport')
      expect(made?.place ?? null).toBeNull()
    })
  })

  it('names the route in the sheet and in the list', async () => {
    seedWith(flight({ starts_at: `${rel(1)}T09:00`, ends_at: `${rel(1)}T10:00` }))
    await toBookings()
    const row = (await screen.findByRole('button', { name: /^Hop/ })) as HTMLElement
    expect(row).toHaveTextContent('Lisbon → Porto')
    await userEvent.click(row)
    const sheet = await screen.findByRole('dialog', { name: 'Hop' })
    expect(sheet.querySelector('.ui-sheet-context')).toHaveTextContent(/^Lisbon → Porto · /)
    expect(within(sheet).getByRole('button', { name: /^To Porto/ })).toBeInTheDocument()
  })

  it('opens Maps at the start before it begins, and at the end once it is under way', async () => {
    seedWith(flight({ starts_at: `${rel(1)}T09:00`, ends_at: `${rel(1)}T10:00` }))
    let sheet = await openHop()
    expect(within(sheet).getByRole('link', { name: 'Open Maps' })).toHaveAttribute(
      'href',
      expect.stringContaining(String(lis.lat)),
    )
  })

  it('opens Maps at the end place while it is under way', async () => {
    seedWith(flight({ starts_at: `${rel(0)}T00:01`, ends_at: `${rel(1)}T23:00` }))
    const sheet = await openHop()
    expect(within(sheet).getByRole('link', { name: 'Open Maps' })).toHaveAttribute(
      'href',
      expect.stringContaining(String(opo.lat)),
    )
  })
})

describe('the bookings cap', () => {
  it('says so at 50 bookings and sends nothing more', async () => {
    const t = lisbonTrip()
    t.bookings = Array.from({ length: 50 }, (_, i) => bk(i + 1, { title: `Booking ${i + 1}` }))
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const sheet = await newSheet('Hotel Extra')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add booking' }))
    expect(await screen.findByText(/all the bookings it can hold \(50\)/)).toBeInTheDocument()
    expect(tripServer.trips.get(t.trip_id)?.bookings).toHaveLength(50)
  })
})

describe('editing a booking', () => {
  const stay = bk(7, {
    kind: 'stay',
    title: 'Alfama flat',
    confirmation_code: 'ABC123',
    starts_at: `${rel(-1)}T15:00`,
    ends_at: `${rel(2)}T11:00`,
  })
  const withStay = () => {
    const t = lisbonTrip()
    t.bookings = [stay]
    t.todos[3] = { ...t.todos[3], booking_id: stay.booking_id }
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    return t
  }
  const openStay = async () => {
    await toBookings()
    await userEvent.click(await screen.findByRole('button', { name: /^Alfama flat/ }))
    return screen.findByRole('dialog', { name: 'Alfama flat' })
  }

  it('saves as it changes, with the kind as a small chip and the todos it is linked to', async () => {
    withStay()
    const sheet = await openStay()
    expect(within(sheet).queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Kind, Stay' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^Check-in / })).toBeInTheDocument()
    expect(
      within(sheet).getByRole('button', { name: /^Linked to Pena Palace/ }),
    ).toBeInTheDocument()
    const t = () => serverTrip()?.bookings.find((b) => b.booking_id === stay.booking_id)
    const title = within(sheet).getByLabelText('Title')
    await userEvent.clear(title)
    await userEvent.type(title, 'Alfama flat, 4th floor{Enter}')
    await waitFor(() => expect(t()?.title).toBe('Alfama flat, 4th floor'))
    // Changing the kind keeps what fits.
    await userEvent.click(within(sheet).getByRole('button', { name: 'Kind, Stay' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ticket' }))
    await waitFor(() => expect(t()?.kind).toBe('ticket'))
    expect(t()?.starts_at).toBe(stay.starts_at)
  })

  it('has one code row: Show opens the slip, which has Edit; nothing else', async () => {
    withStay()
    const sheet = await openStay()
    expect(within(sheet).queryByText('ABC123')).not.toBeInTheDocument()
    expect(within(sheet).queryByPlaceholderText('Change the code')).not.toBeInTheDocument()
    expect(within(sheet).getAllByRole('button', { name: 'Show code' })).toHaveLength(1)
    await userEvent.click(within(sheet).getByRole('button', { name: 'Show code' }))
    const slip = await screen.findByRole('dialog', { name: 'Ticket for Alfama flat' })
    expect(within(slip).getByLabelText(/Confirmation code for/)).toHaveTextContent('ABC123')
    await userEvent.click(within(slip).getByRole('button', { name: 'Edit' }))
    const field = await screen.findByRole('textbox', { name: 'Confirmation code' })
    expect(field).toHaveValue('ABC123')
    await userEvent.clear(field)
    await userEvent.type(field, 'XYZ9{Enter}')
    const t = () => serverTrip()?.bookings.find((b) => b.booking_id === stay.booking_id)
    await waitFor(() => expect(t()?.confirmation_code).toBe('XYZ9'))
    // And it can be cleared.
    await userEvent.click(within(sheet).getByRole('button', { name: 'Show code' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const again = await screen.findByRole('textbox', { name: 'Confirmation code' })
    await userEvent.clear(again)
    await userEvent.tab()
    await waitFor(() => expect(t()?.confirmation_code ?? '').toBe(''))
    expect(
      await within(sheet).findByRole('button', { name: /Add confirmation code/ }),
    ).toBeInTheDocument()
  })

  it('adds a code from "Add confirmation code"', async () => {
    const t = lisbonTrip()
    t.bookings = [{ ...stay, confirmation_code: '' }]
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const sheet = await openStay()
    await userEvent.click(within(sheet).getByRole('button', { name: /Add confirmation code/ }))
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Confirmation code' }),
      'NEW42{Enter}',
    )
    await waitFor(() => expect(serverTrip()?.bookings[0].confirmation_code).toBe('NEW42'))
    expect(await within(sheet).findByRole('button', { name: 'Show code' })).toBeInTheDocument()
  })

  it('keeps time zones behind the ⋯ menu, and checks them', async () => {
    withStay()
    const sheet = await openStay()
    expect(within(sheet).queryByLabelText(/time zone/i)).not.toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'More booking options' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Change time zone' }))
    const zone = await screen.findByLabelText('End time zone')
    await userEvent.type(zone, 'Mars/Olympus')
    await userEvent.tab()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Europe\/Lisbon/)
    await userEvent.clear(zone)
    await userEvent.type(zone, 'europe/london')
    await userEvent.tab()
    const t = () => serverTrip()?.bookings.find((b) => b.booking_id === stay.booking_id)
    await waitFor(() => expect(t()?.end_tz).toBe('Europe/London'))
  })

  it('deletes with a quiet red button at the bottom', async () => {
    withStay()
    const sheet = await openStay()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete booking' }))
    await waitFor(() => expect(serverTrip()?.bookings).toHaveLength(0))
  })
})
