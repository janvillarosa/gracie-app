import { http } from 'msw'
import { setupServer } from 'msw/node'
import { tripHandlers } from './mocks/handlers'
import { MockTripServer } from './mocks/tripsServer'

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

// Shared MSW server for tests. Per-test handlers go through server.use(); these defaults
// cover background fetches the list page makes that most tests don't care about.
// In-memory trips contract behind the real URLs; tests seed it and inspect it directly.
export const tripServer = new MockTripServer()

export const server = setupServer(
  ...tripHandlers(tripServer),
  http.get('/api/rooms/:roomId/pantry', () => json([])),
  http.get('/api/rooms/:roomId/lists/:listId/suggestions', () => json({ suggestions: [] })),
  // The list's autopilot (Up next, the slip stack): nothing, unless a test says otherwise.
  http.get('/api/rooms/:roomId/lists/:listId/autopilot', () =>
    json({ mode: 'suggest', features: [], stack: [], applied: [], suggestions: [] }),
  ),
  http.get('/api/rooms/:roomId/lists/:listId/run-hint', () =>
    json({ run_hint: { likely: 'unknown', checks_to_start: 3, idle_end_min: 45, burst_sec: 15 } }),
  ),
  http.post('/api/events', () => json({ accepted: 0, rejected: 0 })),
  // Clear completed waits behind its Undo toast, so it can land after the test that cleared.
  http.post('/api/rooms/:roomId/lists/:listId/clear', () => new Response(null, { status: 204 })),
  http.get('/api/rooms/me', () => json({ display_name: 'The House', members: [] })),
)
