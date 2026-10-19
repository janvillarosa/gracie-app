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
    test_account: true,
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
  type Row = {
    description: string
    category?: string
    quantity?: string
    unit?: string
    completed?: boolean
    archived?: boolean
    // Assist mode: autopilot put it there (action id), and why (every N days).
    source?: 'autopilot'
    action?: string
    days?: number
  }
  const groceries: Row[] = [
    { description: 'Oregano', category: 'Produce' },
    { description: 'Dill plant', category: 'Produce' },
    { description: 'Oat milk', category: 'Dairy', quantity: '2', unit: 'L' },
    { description: 'Sourdough loaf from the corner bakery', category: 'Bakery' },
    { description: 'Kitchen roll', category: 'Household', quantity: '4' },
    { description: 'Basmati rice', quantity: '1', unit: 'kg' },
    // Autopilot (assist mode) put these on for the next run. ?autopilot=suggest|off hides them.
    {
      description: 'Whole milk',
      category: 'Dairy',
      quantity: '2',
      unit: 'L',
      source: 'autopilot',
      action: 'act_milk',
      days: 6,
    },
    {
      description: 'Bananas',
      category: 'Produce',
      quantity: '6',
      source: 'autopilot',
      action: 'act_bananas',
      days: 5,
    },
    {
      description: 'Coffee beans',
      category: 'Pantry',
      source: 'autopilot',
      action: 'act_coffee',
      days: 13,
    },
  ]
  const modeParam = new URLSearchParams(window.location.search).get('autopilot')
  let autopilotMode: 'off' | 'suggest' | 'assist' =
    modeParam === 'off' || modeParam === 'suggest' ? modeParam : 'assist'
  if (autopilotMode !== 'assist') {
    for (const row of groceries) if (row.source) row.archived = true
  }
  // The run autopilot planned for: the coming Saturday, 10:00.
  const nextRun = (() => {
    const d = new Date()
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7))
    d.setHours(10, 0, 0, 0)
    return d.toISOString()
  })()
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
  // Push: the mock keeps prefs and subscriptions in memory. The key is a valid P-256 point, so a
  // real browser can subscribe with it (pushes need the real server).
  let notifyPrefs = { itemAdds: true, autopilot: true, tripReminders: true }
  const pushSubs = new Map<string, unknown>()
  // Test mode: a few fake actions. "Simulate housemate adds" is refused, as it is with a House
  // that has real housemates; Run it twice more to see the rate limit.
  const testActions = [
    {
      id: 'push.test',
      label: 'Send me a test push',
      description: 'A notification to every device you turned notifications on for.',
      touches_house: false,
    },
    {
      id: 'dispatch.run',
      label: 'Run the dispatcher now',
      description: 'Sends what is waiting in the outbox without the 90 second wait.',
      touches_house: false,
    },
    {
      id: 'adds.simulate',
      label: 'Simulate housemate adds',
      description: 'Adds three items to Groceries as a housemate would.',
      touches_house: true,
    },
  ]
  let testRuns = 0
  const handlers = [
    http.get('/api/test/actions', () => HttpResponse.json({ actions: testActions })),
    http.post('/api/test/actions/:id', ({ params }) => {
      const a = testActions.find((x) => x.id === params.id)
      if (!a) return HttpResponse.json({ error: 'unknown action' }, { status: 404 })
      if (a.touches_house)
        return HttpResponse.json(
          { error: 'Mia isn’t a test account, so this would notify a real housemate.' },
          { status: 409 },
        )
      if (++testRuns % 4 === 0)
        return HttpResponse.json({ error: 'Slow down: try again in a minute.' }, { status: 429 })
      return HttpResponse.json({ message: `Sent to ${pushSubs.size} of ${pushSubs.size} devices` })
    }),
    http.get('/api/push/key', () =>
      HttpResponse.json({
        publicKey:
          'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
      }),
    ),
    http.put('/api/push/subscriptions', async ({ request }) => {
      const body = (await request.json().catch(() => null)) as { endpoint?: string } | null
      if (!body?.endpoint) return HttpResponse.json({ error: 'endpoint required' }, { status: 400 })
      pushSubs.set(body.endpoint, body)
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete('/api/push/subscriptions', async ({ request }) => {
      const body = (await request.json().catch(() => null)) as { endpoint?: string } | null
      if (body?.endpoint) pushSubs.delete(body.endpoint)
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('/api/me/notifications', () => HttpResponse.json(notifyPrefs)),
    http.put('/api/me/notifications', async ({ request }) => {
      notifyPrefs = { ...notifyPrefs, ...((await request.json().catch(() => ({}))) as object) }
      return new HttpResponse(null, { status: 204 })
    }),
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
        autopilot_mode: autopilotMode,
        suggestions_off: autopilotMode === 'off',
      }),
    ),
    http.put('/api/rooms/settings', async ({ request }) => {
      const body = (await request.json().catch(() => ({}))) as {
        autopilot_mode?: typeof autopilotMode
      }
      if (body.autopilot_mode) autopilotMode = body.autopilot_mode
      return HttpResponse.json({
        display_name: 'The Villarosa House (synthetic)',
        members: ['Jan', 'Mia'],
        autopilot_mode: autopilotMode,
      })
    }),
    http.get('/api/rooms/:roomId/lists/:listId/autopilot', () =>
      HttpResponse.json({
        mode: autopilotMode,
        applied:
          autopilotMode === 'assist'
            ? groceries.flatMap((row, i) =>
                row.source && !row.archived
                  ? [
                      {
                        action_id: row.action,
                        item_id: `item_groc_${i}`,
                        key: row.description.toLowerCase(),
                        state: row.completed ? 'confirmed' : 'applied',
                        run_at: nextRun,
                        reason: { code: 'every_days', params: { days: row.days } },
                        confidence: 0.82,
                      },
                    ]
                  : [],
              )
            : [],
        suggestions: [],
      }),
    ),
    http.post('/api/rooms/:roomId/lists/:listId/autopilot/:actionId/undo', ({ params }) => {
      const row = groceries.find((r) => r.action === params.actionId)
      if (!row) return new HttpResponse(null, { status: 404 })
      row.archived = true
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('/api/rooms/:roomId/lists', () => HttpResponse.json(lists)),
    http.get('/api/rooms/:roomId/pantry', () => HttpResponse.json([])),
    http.get('/api/rooms/:roomId/lists/:listId/items', ({ params, request }) => {
      const pack = params.listId === srv.listId
      const withDone = new URL(request.url).searchParams.get('include_completed') === 'true'
      const rows: Row[] = pack
        ? ['Passport', 'Charger', 'Sun cream', 'Walking shoes'].map((description) => ({
            description,
          }))
        : groceries
      return HttpResponse.json(
        rows
          .map((row, i) => ({
            ...row,
            item_id: `item_${pack ? 'pack' : 'groc'}_${i}`,
            list_id: params.listId,
            room_id: ROOM,
            completed: !!row.completed,
            order: i + 1,
            created_at: now,
            updated_at: now,
          }))
          .filter((r, i) => !rows[i].archived && (withDone || !r.completed)),
      )
    }),
    // Checking off and Clear completed (groceries only), so a shopping run can be walked through.
    http.patch('/api/rooms/:roomId/lists/:listId/items/:itemId', async ({ params, request }) => {
      const body = (await request.json().catch(() => ({}))) as { completed?: boolean }
      const i = Number(String(params.itemId).replace('item_groc_', ''))
      const row = groceries[i]
      if (!row) return new HttpResponse(null, { status: 404 })
      if (body.completed !== undefined) row.completed = body.completed
      return HttpResponse.json({
        ...row,
        item_id: params.itemId,
        list_id: params.listId,
        room_id: ROOM,
        completed: !!row.completed,
        order: i + 1,
        created_at: now,
        updated_at: new Date().toISOString(),
      })
    }),
    http.post('/api/rooms/:roomId/lists/:listId/clear', () => {
      for (const row of groceries) if (row.completed) row.archived = true
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('/api/rooms/:roomId/lists/:listId/items', async ({ params, request }) => {
      const body = (await request.json().catch(() => ({}))) as Omit<Row, 'source'> & {
        source?: string
      }
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
    http.get('/api/rooms/:roomId/lists/:listId/suggestions', ({ params, request }) => {
      // Only suggest mode suggests (assist adds instead), as on the server.
      if (autopilotMode !== 'suggest') return HttpResponse.json({ suggestions: [] })
      // Mid-shop (run mode): something not due yet, but due before the next shop.
      if (new URL(request.url).searchParams.get('during') === 'run') {
        const soon = { key: 'butter', description: 'Butter', quantity: '250', unit: 'g' }
        return HttpResponse.json({
          suggestions: spent.has(soon.key)
            ? []
            : [{ ...soon, every_days: 7, score: 0.85, due_in_days: 3 }],
        })
      }
      const next = suggestionQueue.find((s) => !spent.has(s.key))
      return HttpResponse.json({
        suggestions: params.listId === 'list_groceries' && next ? [next] : [],
      })
    }),
    // Dev: a habitual shopper, so two check-offs start a run and the run-done stamp can be seen.
    http.get('/api/rooms/:roomId/lists/:listId/run-hint', () =>
      HttpResponse.json({
        run_hint: {
          likely: 'expected',
          checks_to_start: 2,
          idle_end_min: 20,
          burst_sec: 5,
          typical: { minutes: 25, items: 6 },
        },
      }),
    ),
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
