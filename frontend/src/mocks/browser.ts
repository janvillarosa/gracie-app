// Dev-only: runs the trips contract in the browser so the app works without the Go backend.
// Enabled by VITE_MOCK_TRIPS=1 (see main.tsx); never part of a production build.
import { getResponse, HttpResponse, http } from 'msw'
import { setupWorker } from 'msw/browser'
import { wipeTripDatabase, wipeTripDatabases } from '../lib/trips/db'
import { localDateKey } from '../lib/trips/schedule'
import { tripHandlers } from './handlers'
import { buildSeedTrips, ME, MIA, type Phase } from './seed'
import { MockTripServer } from './tripsServer'

const ROOM = 'room_mock'

/** `?mockPhase=before|during|after` picks the seed's phase; without it the last one stays (per
 *  tab), and the default is "during". */
export function phaseFrom(search: string, have: string | null): Phase {
  const q = new URLSearchParams(search).get('mockPhase')
  const v = (q ?? have ?? 'during') as Phase
  return ['before', 'during', 'after'].includes(v) ? v : 'during'
}

/** Snapshots and queued changes from an earlier mock run would disagree with the fresh in-memory
 *  server (and hide a new phase): delete every trips database, the signed-in mock user's included. */
export async function resetMockPersistence(): Promise<void> {
  await wipeTripDatabases()
  await wipeTripDatabase(ME)
  await new Promise<void>((resolve) => {
    // The pre-per-user name, from the first mock builds.
    const r = indexedDB.deleteDatabase('bauhouse-trips')
    r.onsuccess = r.onerror = r.onblocked = () => resolve()
  })
}

function phaseFromUrl(): Phase {
  const phase = phaseFrom(window.location.search, sessionStorage.getItem('mock_phase'))
  sessionStorage.setItem('mock_phase', phase)
  return phase
}

export async function startMockTrips() {
  await resetMockPersistence()
  localStorage.setItem('gracie_api_key', 'mock-api-key')

  const srv = new MockTripServer()
  srv.me = ME
  const phase = phaseFromUrl()
  for (const t of buildSeedTrips(localDateKey(), phase)) srv.seed(ROOM, t, MIA)
  ;(window as unknown as { __mockTrips: MockTripServer }).__mockTrips = srv

  const now = new Date().toISOString()
  srv.memberOf = ROOM
  srv.members = [
    { user_id: ME, name: 'Jan', avatar_key: 'jan' },
    { user_id: MIA, name: 'Mia', avatar_key: 'mia' },
  ]
  const user = () => ({ ...userBase, ...srv.getMe() })
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
  let ignored = false
  const handlers = [
    ...tripHandlers(srv, { latencyMs: 80 }),
    http.get('/api/me', () => HttpResponse.json(user())),
    http.put('/api/me', async ({ request }) => {
      const r = srv.putMe(await request.json().catch(() => null))
      return r.status === 204
        ? new HttpResponse(null, { status: 204 })
        : HttpResponse.json(r.body, { status: 400 })
    }),
    http.get('/api/rooms/me', () =>
      HttpResponse.json({
        display_name: 'The Villarosa House (synthetic)',
        members: ['Jan', 'Mia'],
        members_meta: srv.membersMeta(),
        created_at: now,
        updated_at: now,
      }),
    ),
    http.get('/api/rooms/:roomId/lists', () => HttpResponse.json(lists)),
    http.get('/api/rooms/:roomId/pantry', () => HttpResponse.json([])),
    http.get('/api/rooms/:roomId/lists/:listId/items', ({ params }) => {
      const pack = params.listId === srv.listId
      const names = pack
        ? ['Passport', 'Charger', 'Sun cream', 'Walking shoes']
        : ['Oregano', 'Dill plant']
      return HttpResponse.json(
        names.map((description, i) => ({
          item_id: `item_${pack ? 'pack' : 'groc'}_${i}`,
          list_id: params.listId,
          room_id: ROOM,
          description,
          completed: false,
          order: i + 1,
          created_at: now,
          updated_at: now,
        })),
      )
    }),
    // One smart suggestion on Groceries, so the slip above the items can be seen in dev.
    http.get('/api/rooms/:roomId/lists/:listId/suggestions', ({ params }) =>
      HttpResponse.json({
        suggestions:
          params.listId === 'list_groceries' && !ignored
            ? [
                {
                  key: 'cherry tomatoes',
                  description: 'Cherry tomatoes',
                  every_days: 7,
                  score: 0.9,
                },
              ]
            : [],
      }),
    ),
    http.post('/api/rooms/:roomId/lists/:listId/suggestions/ignore', () => {
      ignored = true
      return new HttpResponse(null, { status: 204 })
    }),
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
