import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { byteLength, deviceZone, notesProblem, runeCount, titleProblem } from '@lib/trips/limits'
import { tripServer } from '../testServer'
import {
  lisbonTrip,
  makeTrip,
  renderTrips,
  resetTripsWorld,
  seed,
  setViewport,
  todo,
} from './trips.helpers'

const TRIP = lisbonTrip()
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

describe('limits, counted the way the server counts', () => {
  it('counts bytes and characters separately', () => {
    expect(byteLength('café')).toBe(5)
    expect(byteLength('日本')).toBe(6)
    expect(runeCount('😀😀')).toBe(2)
    expect(titleProblem('x'.repeat(200))).toBe('')
    expect(titleProblem('😀'.repeat(201))).toMatch(/up to 200 characters/)
    expect(notesProblem('é'.repeat(1025), 2048)).toMatch(/too long/)
    expect(notesProblem('é'.repeat(1024), 2048)).toBe('')
  })

  it('gives the canonical zone, or nothing for an unknown one', () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    spy.mockReturnValue({ timeZone: 'Etc/Unknown' } as Intl.ResolvedDateTimeFormatOptions)
    expect(deviceZone()).toBeUndefined()
    spy.mockReturnValue({ timeZone: 'Europe/Lisbon' } as Intl.ResolvedDateTimeFormatOptions)
    expect(deviceZone()).toBe('Europe/Lisbon')
  })
})

describe('limits in the editors', () => {
  it('says a title is too long in the add bar, and does not add it', async () => {
    seed(TRIP)
    renderTrips(`/app/trips/${TRIP.trip_id}`)
    const field = await screen.findByRole('combobox', { name: 'Add to today' })
    await userEvent.click(field)
    await userEvent.paste('x'.repeat(201))
    expect(await screen.findByText('Titles can be up to 200 characters.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to today, add' })).toBeDisabled()
  })

  it('keeps a too-long note on screen, says why, and does not send it', async () => {
    seed(TRIP)
    renderTrips(`/app/trips/${TRIP.trip_id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Pack the daypack' }))
    const panel = await screen.findByRole('dialog', { name: 'Pack the daypack' })
    // The note is on show in the desk's inspector: no picker to open.
    const notes = within(panel).getByLabelText('Notes')
    await userEvent.click(notes)
    await userEvent.paste('é'.repeat(1100))
    await userEvent.tab()
    expect(await screen.findByRole('alert')).toHaveTextContent(/too long/)
    expect(notes).toHaveValue('é'.repeat(1100))
    expect(serverTrip()?.todos.find((t) => t.title === 'Pack the daypack')?.notes).toBeUndefined()
  })

  it('warns as a trip nears its 150 todos, and refuses past it', async () => {
    const full = makeTrip(3, {
      title: 'Big',
      start_date: lisbonTrip().start_date,
      end_date: lisbonTrip().end_date,
      todos: Array.from({ length: 138 }, (_, i) =>
        todo(String(i + 1), `Stop ${i + 1}`, { day: null }),
      ),
    })
    seed(full)
    setViewport('phone')
    renderTrips(`/app/trips/${full.trip_id}`)
    const field = await screen.findByRole('combobox', { name: /^Add (to|an)/ })
    await userEvent.click(await screen.findByRole('tab', { name: 'Ideas' }))
    for (const t of ['one', 'two', 'three']) await userEvent.type(field, `${t}{Enter}`)
    expect(await screen.findByText(/left before this trip is full/)).toBeInTheDocument()
    await waitFor(() => expect(serverTripOf(full)?.todos.length).toBeGreaterThan(138))
  })
})

const serverTripOf = (t: { trip_id: string }) => tripServer.trips.get(t.trip_id)
