import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthProvider, useAuth } from '@auth/AuthProvider'
import { useTripStoreFor } from '@lib/trips/hooks'
import { getPendingOnLogout, resetTripStores, type TripStore } from '@lib/trips/store'
import { wipeTripDatabases } from '@lib/trips/db'
import { server } from '../testServer'

const ROOM = 'room_1'
const USER = 'user_expired'

let store: TripStore | null = null
const Probe: React.FC = () => {
  const { apiKey } = useAuth()
  store = useTripStoreFor(ROOM, USER, apiKey)
  return <div>trips screen</div>
}

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/app/trips']}>
      <AuthProvider>
        <QueryClientProvider client={new QueryClient()}>
          <Routes>
            <Route path="/login" element={<div>login page</div>} />
            <Route path="*" element={<Probe />} />
          </Routes>
        </QueryClientProvider>
      </AuthProvider>
    </MemoryRouter>,
  )

afterEach(async () => {
  store = null
  await resetTripStores()
  await wipeTripDatabases()
  localStorage.clear()
})

describe('CR-3: a refused key on a trips request signs the user out', () => {
  it('goes to /login, clears the key and keeps the queued changes on the device', async () => {
    localStorage.setItem('gracie_api_key', 'stale')
    // The server refuses the key only once the op is queued and stored. Otherwise the first
    // sync (the store starts on mount) can be refused before the op exists, and the sign-out
    // then finds nothing to keep: a race that only showed under load.
    let open: () => void = () => {}
    const queued = new Promise<void>((resolve) => {
      open = resolve
    })
    server.use(
      http.get('/api/me', () => HttpResponse.json({ user_id: USER, room_id: ROOM })),
      http.post('/api/rooms/:roomId/trips/sync', async () => {
        await queued
        return HttpResponse.json({ error: 'unauthorized' }, { status: 401 })
      }),
      http.post('/api/rooms/:roomId/trips/ops', async () => {
        await queued
        return HttpResponse.json({ error: 'unauthorized' }, { status: 401 })
      }),
    )
    mount()
    await waitFor(() => expect(store).not.toBeNull())
    const s = store as unknown as TripStore
    await s.hydrate()
    s.createTrip({ title: 'Typed offline' })
    await s.settle()
    open()
    await screen.findByText('login page', {}, { timeout: 5000 })
    expect(localStorage.getItem('gracie_api_key')).toBeNull()
    // Same rule as an ordinary sign-out: unsent changes are kept, not wiped.
    await waitFor(() => expect(getPendingOnLogout()).toBe(1))
    expect((await indexedDB.databases()).map((d) => d.name)).toContain(`bauhouse-trips-${USER}`)
  })
})
