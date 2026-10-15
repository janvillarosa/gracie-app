import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tripServer } from '../testServer'
import {
  makeTrip,
  meState,
  rel,
  renderTrips,
  resetTripsWorld,
  seed,
  setViewport,
  todo,
} from './trips.helpers'

beforeEach(async () => {
  await resetTripsWorld()
  Element.prototype.scrollIntoView = vi.fn()
  setViewport('desktop')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await resetTripsWorld()
})

const here = () => screen.getByTestId('where').textContent

describe('House page: Lists and Trips as a pill switch', () => {
  it('opens on Lists, with the sheet’s key and no section headings', async () => {
    renderTrips('/app')
    const tabs = await screen.findByRole('tablist', { name: 'House sections' })
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Lists', 'Trips'])
    expect(within(tabs).getByRole('tab', { name: 'Lists' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('button', { name: /New list/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Our Lists' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Our Trips' })).not.toBeInTheDocument()
  })

  it('switches to Trips, keeps the URL in step and swaps the key', async () => {
    renderTrips('/app')
    await userEvent.click(await screen.findByRole('tab', { name: 'Trips' }))
    expect(await screen.findByRole('button', { name: /New trip/ })).toBeInTheDocument()
    expect(here()).toBe('/app/trips')
    expect(screen.getByRole('tab', { name: 'Trips' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'Lists' }))
    expect(await screen.findByRole('button', { name: /New list/ })).toBeInTheDocument()
    expect(here()).toBe('/app')
  })

  it('moves between pills with the arrow keys', async () => {
    renderTrips('/app')
    const lists = await screen.findByRole('tab', { name: 'Lists' })
    lists.focus()
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Trips' })).toHaveAttribute('aria-selected', 'true'),
    )
    expect(here()).toBe('/app/trips')
    screen.getByRole('tab', { name: 'Trips' }).focus()
    await userEvent.keyboard('{Home}')
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Lists' })).toHaveAttribute('aria-selected', 'true'),
    )
  })

  it('opens /app/trips straight on the Trips pill', async () => {
    renderTrips('/app/trips')
    expect(await screen.findByRole('button', { name: /New trip/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Trips' })).toHaveAttribute('aria-selected', 'true')
  })

  it('remembers the last pill: coming back to the House lands on it', async () => {
    renderTrips('/app/trips')
    await screen.findByRole('button', { name: /New trip/ })
    expect(localStorage.getItem('bauhouse_house_pill')).toBe('trips')
    // A fresh visit to /app goes to the pill you last used.
    renderTrips('/app')
    await waitFor(() =>
      expect(screen.getAllByTestId('where').pop()?.textContent).toBe('/app/trips'),
    )
  })

  it('defaults to Lists when nothing is remembered, or storage is unavailable', async () => {
    const real = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, k: string) {
      if (k === 'bauhouse_house_pill') throw new Error('blocked')
      return real.call(this, k)
    })
    renderTrips('/app')
    expect(await screen.findByRole('tab', { name: 'Lists' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    vi.restoreAllMocks()
  })

  it('puts a small yellow dot on Trips while a trip is happening now', async () => {
    seed(makeTrip(1, { title: 'Lisbon & Porto', start_date: rel(-1), end_date: rel(5) }))
    renderTrips('/app')
    const tab = await screen.findByRole('tab', { name: 'Trips, one happening now' })
    // A 6px dot at the label's top-right while Trips is not the selected pill.
    expect(tab.querySelector('.pill-label .pill-dot')).not.toBeNull()
    await userEvent.click(tab)
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Trips, one happening now' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    expect(
      screen.getByRole('tab', { name: 'Trips, one happening now' }).querySelector('.pill-dot'),
    ).toBeNull()
  })

  it('has no dot when nothing is happening', async () => {
    seed(makeTrip(2, { title: 'Ghent', start_date: rel(30), end_date: rel(32) }))
    renderTrips('/app')
    await screen.findByRole('tab', { name: 'Trips' })
    expect(screen.queryByRole('tab', { name: /one happening now/ })).not.toBeInTheDocument()
  })
})

describe('Trips pill', () => {
  it('lists the trip happening now first, then upcoming by date, then drafts', async () => {
    seed(makeTrip(1, { title: 'Weekend in Ghent', start_date: rel(40), end_date: rel(42) }))
    seed(makeTrip(2, { title: 'Lisbon & Porto', start_date: rel(-1), end_date: rel(5) }))
    seed(makeTrip(3, { title: 'Somewhere warm', todos: [todo('1', 'Madeira', { day: null })] }))
    seed(makeTrip(4, { title: 'Berlin', start_date: rel(10), end_date: rel(12) }))
    renderTrips('/app/trips')
    await screen.findByText('Lisbon & Porto')
    const names = Array.from(document.querySelectorAll('.list-row-name')).map((e) => e.textContent)
    expect(names).toEqual(['Lisbon & Porto', 'Berlin', 'Weekend in Ghent', 'Somewhere warm'])
    expect(screen.getByText('Day 2 of 7')).toHaveClass('is-now')
    expect(screen.getByText(/^In 10 days/)).not.toHaveClass('is-now')
    expect(screen.getByText('No dates yet')).toBeInTheDocument()
    // The list-row anatomy: an icon circle, a name, a muted line, and a chevron.
    const row = screen.getByText('Lisbon & Porto').closest('.ant-list-item') as HTMLElement
    expect(row.querySelector('.list-icon')).toHaveTextContent('🧳')
    expect(row.querySelector('.list-row-caret')).not.toBeNull()
  })

  it('folds finished trips into one quiet line', async () => {
    seed(makeTrip(1, { title: 'Bruges day trip', start_date: rel(-60), end_date: rel(-60) }))
    seed(makeTrip(2, { title: 'Prague', start_date: rel(-40), end_date: rel(-35) }))
    renderTrips('/app/trips')
    const toggle = await screen.findByRole('button', { name: '2 past trips · Show' })
    expect(screen.queryByText('Bruges day trip')).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(await screen.findByText('Bruges day trip')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide past trips' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('says so, in the House voice, when there are no trips', async () => {
    renderTrips('/app/trips')
    expect(await screen.findByText('No trips yet. Where to first?')).toBeInTheDocument()
  })

  it('asks one thing to create a trip, then opens it', async () => {
    renderTrips('/app/trips')
    await userEvent.click(await screen.findByRole('button', { name: /New trip/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Name your trip' })
    expect(dialog.closest('.paper-modal')).not.toBeNull()
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1)
    // The field is focused as the dialog opens, so you can just type.
    await waitFor(() => expect(within(dialog).getByLabelText('Trip name')).toHaveFocus())
    const create = within(dialog).getByRole('button', { name: 'Create trip' })
    expect(create).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText('Trip name'), 'Autumn in Vienna{Enter}')
    expect(await screen.findByRole('heading', { name: 'Autumn in Vienna' })).toBeInTheDocument()
    expect(here()).toMatch(/^\/app\/trips\/trip_[0-9a-f]{32}$/)
    await waitFor(() => expect(tripServer.trips.size).toBe(1))
    const created = [...tripServer.trips.values()][0].fields
    expect(created.title).toBe('Autumn in Vienna')
    expect(created.start_date).toBeUndefined()
    expect(await screen.findByRole('heading', { name: 'Where to first?' })).toBeInTheDocument()
  })

  it('renames, opens settings and deletes (with Restore) from the row menu', async () => {
    seed(makeTrip(1, { title: 'Lisbon & Porto', start_date: rel(10), end_date: rel(12) }))
    renderTrips('/app/trips')
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Lisbon & Porto' }))
    // The row menu is a real menu.
    expect(await screen.findByRole('menuitem', { name: 'Trip settings' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    await userEvent.click(await screen.findByText('Rename'))
    const dialog = await screen.findByRole('dialog', { name: 'Rename trip' })
    const field = within(dialog).getByLabelText('Trip name')
    await userEvent.clear(field)
    await userEvent.type(field, 'Portugal{Enter}')
    await waitFor(() => expect([...tripServer.trips.values()][0].fields.title).toBe('Portugal'))

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Portugal' }))
    await userEvent.click(await screen.findByText('Delete'))
    expect(await screen.findByText(/Deleted Portugal/)).toBeInTheDocument()
    await waitFor(() => expect([...tripServer.trips.values()][0].deleted_by).toBeDefined())
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect([...tripServer.trips.values()][0].deleted_by).toBeUndefined())
  })

  it('opens trip settings from the row menu', async () => {
    seed(makeTrip(1, { title: 'Lisbon & Porto', start_date: rel(10), end_date: rel(12) }))
    renderTrips('/app/trips')
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Lisbon & Porto' }))
    await userEvent.click(await screen.findByText('Trip settings'))
    expect(await screen.findByLabelText('Trip name')).toBeInTheDocument()
    expect(here()).toMatch(/\/settings$/)
  })
})

describe('Lists pill', () => {
  it('ties a trip’s packing list to its trip, with the suitcase and a "For" line', async () => {
    meState.lists = [
      { list_id: 'l1', room_id: 'room_1', name: 'Groceries', icon: 'APPLE' },
      { list_id: 'list_packing', room_id: 'room_1', name: 'Packing · Lisbon & Porto' },
    ]
    renderTrips('/app')
    expect(await screen.findByText('For Lisbon & Porto')).toBeInTheDocument()
    const row = screen.getByText('For Lisbon & Porto').closest('.ant-list-item') as HTMLElement
    expect(within(row).getByText('Packing')).toBeInTheDocument()
    expect(row.querySelector('.list-icon')).toHaveTextContent('🧳')
    // The Lists pill is the same pill as everywhere else.
    expect(document.querySelector('.ant-tabs')).toBeNull()
  })
})
