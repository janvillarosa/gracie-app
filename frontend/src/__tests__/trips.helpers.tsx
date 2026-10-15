import React from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { AuthProvider } from '@auth/AuthProvider'
import { TripPage } from '@pages/TripPage'
import { Dashboard, TripsDashboard } from '@pages/Dashboard'
import { TripSettings } from '@pages/TripSettings'
import { UserSettings } from '@pages/UserSettings'
import type { Trip, TripTodo } from '@api/tripTypes'
import { wipeTripDatabases } from '@lib/trips/db'
import { resetTripStores } from '@lib/trips/store'
import { addDays, localDateKey } from '@lib/trips/schedule'
import { server, tripServer } from '../testServer'

export const ROOM = 'room_1'
export const ME = 'user_me'
export const MIA = 'user_mia'

export const todo = (id: string, title: string, p: Partial<TripTodo> = {}): TripTodo => ({
  todo_id: `ttd_${id.padStart(32, '0')}`,
  title,
  done: false,
  order: 1,
  category: 'sight',
  created_by: MIA,
  ...p,
})

export const makeTrip = (n: number, p: Partial<Trip> = {}): Trip => ({
  trip_id: `trip_${String(n).padStart(32, '0')}`,
  title: `Trip ${n}`,
  tz: 'Europe/Lisbon',
  todos: [],
  bookings: [],
  version: 1,
  ...p,
})

export const today = () => localDateKey()
export const rel = (n: number) => addDays(today(), n)

// The signed-in account's preferences, as the server holds them.
export const meState: {
  prefs: { trips_show_next_stop?: boolean }
  lists: Array<Record<string, unknown>>
  items: Array<Record<string, unknown>>
} = {
  prefs: { trips_show_next_stop: true },
  lists: [],
  items: [],
}

export function mockHouse() {
  const me = () => ({
    user_id: ME,
    name: 'Jan',
    room_id: ROOM,
    avatar_key: 'jan',
    preferences: { ...meState.prefs },
  })
  server.use(
    http.get('/api/me', () => HttpResponse.json(me())),
    http.put('/api/me', async ({ request }) => {
      const body = (await request.json()) as { preferences?: typeof meState.prefs }
      meState.prefs = { ...meState.prefs, ...body.preferences }
      return HttpResponse.json(me())
    }),
    http.get('/api/rooms/:roomId/lists', () => HttpResponse.json(meState.lists)),
    http.get('/api/rooms/:roomId/lists/:listId/items', () => HttpResponse.json(meState.items)),
    http.get('/api/rooms/me', () =>
      HttpResponse.json({
        display_name: 'The House',
        members: ['Jan', 'Mia'],
        members_meta: [
          { name: 'Jan', avatar_key: 'jan', user_id: ME },
          { name: 'Mia', avatar_key: 'mia', user_id: MIA },
        ],
      }),
    ),
  )
}

const Where: React.FC = () => <div data-testid="where">{useLocation().pathname}</div>

// Stands in for the List page: shows the router state a trip passed along.
const ListArrival: React.FC = () => (
  <div data-testid="arrival">{JSON.stringify(useLocation().state)}</div>
)

export function renderTrips(path: string) {
  localStorage.setItem('gracie_api_key', 'k_test')
  mockHouse()
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <Where />
          <Routes>
            <Route path="/app" element={<Dashboard />} />
            <Route path="/app/trips" element={<TripsDashboard />} />
            <Route path="/app/trips/:tripId/settings" element={<TripSettings />} />
            <Route path="/app/trips/:tripId" element={<TripPage />} />
            <Route path="/app/lists/:listId" element={<ListArrival />} />
            <Route path="/app/account" element={<UserSettings />} />
          </Routes>
        </QueryClientProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

/** Midday today on the wall clock: Date only (timers stay real). Fixtures are date-relative,
 *  so a test can never straddle midnight or depend on the hour it runs at. */
export function freezeClock() {
  vi.useFakeTimers({ toFake: ['Date'] })
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  vi.setSystemTime(d)
}

export async function resetTripsWorld() {
  vi.useRealTimers()
  await resetTripStores()
  tripServer.trips.clear()
  await wipeTripDatabases()
  sessionStorage.clear()
  meState.prefs = { trips_show_next_stop: true }
  meState.lists = []
  meState.items = []
  try {
    localStorage.removeItem('bauhouse_house_pill')
  } catch {}
  freezeClock()
}

export const seed = (t: Trip) => tripServer.seed(ROOM, t, MIA)

export function setViewport(
  kind: 'desktop' | 'phone' | 'tablet',
  opts: { reduceMotion?: boolean } = {},
) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion: reduce')
      ? !!opts.reduceMotion
      : kind === 'desktop'
        ? query.includes('min-width: 1024px')
        : kind === 'phone'
          ? query.includes('max-width: 1023px')
          : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

/** A nine-day-ish demo: two finished days, today, a day ahead, an empty day, ideas and bookings. */
export function lisbonTrip(): Trip {
  const day = (n: number) => rel(n)
  return makeTrip(1, {
    title: 'Lisbon & Porto',
    start_date: day(-2),
    end_date: day(2),
    days: { [day(-2)]: 'Arrival' },
    todos: [
      todo('1', 'Arrive and unpack', { day: day(-2), done: true, order: 1 }),
      todo('2', 'Castelo de São Jorge', {
        day: day(-1),
        done: true,
        order: 1,
        start_time: '10:00',
      }),
      todo('3', 'Lunch at Time Out Market', {
        day: day(-1),
        done: true,
        order: 2,
        start_time: '13:00',
      }),
      todo('4', 'Pena Palace', { day: day(0), order: 1, start_time: '10:15' }),
      todo('5', 'Lunch at Tascantiga', { day: day(0), order: 2, start_time: '12:30' }),
      todo('6', 'Pack the daypack', { day: day(0), order: 3 }),
      todo('7', 'Buy souvenirs', { day: day(0), order: 4 }),
      todo('8', 'Jerónimos Monastery', { day: day(1), order: 1, start_time: '10:00' }),
      todo('9', 'Ginjinha tasting', { day: null, order: 1 }),
      todo('10', 'Day trip to Cascais', { day: null, order: 2 }),
    ],
    bookings: [
      {
        booking_id: `tbk_${'1'.padStart(32, '0')}`,
        kind: 'flight',
        title: 'London to Lisbon',
        confirmation_code: 'TP1355',
        starts_at: `${day(-2)}T07:05`,
        start_tz: 'Europe/London',
        ends_at: `${day(-2)}T09:40`,
        end_tz: 'Europe/Lisbon',
        created_by: MIA,
      },
    ],
  })
}
