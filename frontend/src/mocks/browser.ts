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
  // Groceries carries stamps, amounts and a long name, so narrow layouts can be checked. Adds
  // are kept, so taking a suggestion shows up in the list.
  type Row = { description: string; category?: string; quantity?: string; unit?: string }
  const groceries: Row[] = [
    { description: 'Oregano', category: 'Produce' },
    { description: 'Dill plant', category: 'Produce' },
    { description: 'Oat milk', category: 'Dairy', quantity: '2', unit: 'L' },
    { description: 'Sourdough loaf from the corner bakery', category: 'Bakery' },
    { description: 'Kitchen roll', category: 'Household', quantity: '4' },
    { description: 'Basmati rice', quantity: '1', unit: 'kg' },
  ]
  // A queue of suggestions, so the hand-off between slips (and the slot closing after the
  // last) can be seen. Taking or ignoring one moves to the next.
  const suggestionQueue = [
    { key: 'cherry tomatoes', description: 'Cherry tomatoes', every_days: 7, score: 0.9 },
    { key: 'greek yogurt', description: 'Greek yogurt', quantity: '2', every_days: 14, score: 0.8 },
    {
      key: 'free-range eggs',
      description: 'Free-range eggs from the farmers market',
      every_days: 10,
      score: 0.7,
    },
  ]
  const spent = new Set<string>()
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
      const rows: Row[] = pack
        ? ['Passport', 'Charger', 'Sun cream', 'Walking shoes'].map((description) => ({
            description,
          }))
        : groceries
      return HttpResponse.json(
        rows.map((row, i) => ({
          ...row,
          item_id: `item_${pack ? 'pack' : 'groc'}_${i}`,
          list_id: params.listId,
          room_id: ROOM,
          completed: false,
          order: i + 1,
          created_at: now,
          updated_at: now,
        })),
      )
    }),
    http.post('/api/rooms/:roomId/lists/:listId/items', async ({ params, request }) => {
      const body = (await request.json().catch(() => ({}))) as Row & { source?: string }
      const row: Row = {
        description: body.description,
        category: body.category,
        quantity: body.quantity,
        unit: body.unit,
      }
      groceries.push(row)
      const key = row.description.toLowerCase()
      if (body.source === 'suggestion') spent.add(key)
      return HttpResponse.json({
        ...row,
        item_id: `item_groc_${groceries.length - 1}`,
        list_id: params.listId,
        room_id: ROOM,
        completed: false,
        order: groceries.length,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }),
    http.get('/api/rooms/:roomId/lists/:listId/suggestions', ({ params }) => {
      const next = suggestionQueue.find((s) => !spent.has(s.key))
      return HttpResponse.json({
        suggestions: params.listId === 'list_groceries' && next ? [next] : [],
      })
    }),
    http.post('/api/rooms/:roomId/lists/:listId/suggestions/ignore', async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as { key?: string }
      if (body.key) spent.add(body.key)
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
