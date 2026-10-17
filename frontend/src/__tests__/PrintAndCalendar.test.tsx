import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@auth/AuthProvider'
import { ListPage } from '@pages/ListPage'
import { fullDay } from '@lib/trips/schedule'
import { server } from '../testServer'
import {
  makeTrip,
  rel,
  renderTrips,
  resetTripsWorld,
  seed,
  setViewport,
  todo,
} from './trips.helpers'

const printSheet = () => document.querySelector('.print-sheet') as HTMLElement | null
const firePrint = (type: 'beforeprint' | 'afterprint') =>
  act(() => {
    window.dispatchEvent(new Event(type))
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

const TRIP = makeTrip(7, {
  title: 'Lisbon & Porto',
  start_date: rel(5),
  end_date: rel(6),
  days: { [rel(5)]: 'Alfama' },
  todos: [
    todo('1', 'Castle walk', { day: rel(5), start_time: '10:00', duration_min: 90 }),
    todo('2', 'Pastéis', { day: rel(5), order: 2 }),
  ],
  bookings: [
    {
      booking_id: `tbk_${'1'.padStart(32, '0')}`,
      kind: 'flight',
      title: 'TP1355',
      confirmation_code: 'XK42LP',
      starts_at: `${rel(5)}T07:05`,
      start_tz: 'Europe/Lisbon',
    },
    {
      booking_id: `tbk_${'2'.padStart(32, '0')}`,
      kind: 'stay',
      title: 'Alfama flat',
      confirmation_code: 'STAY99',
      starts_at: `${rel(5)}T15:00`,
      ends_at: `${rel(6)}T11:00`,
      place: {
        source: 'manual',
        name: 'Alfama flat',
        address: 'Rua de São Tomé 12',
        lat: 1,
        lng: 2,
      },
    },
  ],
})

describe('Trip menu: calendar and print', () => {
  it('downloads the trip as an .ics file', async () => {
    const blobs: Blob[] = []
    const create = vi.fn((b: Blob) => {
      blobs.push(b)
      return 'blob:trip'
    })
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    seed(TRIP)
    renderTrips(`/app/trips/${TRIP.trip_id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'More trip options' }))
    await userEvent.click(await screen.findByText('Add to calendar'))
    expect(click).toHaveBeenCalledTimes(1)
    const a = click.mock.instances[0] as unknown as HTMLAnchorElement
    expect(a.download).toBe('lisbon-porto.ics')
    // jsdom's Blob has no text(): read it the old way.
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.readAsText(blobs[0])
    })
    expect(text).toContain('SUMMARY:Lisbon & Porto')
    expect(text).toContain('SUMMARY:TP1355')
    expect(text).not.toContain('XK42LP')
  })

  it('has no calendar row for a trip without dates', async () => {
    seed(makeTrip(8, { title: 'Someday' }))
    renderTrips(`/app/trips/${makeTrip(8).trip_id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'More trip options' }))
    expect(await screen.findByText('Print')).toBeInTheDocument()
    expect(screen.queryByText('Add to calendar')).not.toBeInTheDocument()
  })

  it('prints a formal itinerary: summary, transport, stays, then day by day', async () => {
    const print = vi.fn()
    window.print = print
    seed(TRIP)
    renderTrips(`/app/trips/${TRIP.trip_id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'More trip options' }))
    expect(printSheet()).toBeNull()
    await userEvent.click(await screen.findByText('Print'))
    expect(print).toHaveBeenCalledTimes(1)

    firePrint('beforeprint')
    const sheet = printSheet() as HTMLElement
    expect(sheet).not.toBeNull()
    expect(sheet.parentElement).toBe(document.body)
    const p = within(sheet)
    expect(p.getByText('Travel itinerary')).toBeInTheDocument()
    // The closing line (all Safari shows) names the site; it is hardcoded, not the page's host.
    expect(p.getByText('Prepared with Bauhouse · bauhouse.app')).toBeInTheDocument()
    // The footer carries the site's address, not the trip's link.
    expect(sheet.querySelector('style')?.textContent).toContain(window.location.host)
    expect(sheet.querySelector('style')?.textContent).not.toContain(TRIP.trip_id)
    expect(p.getByRole('heading', { level: 1, name: 'Lisbon & Porto' })).toBeInTheDocument()

    // The summary
    const facts = Object.fromEntries(
      Array.from(sheet.querySelectorAll('.print-fact')).map((f) => [
        f.querySelector('dt')?.textContent,
        f.querySelector('dd')?.textContent,
      ]),
    )
    expect(Object.keys(facts)).toEqual(['Travel dates', 'Duration', 'Prepared by', 'Prepared on'])
    expect(facts['Duration']).toBe('2 days, 1 night')
    expect(facts['Travel dates']).toMatch(/ 20\d\d to .* 20\d\d$/)

    // The sections, numbered by CSS, in order
    expect(p.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Transport',
      'Accommodation',
      'Day-by-day itinerary',
    ])
    const rows = (title: string) =>
      within(p.getByRole('heading', { level: 2, name: title }).parentElement as HTMLElement)
        .getAllByRole('row')
        .map((r) => Array.from(r.children).map((c) => c.textContent))
    const [head, flight] = rows('Transport')
    // No booking has a route, so the column is left out.
    expect(head).toEqual(['Departs', 'Arrives', 'Booking'])
    expect(flight).toEqual([`${fullDay(rel(5))}, 07:05`, '–', 'TP1355Flight'])
    const [stayHead, stay] = rows('Accommodation')
    expect(stayHead).toEqual(['Property', 'Location', 'Check-in', 'Check-out', 'Nights'])
    expect(stay).toEqual([
      'Alfama flat',
      'Alfama flat, Rua de São Tomé 12',
      `${fullDay(rel(5))}, 15:00`,
      `${fullDay(rel(6))}, 11:00`,
      '1',
    ])

    // The plan
    const day = p.getByRole('heading', { level: 3, name: `Day 1 · ${fullDay(rel(5))} · Alfama` })
    expect(
      within(day.parentElement as HTMLElement)
        .getAllByRole('row')
        .map((r) => r.textContent),
    ).toEqual([
      '07:05TP1355',
      '10:00–11:30Castle walk',
      '15:00Alfama flatAlfama flat, Rua de São Tomé 12',
      'Pastéis',
    ])
    expect(
      p.getByRole('heading', { level: 3, name: `Day 2 · ${fullDay(rel(6))}` }),
    ).toBeInTheDocument()
    expect(p.getByText('Nothing planned')).toBeInTheDocument()
    expect(p.getByText('All times are local to the place they refer to.')).toBeInTheDocument()

    // Private things never reach paper
    expect(sheet.textContent).not.toContain('XK42LP')
    expect(sheet.textContent).not.toContain('STAY99')

    firePrint('afterprint')
    expect(printSheet()).toBeNull()
  })
})

describe('Trips pill countdown', () => {
  it('says how many days until a trip a week or less away', async () => {
    seed(TRIP)
    renderTrips('/app')
    const tab = await screen.findByRole('tab', { name: 'Trips, next one in 5 days' })
    expect(tab.textContent).toBe('Trips · 5d')
  })

  it('stays quiet for a trip further away', async () => {
    seed(makeTrip(9, { start_date: rel(12), end_date: rel(14) }))
    renderTrips('/app')
    const tabs = await screen.findByRole('tablist', { name: 'House sections' })
    // The trip loads after the pills; give it the chance to (wrongly) show.
    await screen.findByRole('tab', { name: 'Trips' })
    await waitFor(() =>
      expect(within(tabs).getByRole('tab', { name: 'Trips' }).textContent).toBe('Trips'),
    )
  })
})

describe('List menu: print', () => {
  const roomId = 'room-1'
  const listId = 'list-1'
  const item = (id: string, description: string, p: Record<string, unknown> = {}) => ({
    item_id: id,
    list_id: listId,
    room_id: roomId,
    description,
    completed: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...p,
  })
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  it('prints what is still to get, by category, with checked items left off', async () => {
    const print = vi.fn()
    window.print = print
    localStorage.setItem('gracie_api_key', 'test-key')
    server.use(
      http.get('/api/me', () => json({ user_id: 'u1', name: 'Alice', room_id: roomId })),
      http.get(`/api/rooms/${roomId}/lists`, () =>
        json([
          {
            list_id: listId,
            room_id: roomId,
            name: 'Groceries',
            description: '',
            notes: '',
            icon: 'APPLE',
            deletion_votes: {},
            is_deleted: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]),
      ),
      http.get(`/api/rooms/${roomId}/lists/${listId}/items`, () =>
        json([
          item('i1', 'Milk', { category: 'Dairy', quantity: '2', order: 1 }),
          item('i2', 'Apples', { category: 'Produce', order: 2 }),
          item('i3', 'Bread', { category: 'Bakery', completed: true, order: 3 }),
        ]),
      ),
    )
    render(
      <MemoryRouter initialEntries={[`/app/lists/${listId}`]}>
        <AuthProvider>
          <QueryClientProvider client={new QueryClient()}>
            <Routes>
              <Route path="/app/lists/:listId" element={<ListPage />} />
            </Routes>
          </QueryClientProvider>
        </AuthProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Apples')
    await userEvent.click(screen.getByRole('button', { name: 'More list actions' }))
    await userEvent.click(await screen.findByText('Print'))
    expect(print).toHaveBeenCalledTimes(1)

    firePrint('beforeprint')
    const p = within(printSheet() as HTMLElement)
    expect(p.getByRole('heading', { level: 1, name: 'Groceries' })).toBeInTheDocument()
    expect(p.getByText(/^2 to get · .*Printed .* 20\d\d$/)).toBeInTheDocument()
    expect(p.getByText('List')).toBeInTheDocument()
    expect(p.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Dairy',
      'Produce',
    ])
    expect(p.getByText('2 Milk')).toBeInTheDocument()
    expect(p.queryByText('Bread')).not.toBeInTheDocument()
    firePrint('afterprint')
  })
})
