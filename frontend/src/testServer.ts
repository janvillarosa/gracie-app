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
  http.get('/api/rooms/me', () => json({ display_name: 'The House', members: [] })),
)
