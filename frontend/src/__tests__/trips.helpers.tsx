import React from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { AuthProvider } from '@auth/AuthProvider'
import { TripPage } from '@pages/TripPage'
import { TripsIndex } from '@pages/TripsIndex'
import type { Trip, TripTodo } from '@api/tripTypes'
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

export function mockHouse() {
  server.use(
    http.get('/api/me', () =>
      HttpResponse.json({ user_id: ME, name: 'Jan', room_id: ROOM, avatar_key: 'jan' }),
    ),
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
            <Route path="/app" element={<div>House page</div>} />
            <Route path="/app/trips" element={<TripsIndex />} />
            <Route path="/app/trips/:tripId" element={<TripPage />} />
          </Routes>
        </QueryClientProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

export async function resetTripsWorld() {
  resetTripStores()
  tripServer.trips.clear()
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase('bauhouse-trips')
    r.onsuccess = r.onerror = r.onblocked = () => resolve()
  })
  sessionStorage.clear()
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
          ? query.includes('max-width: 767px')
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
