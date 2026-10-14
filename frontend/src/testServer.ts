import { http } from 'msw'
import { setupServer } from 'msw/node'

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

// Shared MSW server for tests. Per-test handlers go through server.use(); these defaults
// cover background fetches the list page makes that most tests don't care about.
export const server = setupServer(
  http.get('/api/rooms/:roomId/pantry', () => json([])),
  http.get('/api/rooms/me', () => json({ display_name: 'The House', members: [] })),
)
