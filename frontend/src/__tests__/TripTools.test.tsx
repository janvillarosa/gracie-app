import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tripServer } from '../testServer'
import { lisbonTrip, renderTrips, resetTripsWorld, seed, setViewport } from './trips.helpers'

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
  it('lists bookings by kind, with codes behind a ticket slip', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('tab', { name: 'Bookings' }))
    expect(await screen.findByText('Flights')).toBeInTheDocument()
    expect(screen.queryByText('TP1355')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show code' }))
    expect(
      await screen.findByLabelText(/Confirmation code for London to Lisbon/),
    ).toHaveTextContent('TP1355')
    await userEvent.click(screen.getByRole('button', { name: /Copy code for London to Lisbon/ }))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText('TP1355')).not.toBeInTheDocument())
  })

  it('adds a booking through the form sheet', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('tab', { name: 'Bookings' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Add a booking' }))
    const form = await screen.findByRole('form', { name: 'New booking' })
    await userEvent.selectOptions(within(form).getByLabelText('Kind'), 'train')
    await userEvent.type(within(form).getByLabelText('Title'), 'Lisbon to Porto')
    await userEvent.type(within(form).getByLabelText('Confirmation code'), 'CP-90417')
    await userEvent.click(within(form).getByRole('button', { name: 'Save booking' }))
    await waitFor(() =>
      expect(serverTrip()?.bookings.some((b) => b.confirmation_code === 'CP-90417')).toBe(true),
    )
    expect(await screen.findByText('Trains')).toBeInTheDocument()
  })

  it('asks for a title before saving', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('tab', { name: 'Bookings' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Add a booking' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Save booking' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the booking a title.')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })

  it('edits a booking in its sheet without a Save button, and checks time zones', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('tab', { name: 'Bookings' }))
    await userEvent.click(await screen.findByRole('button', { name: /^London to Lisbon/ }))
    const detail = await screen.findByRole('dialog', { name: 'London to Lisbon' })
    expect(within(detail).queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument()
    // From and to, each with its own zone.
    expect(within(detail).getByText('From')).toBeInTheDocument()
    expect(within(detail).getByText('To')).toBeInTheDocument()
    // The code is not shown until asked for, here too.
    expect(within(detail).queryByText('TP1355')).not.toBeInTheDocument()
    await userEvent.click(within(detail).getByRole('button', { name: 'Show code' }))
    expect(await screen.findByLabelText(/Confirmation code for/)).toHaveTextContent('TP1355')
    await userEvent.keyboard('{Escape}')

    const code = within(detail).getByPlaceholderText('Change the code')
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

  it('links a todo to a booking from the detail, and clears the link when the booking goes', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Lunch at Tascantiga' }))
    const panel = await screen.findByRole('dialog', { name: 'Lunch at Tascantiga' })
    await userEvent.click(within(panel).getByRole('button', { name: /Link a booking/ }))
    await userEvent.click(await screen.findByRole('button', { name: /London to Lisbon/ }))
    const todo = () => serverTrip()?.todos.find((t) => t.title === 'Lunch at Tascantiga')
    await waitFor(() => expect(todo()?.booking_id).toBe(TRIP.bookings[0].booking_id))
    await userEvent.keyboard('{Escape}')
    // Deleting the booking clears the link.
    await userEvent.click(await screen.findByRole('tab', { name: 'Bookings' }))
    await userEvent.click(await screen.findByRole('button', { name: /^London to Lisbon/ }))
    const detail = await screen.findByRole('dialog', { name: 'London to Lisbon' })
    await userEvent.click(within(detail).getByRole('button', { name: 'Delete booking' }))
    await waitFor(() => expect(todo()?.booking_id ?? null).toBeNull())
  })
})

describe('Item sheet fields and places', () => {
  const openRow = async (name: string) => {
    await userEvent.click(await screen.findByRole('button', { name }))
    return screen.findByRole('dialog', { name })
  }
  const todo = (title: string) => serverTrip()?.todos.find((x) => x.title === title)

  it('saves day, time, length, kind and notes as they change', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Pack the daypack')
    // Length only appears once there is a time.
    expect(within(panel).queryByLabelText('Duration')).not.toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: '+ Time' }))
    fireEvent.change(within(panel).getByLabelText('Time'), { target: { value: '08:30' } })
    fireEvent.blur(within(panel).getByLabelText('Time'))
    await userEvent.selectOptions(await within(panel).findByLabelText('Duration'), '1 h')
    await userEvent.click(within(panel).getByRole('button', { name: 'Category: Shopping' }))
    expect(within(panel).getByRole('button', { name: 'Category: Shopping' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.type(within(panel).getByPlaceholderText('Add a note'), 'Water, sunscreen')
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

  it('offers a custom length', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Lunch at Tascantiga')
    await userEvent.selectOptions(within(panel).getByLabelText('Duration'), 'Custom')
    const minutes = await within(panel).findByLabelText('Duration in minutes')
    await userEvent.type(minutes, '45')
    await userEvent.tab()
    await waitFor(() => expect(todo('Lunch at Tascantiga')?.duration_min).toBe(45))
  })

  it('moves the item to another day, or to Ideas, with the day chip', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Buy souvenirs')
    await userEvent.selectOptions(within(panel).getByLabelText('Day'), 'Ideas (no day)')
    await waitFor(() => expect(todo('Buy souvenirs')?.day ?? null).toBeNull())
  })

  it('picks a searched place in a sub-view, then removes it', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Pack the daypack')
    await userEvent.click(within(panel).getByRole('button', { name: /Add a place/ }))
    await userEvent.type(await within(panel).findByRole('combobox', { name: 'Place' }), 'Pena')
    const slip = await within(panel).findByRole('option', { name: /Pena Palace/ })
    expect(within(panel).getByText(/OpenStreetMap contributors \(ODbL\)/)).toBeInTheDocument()
    await userEvent.click(slip)
    await waitFor(() => expect(todo('Pack the daypack')?.place?.name).toBe('Pena Palace'))
    // Back on the sheet: the place shows as a row, and Open in Maps appears.
    expect(await within(panel).findByRole('link', { name: 'Open in Maps' })).toHaveAttribute(
      'href',
      expect.stringContaining('maps'),
    )
    await userEvent.click(within(panel).getByRole('button', { name: /Pena Palace/ }))
    await userEvent.click(await within(panel).findByRole('button', { name: 'Remove place' }))
    await waitFor(() => expect(todo('Pack the daypack')?.place ?? null).toBeNull())
  })

  it('drops a pin from typed coordinates', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Pack the daypack')
    await userEvent.click(within(panel).getByRole('button', { name: /Add a place/ }))
    await userEvent.type(
      await within(panel).findByRole('combobox', { name: 'Place' }),
      '38.7876, -9.3906',
    )
    await userEvent.click(await within(panel).findByRole('button', { name: /Drop a pin at/ }))
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
    await userEvent.click(within(panel).getByRole('button', { name: /Add a place/ }))
    await userEvent.type(
      await within(panel).findByRole('combobox', { name: 'Place' }),
      'zzz street 12',
    )
    await userEvent.click(await within(panel).findByRole('button', { name: /as the address/ }))
    await waitFor(() => expect(todo('Pack the daypack')?.place?.source).toBe('manual'))
  })

  it('names the fallback when search is down and still offers the address', async () => {
    tripServer.degradedPlaces = true
    seed(TRIP)
    open()
    const panel = await openRow('Pack the daypack')
    await userEvent.click(within(panel).getByRole('button', { name: /Add a place/ }))
    await userEvent.type(await within(panel).findByRole('combobox', { name: 'Place' }), 'Rossio')
    expect(
      await within(panel).findByText('Search is unavailable. Drop a pin or type the address.'),
    ).toBeInTheDocument()
    expect(await within(panel).findByRole('button', { name: /as the address/ })).toBeInTheDocument()
  })

  it('shows the linked booking as a row, with its code behind the same slip', async () => {
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

  it('opens the packing list panel', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'More trip options' }))
    await userEvent.click(await screen.findByText('Packing list'))
    expect(await screen.findByRole('button', { name: 'Create packing list' })).toBeInTheDocument()
  })
})

describe('Map', () => {
  it('shows the day in view and every day on request', async () => {
    seed(TRIP)
    open()
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    await userEvent.click(screen.getByRole('button', { name: 'Show all days' }))
    expect(screen.getByRole('button', { name: 'Follow the day' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('Offline map')).toBeInTheDocument()
    expect(screen.getByText('© OpenStreetMap contributors')).toBeInTheDocument()
  })
})
