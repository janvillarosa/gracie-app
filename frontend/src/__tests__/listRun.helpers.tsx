import { http } from 'msw'
import { server } from '../testServer'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@auth/AuthProvider'
import { ListPage } from '@pages/ListPage'
import type { ListSuggestion, RunHint } from '@api/types'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export const roomId = 'room-1'
export const listId = 'list-1'

export type RunSetup = {
  items?: string[]
  /** null: the hint endpoint fails. */
  hint?: Partial<RunHint> | null
  normal?: ListSuggestion[]
  run?: ListSuggestion[]
}

/** A List page with `items` to check off, a run hint and suggestions that answer by mode. */
export function setupRunPage({
  items = ['Milk', 'Eggs', 'Bread', 'Tea'],
  hint = {},
  normal = [],
  run = [],
}: RunSetup) {
  localStorage.setItem('gracie_api_key', 'test-key')
  const calls = {
    suggestionModes: [] as string[],
    ignored: [] as unknown[],
    events: [] as { name: string; props?: Record<string, unknown> }[],
    patched: [] as { id: string; completed?: boolean }[],
    cleared: 0,
  }
  let rows = items.map((description, i) => ({
    item_id: `it-${i}`,
    list_id: listId,
    room_id: roomId,
    description,
    completed: false,
    order: i,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }))
  server.use(
    http.get('/api/me', () => json({ user_id: 'u1', name: 'Alice', room_id: roomId })),
    http.get(`/api/rooms/${roomId}/lists`, () =>
      json([
        {
          list_id: listId,
          room_id: roomId,
          name: 'Groceries',
          description: '',
          icon: 'APPLE',
          deletion_votes: {},
          is_deleted: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]),
    ),
    http.get(`/api/rooms/${roomId}/lists/${listId}/items`, ({ request }) => {
      const all = new URL(request.url).searchParams.get('include_completed') === 'true'
      return json(all ? rows : rows.filter((r) => !r.completed))
    }),
    http.patch(`/api/rooms/${roomId}/lists/${listId}/items/:id`, async ({ params, request }) => {
      const body = (await request.json()) as { completed?: boolean }
      calls.patched.push({ id: String(params.id), ...body })
      rows = rows.map((r) => (r.item_id === params.id ? { ...r, ...body } : r))
      return json(rows.find((r) => r.item_id === params.id))
    }),
    http.post(`/api/rooms/${roomId}/lists/${listId}/clear`, () => {
      calls.cleared += 1
      rows = rows.filter((r) => !r.completed)
      return new Response(null, { status: 204 })
    }),
    http.get(`/api/rooms/${roomId}/lists/${listId}/run-hint`, () =>
      hint === null
        ? json({ error: 'boom' }, 500)
        : json({
            run_hint: {
              likely: 'unknown',
              checks_to_start: 3,
              idle_end_min: 45,
              burst_sec: 0,
              ...hint,
            },
          }),
    ),
    http.get(`/api/rooms/${roomId}/lists/${listId}/suggestions`, ({ request }) => {
      const during = new URL(request.url).searchParams.get('during') ?? 'normal'
      calls.suggestionModes.push(during)
      return json({ suggestions: during === 'run' ? run : normal })
    }),
    http.post(`/api/rooms/${roomId}/lists/${listId}/suggestions/ignore`, async ({ request }) => {
      calls.ignored.push(await request.json())
      return new Response(null, { status: 204 })
    }),
    http.post('/api/events', async ({ request }) => {
      const body = (await request.json()) as {
        events?: { name: string; props?: Record<string, unknown> }[]
      }
      calls.events.push(...(body.events ?? []))
      return json({ accepted: 0, rejected: 0 })
    }),
  )
  render(
    <MemoryRouter initialEntries={[`/app/lists/${listId}`]}>
      <AuthProvider>
        <QueryClientProvider client={new QueryClient()}>
          <Routes>
            <Route path="/app/lists/:listId" element={<ListPage />} />
          </Routes>
        </QueryClientProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
  return calls
}
