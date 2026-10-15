import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PillNav } from '@components/PillNav'
import {
  MIA,
  lisbonTrip,
  makeTrip,
  rel,
  renderTrips,
  resetTripsWorld,
  seed,
  setViewport,
  todo,
} from './trips.helpers'

const TRIP = lisbonTrip()
const open = (id = TRIP.trip_id) => renderTrips(`/app/trips/${id}`)

beforeEach(async () => {
  await resetTripsWorld()
  Element.prototype.scrollIntoView = vi.fn()
  setViewport('desktop')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await resetTripsWorld()
})

describe('PillNav', () => {
  it('points aria-controls only at the panel that is in the page', () => {
    render(
      <PillNav
        value="b"
        onChange={() => {}}
        items={[
          { key: 'a', label: 'A', children: <p>one</p> },
          { key: 'b', label: 'B', children: <p>two</p> },
        ]}
      />,
    )
    const [a, b] = screen.getAllByRole('tab')
    expect(a).not.toHaveAttribute('aria-controls')
    const target = b.getAttribute('aria-controls') as string
    expect(document.getElementById(target)).toBe(screen.getByRole('tabpanel'))
  })

  it('sets its resize observer up once, however often the parent re-renders', () => {
    const made: number[] = []
    class RO {
      constructor() {
        made.push(1)
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', RO)
    const Host: React.FC<{ n: number }> = ({ n }) => (
      <PillNav
        value="a"
        onChange={() => {}}
        // A new array every render, as the pages do.
        items={[
          { key: 'a', label: `A${n}`, children: null },
          { key: 'b', label: 'B', children: null },
        ]}
      />
    )
    const { rerender } = render(<Host n={0} />)
    rerender(<Host n={1} />)
    rerender(<Host n={2} />)
    expect(made).toHaveLength(1)
    vi.unstubAllGlobals()
  })
})

describe('Trip screen', () => {
  it('re-announces a repeated message', async () => {
    seed(TRIP)
    open()
    const row = await screen.findByRole('button', { name: 'Jerónimos Monastery' })
    const region = () => document.querySelector('[role="status"].sr-only') as HTMLElement
    row.focus()
    // It is first in its day, so it cannot go up: say so, then say it again.
    fireEvent.keyDown(row, { key: 'ArrowUp', altKey: true })
    await waitFor(() => expect(region().textContent).toMatch(/already first/))
    const one = region().textContent
    fireEvent.keyDown(row, { key: 'ArrowUp', altKey: true })
    await waitFor(() => expect(region().textContent).not.toBe(one))
    expect(region().textContent?.replace('\u200b', '')).toBe(one?.replace('\u200b', ''))
  })

  it('opens the ticket slip as a dialog with focus inside it', async () => {
    const t = lisbonTrip()
    t.bookings.push({
      booking_id: `tbk_${'5'.padStart(32, '0')}`,
      kind: 'train',
      title: 'Rossio to Sintra',
      confirmation_code: 'CP-1',
      starts_at: `${rel(0)}T23:00`,
      created_by: MIA,
    })
    seed(t)
    open()
    await userEvent.click(await screen.findByRole('tab', { name: 'Bookings' }))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Rossio → Sintra|Rossio to Sintra/ }),
    )
    const sheet = await screen.findByRole('dialog', { name: 'Rossio to Sintra' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Show code' }))
    const slip = await screen.findByRole('dialog', { name: 'Ticket for Rossio to Sintra' })
    await waitFor(() => expect(slip).toHaveFocus())
  })

  it('gives the drag handles to a long trip row by row, and to a short one at once', async () => {
    const big = makeTrip(4, {
      title: 'Long',
      start_date: lisbonTrip().start_date,
      end_date: lisbonTrip().end_date,
      todos: Array.from({ length: 45 }, (_, i) =>
        todo(String(i + 1), `Stop ${i + 1}`, { day: rel(1), order: i + 1 }),
      ),
    })
    seed(big)
    renderTrips(`/app/trips/${big.trip_id}`)
    const row = (await screen.findByText('Stop 1')).closest('li') as HTMLElement
    expect(row).toHaveAttribute('data-dnd', 'off')
    fireEvent.pointerEnter(row)
    await waitFor(() => expect(row).toHaveAttribute('data-dnd', 'on'))
    expect((await screen.findByText('Stop 2')).closest('li')).toHaveAttribute('data-dnd', 'off')
  })

  it('arms every row of a short trip from the start', async () => {
    seed(TRIP)
    open()
    const row = (await screen.findByText('Buy souvenirs')).closest('li') as HTMLElement
    expect(row).toHaveAttribute('data-dnd', 'on')
  })
})

describe('Phone sheets', () => {
  it('returns focus to the day line when the Days sheet closes', async () => {
    setViewport('phone')
    seed(TRIP)
    open()
    const line = await screen.findByRole('button', { name: /Day 3 of 5/ })
    line.focus()
    await userEvent.click(line)
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(line).toHaveFocus())
  })
})
