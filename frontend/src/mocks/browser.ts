// Dev-only: runs the trips contract in the browser so the app works without the Go backend.
// Enabled by VITE_MOCK_TRIPS=1 (see main.tsx); never part of a production build.
import { getResponse, http, HttpResponse } from 'msw'
import { setupWorker } from 'msw/browser'
import { localDateKey } from '../lib/trips/schedule'
import { tripHandlers } from './handlers'
import { buildSeedTrips, ME, MIA, type Phase } from './seed'
import { MockTripServer } from './tripsServer'

const ROOM = 'room_mock'

function phaseFromUrl(): Phase {
  const q = new URLSearchParams(window.location.search).get('mockPhase')
  const have = sessionStorage.getItem('mock_phase')
  const v = (q ?? have ?? 'during') as Phase
  const phase: Phase = ['before', 'during', 'after'].includes(v) ? v : 'during'
  sessionStorage.setItem('mock_phase', phase)
  return phase
}

export async function startMockTrips() {
  // Snapshots from an earlier mock run would disagree with the fresh in-memory server.
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase('bauhouse-trips')
    r.onsuccess = r.onerror = r.onblocked = () => resolve()
  })
  localStorage.setItem('gracie_api_key', 'mock-api-key')

  const srv = new MockTripServer()
  srv.me = ME
  const phase = phaseFromUrl()
  for (const t of buildSeedTrips(localDateKey(), phase)) srv.seed(ROOM, t, MIA)
  ;(window as unknown as { __mockTrips: MockTripServer }).__mockTrips = srv

  const now = new Date().toISOString()
  const prefs = { trips_show_next_stop: true }
  const user = () => ({ ...userBase, preferences: { ...prefs } })
  const userBase = {
    user_id: ME,
    name: 'Jan',
    username: 'jan',
    room_id: ROOM,
    avatar_key: 'jan',
    created_at: now,
    updated_at: now,
  }
  const lists = [
    {
      list_id: 'list_groceries',
      room_id: ROOM,
      name: 'Groceries',
      icon: 'APPLE',
      is_deleted: false,
      created_at: now,
      updated_at: now,
    },
    {
      list_id: srv.listId,
      room_id: ROOM,
      name: 'Packing · Lisbon & Porto',
      is_deleted: false,
      created_at: now,
      updated_at: now,
    },
  ]
  const handlers = [
    ...tripHandlers(srv, { latencyMs: 80 }),
    http.get('/api/me', () => HttpResponse.json(user())),
    http.put('/api/me', async ({ request }) => {
      const body = (await request.json()) as { preferences?: { trips_show_next_stop?: boolean } }
      if (body.preferences?.trips_show_next_stop !== undefined)
        prefs.trips_show_next_stop = body.preferences.trips_show_next_stop
      return HttpResponse.json(user())
    }),
    http.get('/api/rooms/me', () =>
      HttpResponse.json({
        display_name: 'The Villarosa House (synthetic)',
        members: ['Jan', 'Mia'],
        members_meta: [
          { name: 'Jan', avatar_key: 'jan', user_id: ME },
          { name: 'Mia', avatar_key: 'mia', user_id: MIA },
        ],
        created_at: now,
        updated_at: now,
      }),
    ),
    http.get('/api/rooms/:roomId/lists', () => HttpResponse.json(lists)),
    http.get('/api/rooms/:roomId/pantry', () => HttpResponse.json([])),
    http.get('/api/rooms/:roomId/lists/:listId/items', ({ params }) =>
      HttpResponse.json(
        params.listId === srv.listId
          ? ['Passport', 'Charger', 'Sun cream', 'Walking shoes'].map((description, i) => ({
              item_id: `item_pack_${i}`,
              list_id: srv.listId,
              room_id: ROOM,
              description,
              completed: false,
              order: i + 1,
              created_at: now,
              updated_at: now,
            }))
          : [],
      ),
    ),
  ]
  try {
    await setupWorker(...handlers).start({ onUnhandledRequest: 'bypass', quiet: true })
  } catch {
    // Some embedded browsers refuse service workers: answer /api calls from the same handlers
    // by wrapping fetch instead.
    const real = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const req = new Request(input, init)
      if (new URL(req.url, window.location.origin).pathname.startsWith('/api/')) {
        const res = await getResponse(handlers, req)
        if (res) return res
      }
      return real(input, init)
    }
  }
}
