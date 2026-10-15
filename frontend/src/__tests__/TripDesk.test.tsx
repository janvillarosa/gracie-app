import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Booking } from '@api/tripTypes'
import { nights, readiness, uncoveredNights } from '@lib/trips/readiness'
import { buildSchedule } from '@lib/trips/schedule'
import { phaseFrom, resetMockPersistence } from '../mocks/browser'
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
  todo,
} from './trips.helpers'

const open = (id: string) => renderTrips(`/app/trips/${id}`)
const bk = (n: number, p: Partial<Booking>): Booking => ({
  booking_id: `tbk_${String(n).padStart(32, '0')}`,
  kind: 'ticket',
  title: `Booking ${n}`,
  created_by: MIA,
  ...p,
})
const place = { name: 'Tasca', lat: 38.78, lng: -9.39, source: 'photon' as const }

beforeEach(async () => {
  await resetTripsWorld()
  Element.prototype.scrollIntoView = vi.fn()
  meState.lists = []
  meState.items = []
})
afterEach(async () => {
  vi.restoreAllMocks()
  await resetTripsWorld()
})

describe('the planning desk layout', () => {
  const ghent = () =>
    makeTrip(5, {
      title: 'Weekend in Ghent',
      start_date: rel(40),
      end_date: rel(42),
      todos: [todo('1', 'Gravensteen', { day: null }), todo('2', 'Frites', { day: null })],
    })

  it('is three columns at 1280: Ideas, Days, Map', async () => {
    setViewport('desktop')
    const t = ghent()
    t.todos[0] = { ...t.todos[0], place }
    seed(t)
    open(t.trip_id)
    await screen.findByRole('heading', { name: 'Weekend in Ghent' })
    const shell = document.querySelector('.trip-shell') as HTMLElement
    expect(shell).toHaveClass('is-desk', 'has-map')
    const kids = [...shell.children].map((c) => c.className)
    expect(kids[0]).toContain('trip-ideas-col')
    expect(kids[1]).toContain('trip-days-col')
    expect(kids[2]).toContain('trip-side')
    // Ideas is a column, so the pills are Plan and Bookings.
    expect(screen.getAllByRole('tab').map((x) => x.textContent)).toEqual(['Plan', 'Bookings'])
    const col = document.querySelector('.trip-ideas-col') as HTMLElement
    expect(within(col).getByText('Ideas · 2')).toBeInTheDocument()
    expect(within(col).getByText('Drag onto a day')).toBeInTheDocument()
  })

  it('is one paper stack: the header with its band, then the plan sheet; the add bar floats', async () => {
    setViewport('desktop')
    const t = ghent()
    seed(t)
    open(t.trip_id)
    await screen.findByRole('heading', { name: 'Weekend in Ghent' })
    const stack = document.querySelector('.trip-days-col .paper-stack') as HTMLElement
    const top = stack.querySelector('.paper-meta') as HTMLElement
    const plan = stack.querySelector('.paper-list') as HTMLElement
    expect(top.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Ready to go? is the band inside the header sheet, not a card of its own.
    const band = top.querySelector('.trip-head-band') as HTMLElement
    expect(within(band).getByRole('region', { name: 'Ready to go?' })).toBeInTheDocument()
    // The add bar is a floating composer, never inside the sheet.
    expect(plan.querySelector('.add-bar')).toBeNull()
    const composer = document.querySelector('.trip-composer') as HTMLElement
    expect(composer.querySelector('.add-bar')).not.toBeNull()
    expect(screen.getByPlaceholderText('Add a place, plan or idea')).toBeInTheDocument()
    // One row: icon, title over the day line, avatars, menu.
    const row = top.querySelector('.trip-desk-head') as HTMLElement
    expect(
      [...row.children].map((c) => c.className.split(' ')[0].replace(/^list-icon$/, 'icon')),
    ).toEqual(['icon', 'trip-desk-text', 'trip-avatars', 'ui-btn'])
  })

  it('has no map column without places: the plan widens and says where places will show up', async () => {
    setViewport('desktop')
    const t = ghent()
    seed(t)
    open(t.trip_id)
    await screen.findByRole('heading', { name: 'Weekend in Ghent' })
    expect(document.querySelector('.trip-shell')).not.toHaveClass('has-map')
    expect(screen.queryByTestId('trip-map-pane')).not.toBeInTheDocument()
    expect(screen.getByText('Places you add show up on a map.')).toBeInTheDocument()
    expect(screen.queryByText('Map preview')).not.toBeInTheDocument()
    expect(document.querySelector('.trip-ideas-col')).not.toBeNull()
  })

  it('is two columns at 1100: Ideas and Days, with the map in a dialog from the Map pill', async () => {
    setViewport('mid')
    const t = ghent()
    t.todos[0] = { ...t.todos[0], place }
    seed(t)
    open(t.trip_id)
    await screen.findByRole('heading', { name: 'Weekend in Ghent' })
    const shell = document.querySelector('.trip-shell') as HTMLElement
    expect(shell).toHaveClass('is-desk')
    expect(shell).not.toHaveClass('has-map')
    expect(document.querySelector('.trip-side')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Show map for/ }))
    // The one overlay: a dialog with a scrim that closes with Esc.
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(document.querySelector('.ui-dialog')).not.toBeNull()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows every date of a trip with nothing planned, each as a slot', async () => {
    setViewport('desktop')
    const t = makeTrip(6, { title: 'Quiet days', start_date: rel(20), end_date: rel(22) })
    seed(t)
    open(t.trip_id)
    await screen.findByRole('heading', { name: 'Quiet days' })
    // Three dates, three slots; not the "Where to first?" prompt.
    await waitFor(() =>
      expect(document.querySelectorAll('.trip-days-col .trip-empty-row')).toHaveLength(3),
    )
    expect(screen.queryByRole('heading', { name: 'Where to first?' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Nothing planned yet')).toHaveLength(3)
    // The Ideas column says its own thing.
    expect(
      within(document.querySelector('.trip-ideas-col') as HTMLElement).getByText(
        'Nothing here yet',
      ),
    ).toBeInTheDocument()
  })

  it('keeps the first-step prompts when there are no dates', async () => {
    setViewport('desktop')
    const t = makeTrip(7, { title: 'Draft' })
    seed(t)
    open(t.trip_id)
    expect(await screen.findByRole('heading', { name: 'Where to first?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'When are you going?' })).toBeInTheDocument()
  })

  it('moves an idea onto a day from its row, and a day item back to Ideas', async () => {
    setViewport('desktop')
    const t = lisbonTrip()
    seed(t)
    open(t.trip_id)
    const col = (await screen.findByRole('complementary', { name: 'Ideas' })) as HTMLElement
    const row = (await within(col).findByText('Ginjinha tasting')).closest('li') as HTMLElement
    const add = within(row).getByRole('button', { name: 'Add Ginjinha tasting to a day' })
    add.focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.click(
      await screen
        .findByRole('menuitem', { name: new RegExp(rel(1).slice(8)) })
        .catch(() => screen.findAllByRole('menuitem').then((m) => m[1])),
    )
    await waitFor(() => {
      const moved = tripServer.trips
        .get(t.trip_id)
        ?.todos.find((x) => x.title === 'Ginjinha tasting')
      expect(moved?.day).toBeTruthy()
    })
    // It left the Ideas column and is in the days now.
    await waitFor(() => expect(within(col).queryByText('Ginjinha tasting')).not.toBeInTheDocument())
    expect(document.querySelector('.trip-days-col')).toHaveTextContent('Ginjinha tasting')
  })
})

describe('Ready to go?', () => {
  const trip = (over: Parameters<typeof makeTrip>[1] = {}) =>
    makeTrip(8, {
      title: 'Ghent',
      start_date: rel(10),
      end_date: rel(12),
      icon: 'TRAIN',
      ...over,
    })
  const stay = (from: number, to: number) =>
    bk(1, {
      kind: 'stay',
      title: 'Hotel',
      starts_at: `${rel(from)}T15:00`,
      ends_at: `${rel(to)}T11:00`,
    })
  const train = bk(2, { kind: 'train', title: 'Train to Ghent', starts_at: `${rel(10)}T09:00` })

  it('counts a night as covered from the stay’s start day up to, not including, its end day', () => {
    const t = trip({ bookings: [stay(10, 11)] })
    expect(nights(t)).toEqual([rel(10), rel(11)])
    expect(uncoveredNights(t)).toEqual([rel(11)])
    expect(uncoveredNights(trip({ bookings: [stay(10, 12)] }))).toEqual([])
    expect(uncoveredNights(trip({ bookings: [] }))).toEqual([rel(10), rel(11)])
  })

  it('reads travel, stays, empty days and packing as lines with their fix', () => {
    const t = trip({ bookings: [train, stay(10, 11)], todos: [todo('1', 'x', { day: rel(10) })] })
    const lines = readiness(t, buildSchedule(t).days, { listId: 'l', packed: 3, total: 12 })
    const by = (k: string) => lines.find((l) => l.key === k)
    expect(by('travel')).toMatchObject({ ok: true, text: 'Train to Ghent booked' })
    expect(by('stays')).toMatchObject({ ok: false, date: rel(11) })
    expect(by('stays')?.text).toMatch(/^No stay for /)
    expect(by('days')).toMatchObject({ ok: false, text: '2 days still empty', date: rel(11) })
    expect(by('packing')).toMatchObject({ ok: false, text: '3 of 12 packed' })
    expect(readiness(t, [], { listId: null }).find((l) => l.key === 'packing')?.fix?.label).toBe(
      'Make a packing list',
    )
  })

  it('shows the lines above the days, each with a button that fixes it', async () => {
    setViewport('desktop')
    const t = trip({ bookings: [train], todos: [todo('1', 'Gravensteen', { day: rel(10) })] })
    seed(t)
    open(t.trip_id)
    const ready = await screen.findByRole('region', { name: 'Ready to go?' })
    expect(within(ready).getByText('Train to Ghent booked')).toBeInTheDocument()
    // Every line is one size; the fixes are the system's text buttons.
    expect(within(ready).getByRole('button', { name: 'Add a stay' })).toHaveClass(
      'ui-btn',
      'is-text',
    )
    expect(within(ready).getByText(/^No stay for /)).toBeInTheDocument()
    expect(within(ready).getByText('2 days still empty')).toBeInTheDocument()
    expect(within(ready).getByText('No packing list yet')).toBeInTheDocument()
    // Not the Next stop card: that is for during the trip.
    expect(screen.queryByRole('region', { name: 'Next stop' })).not.toBeInTheDocument()
    await userEvent.click(within(ready).getByRole('button', { name: 'Add a stay' }))
    expect(await screen.findByRole('dialog', { name: 'New booking' })).toBeInTheDocument()
  })

  it('folds to one line when everything is done, and opens again for the details', async () => {
    setViewport('desktop')
    meState.lists = [
      { list_id: 'list_packing', room_id: 'room_1', name: 'Packing', is_deleted: false },
    ]
    meState.items = [{ item_id: 'i1', completed: true }]
    const t = trip({
      packing_list_id: 'list_packing',
      bookings: [train, stay(10, 12)],
      todos: [
        todo('1', 'One', { day: rel(10) }),
        todo('2', 'Two', { day: rel(11) }),
        todo('3', 'Three', { day: rel(12) }),
      ],
    })
    seed(t)
    open(t.trip_id)
    const ready = await screen.findByRole('region', { name: 'Ready to go?' })
    await waitFor(() => expect(within(ready).getByText('Ready to go')).toBeInTheDocument())
    expect(within(ready).queryByText('Train to Ghent booked')).not.toBeInTheDocument()
    await userEvent.click(within(ready).getByRole('button', { name: 'Details' }))
    expect(await within(ready).findByText('Train to Ghent booked')).toBeInTheDocument()
  })

  it('is replaced by the Next stop card during the trip, and is absent after it', async () => {
    setViewport('desktop')
    const during = lisbonTrip()
    seed(during)
    open(during.trip_id)
    const next = await screen.findByRole('region', { name: 'Next stop' })
    // The deck takes the header sheet's band: no card of its own.
    expect(next.closest('.trip-head-band')).not.toBeNull()
    expect(next.closest('.ant-card.trip-deck')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Ready to go?' })).not.toBeInTheDocument()
  })

  it('is not on a phone', async () => {
    setViewport('phone')
    const t = trip({ bookings: [train] })
    seed(t)
    open(t.trip_id)
    await screen.findByRole('heading', { name: 'Ghent' })
    expect(screen.queryByRole('region', { name: 'Ready to go?' })).not.toBeInTheDocument()
  })
})

describe('the dev mock phase', () => {
  it('reads ?mockPhase, keeps the last one without it, and defaults to during', () => {
    expect(phaseFrom('?mockPhase=before', 'after')).toBe('before')
    expect(phaseFrom('', 'after')).toBe('after')
    expect(phaseFrom('?mockPhase=nonsense', null)).toBe('during')
    expect(phaseFrom('', null)).toBe('during')
  })

  it('re-seeds from scratch: every trips database, including the signed-in user’s, is deleted', async () => {
    const name = 'bauhouse-trips-user_jan'
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open(name, 1)
      r.onupgradeneeded = () => r.result.createObjectStore('trips')
      r.onsuccess = () => {
        r.result.close()
        resolve()
      }
      r.onerror = () => reject(r.error)
    })
    expect((await indexedDB.databases()).map((d) => d.name)).toContain(name)
    await resetMockPersistence()
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(name)
  })
})
