import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseClock, stepClock } from '@lib/trips/clock'
import { tripServer } from '../testServer'
import { lisbonTrip, renderTrips, resetTripsWorld, seed, setViewport } from './trips.helpers'

const TRIP = lisbonTrip()
const open = () => renderTrips(`/app/trips/${TRIP.trip_id}`)
const todo = (title: string) =>
  tripServer.trips.get(TRIP.trip_id)?.todos.find((t) => t.title === title)

beforeEach(async () => {
  await resetTripsWorld()
  setViewport('desktop')
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await resetTripsWorld()
})

const openRow = async (name: string) => {
  await userEvent.click(await screen.findByRole('button', { name }))
  return screen.findByRole('dialog', { name })
}

describe('typing a time', () => {
  it('reads what people type', () => {
    expect(parseClock('9')).toBe('09:00')
    expect(parseClock('930')).toBe('09:30')
    expect(parseClock('0930')).toBe('09:30')
    expect(parseClock('9:30')).toBe('09:30')
    expect(parseClock('14.15')).toBe('14:15')
    expect(parseClock('2:30pm')).toBe('14:30')
    expect(parseClock('12am')).toBe('00:00')
    for (const bad of ['', 'noon', '25:00', '9:75', '13pm', '1234567'])
      expect(parseClock(bad)).toBeNull()
  })
  it('steps by a quarter hour and wraps around midnight', () => {
    expect(stepClock('09:00', 15)).toBe('09:15')
    expect(stepClock('09:00', -15)).toBe('08:45')
    expect(stepClock('23:50', 15)).toBe('00:05')
    expect(stepClock('00:05', -15)).toBe('23:50')
    expect(stepClock(null, 15)).toBe('09:00')
  })
})

describe('the desktop inspector edits in place', () => {
  it('sets day, time and category without opening a picker', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Pack the daypack')
    const day = within(panel).getByLabelText('Day')
    await userEvent.selectOptions(day, (day as HTMLSelectElement).options[2].value)
    const time = within(panel).getByLabelText('Time')
    await userEvent.type(time, '9{Enter}')
    await userEvent.click(within(panel).getByRole('button', { name: 'Food' }))
    await waitFor(() =>
      expect(todo('Pack the daypack')).toMatchObject({ start_time: '09:00', category: 'food' }),
    )
    // No picker sheet was needed for any of it.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('nudges the time with the arrow keys: 15 minutes, an hour with Shift', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Lunch at Tascantiga')
    const time = within(panel).getByLabelText('Time')
    expect(time).toHaveValue('12:30')
    time.focus()
    await userEvent.keyboard('{ArrowUp}')
    expect(time).toHaveValue('12:45')
    await waitFor(() => expect(todo('Lunch at Tascantiga')?.start_time).toBe('12:45'))
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(time).toHaveValue('12:15')
    await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}')
    expect(time).toHaveValue('13:15')
  })

  it('says what a bad time should look like, and keeps the saved one', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Lunch at Tascantiga')
    const time = within(panel).getByLabelText('Time')
    await userEvent.clear(time)
    await userEvent.type(time, 'soon{Enter}')
    expect(await within(panel).findByRole('alert')).toHaveTextContent(/14:30/)
    expect(time).toHaveAttribute('aria-invalid', 'true')
    expect(todo('Lunch at Tascantiga')?.start_time).toBe('12:30')
  })

  it('clears the time when the field is emptied, and drops the length with it', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Lunch at Tascantiga')
    await userEvent.clear(within(panel).getByLabelText('Time'))
    await userEvent.tab()
    await waitFor(() => expect(todo('Lunch at Tascantiga')?.start_time ?? null).toBeNull())
    expect(within(panel).queryByRole('group', { name: 'Length' })).not.toBeInTheDocument()
  })

  it('fills only the chosen category stamp', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Lunch at Tascantiga')
    const group = within(panel).getByRole('group', { name: 'Category' })
    const pressed = within(group)
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
    expect(within(group).getAllByRole('button')).toHaveLength(7)
  })

  it('shows the note as a textarea you can just type in', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Lunch at Tascantiga')
    const notes = within(panel).getByLabelText('Notes')
    expect(notes.tagName).toBe('TEXTAREA')
    expect(notes).not.toHaveFocus()
  })

  it('opens a booking with its times in place too', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('tab', { name: 'Bookings' }))
    await userEvent.click(await screen.findByRole('button', { name: /1 used/ }))
    await userEvent.click(await screen.findByRole('button', { name: /^London to Lisbon/ }))
    const panel = await screen.findByRole('dialog', { name: 'London to Lisbon' })
    expect((within(panel).getByLabelText('Depart time') as HTMLInputElement).value).toMatch(
      /^\d\d:\d\d$/,
    )
    expect(within(panel).getByLabelText('Arrive time')).toBeInTheDocument()
    expect(within(panel).getByRole('textbox', { name: 'Confirmation code' })).toBeInTheDocument()
  })

  it('gives the inspector to a new booking: the open todo closes and the booking opens', async () => {
    seed(TRIP)
    open()
    await openRow('Pena Palace')
    await userEvent.click(await screen.findByRole('tab', { name: 'Bookings' }))
    const bar = await screen.findByRole('combobox', { name: 'Add a booking' })
    await userEvent.type(bar, 'Hotel Avenida{Enter}')
    expect(await screen.findByRole('dialog', { name: 'New booking' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Pena Palace' })).not.toBeInTheDocument()
  })

  it('searches for the place in place, and stores only the Google place id and coordinates', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Pack the daypack')
    await userEvent.type(within(panel).getByRole('combobox', { name: 'Place' }), 'Heathrow')
    await userEvent.click(await screen.findByRole('option', { name: /Heathrow/ }))
    await waitFor(() => expect(todo('Pack the daypack')?.place?.place_id).toBe('demo:heathrow'))
    expect(todo('Pack the daypack')?.place?.name).toBeUndefined()
    // No picker sheet: still the one inspector dialog, with the place shown and removable.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await userEvent.click(within(panel).getByRole('button', { name: 'Remove place' }))
    await waitFor(() => expect(todo('Pack the daypack')?.place ?? null).toBeNull())
  })

  it('drops a pin from typed coordinates with Enter', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Pack the daypack')
    await userEvent.type(
      within(panel).getByRole('combobox', { name: 'Place' }),
      '38.7139, -9.1334{Enter}',
    )
    await waitFor(() => expect(todo('Pack the daypack')?.place?.source).toBe('pin'))
  })

  it('keeps the phone on pickers', async () => {
    setViewport('phone')
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Pack the daypack' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByRole('button', { name: /^When / })).toBeInTheDocument()
    expect(within(sheet).queryByLabelText('Time')).not.toBeInTheDocument()
  })
})

describe('master-detail: J/K and Alt+Up/Down', () => {
  const titles = () => {
    const el = document.querySelector('.ui-sheet-title') as HTMLInputElement | HTMLElement
    return 'value' in el ? (el as HTMLInputElement).value : el.textContent
  }

  it('J and K open the next and previous item, without closing the inspector', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Lunch at Tascantiga')
    // The inspector is ready (its keys listen) once it has taken focus; on a slow machine that is
    // a few frames after it appears.
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true))
    const first = titles()
    await userEvent.click(document.body)
    await userEvent.keyboard('j')
    await waitFor(() => expect(titles()).not.toBe(first))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    const second = titles()
    // Not typing: J and K only move when focus is outside a field (the panel may have put it in one).
    await userEvent.click(document.body)
    await userEvent.keyboard('k')
    await waitFor(() => expect(titles()).toBe(first))
    expect(second).not.toBe(first)
  })

  it('Alt+Down works from inside a field and keeps focus in the inspector', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Lunch at Tascantiga')
    const first = titles()
    const notes = within(panel).getByLabelText('Notes')
    notes.focus()
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
    await waitFor(() => expect(titles()).not.toBe(first))
    const next = screen.getByRole('dialog')
    expect(next.contains(document.activeElement)).toBe(true)
  })

  it('does not steal j and k while typing', async () => {
    seed(TRIP)
    open()
    const panel = await openRow('Lunch at Tascantiga')
    const first = titles()
    await userEvent.type(within(panel).getByLabelText('Notes'), 'jjkk')
    expect(titles()).toBe(first)
  })

  it('stops at the ends of the list', async () => {
    seed(TRIP)
    open()
    await openRow('Lunch at Tascantiga')
    await userEvent.click(document.body)
    for (let i = 0; i < 40; i++) await userEvent.keyboard('k')
    const top = titles()
    await userEvent.keyboard('k')
    expect(titles()).toBe(top)
  })
})
