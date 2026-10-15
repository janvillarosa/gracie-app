// MSW handlers that put a MockTripServer behind the real trips URLs.
import { http, HttpResponse } from 'msw'
import { MockHttpError, MockTripServer } from './tripsServer'

/** Runs a handler body; a MockHttpError becomes the status the real server would answer. */
async function answer(body: () => unknown) {
  try {
    return HttpResponse.json(body() as never)
  } catch (e) {
    if (e instanceof MockHttpError) return HttpResponse.json(e.body, { status: e.status })
    throw e
  }
}

export function tripHandlers(server: MockTripServer, opts: { latencyMs?: number } = {}) {
  const wait = () =>
    opts.latencyMs ? new Promise((r) => setTimeout(r, opts.latencyMs)) : Promise.resolve()
  return [
    http.post('/api/rooms/:roomId/trips/sync', async ({ request, params }) => {
      await wait()
      const { known } = (await request.json()) as { known: Record<string, number> }
      return answer(() => server.sync(String(params.roomId), known ?? {}))
    }),
    http.post('/api/rooms/:roomId/trips/ops', async ({ request, params }) => {
      await wait()
      const { ops } = (await request.json()) as { ops: unknown[] }
      return answer(() => server.ops(String(params.roomId), ops))
    }),
    http.post('/api/rooms/:roomId/trips/:tripId/packing-list', async ({ params }) => {
      await wait()
      const l = server.packingList(String(params.roomId), String(params.tripId))
      return l ? HttpResponse.json(l) : HttpResponse.json({ error: 'not found' }, { status: 404 })
    }),
    http.get('/api/places/search', async ({ request }) => {
      await wait()
      const u = new URL(request.url).searchParams
      return answer(() =>
        server.searchPlaces(u.get('q') ?? '', Number(u.get('limit')) || undefined),
      )
    }),
    http.get('/api/places/reverse', async ({ request }) => {
      const u = new URL(request.url).searchParams
      return answer(() => server.reverse(Number(u.get('lat')), Number(u.get('lng'))))
    }),
  ]
}
