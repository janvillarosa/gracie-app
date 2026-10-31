import { http } from 'msw'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@auth/AuthProvider'
import { ListPage } from '@pages/ListPage'
import type { AutopilotMode, AutopilotView, ListSuggestion, RouteItem } from '@api/types'
import { server } from '../testServer'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export const roomId = 'room-1'
export const listId = 'list-1'
const now = new Date().toISOString()

// ---- the window: a desktop (every min-width up to 1440px matches) or a phone (none does) ------------

type Listener = (e: { matches: boolean; media: string }) => void
const listeners = new Map<Listener, string>()
let wide = false
const original = window.matchMedia

const matches = (query: string) => {
  const min = /min-width:\s*(\d+)px/.exec(query)
  return !!min && wide && Number(min[1]) <= 1440
}

const mediaQuery = (query: string) => ({
  // Live: a hook that kept this object reads the window's current size when it is told.
  get matches() {
    return matches(query)
  },
  media: query,
  onchange: null,
  addListener: (fn: Listener) => listeners.set(fn, query),
  removeListener: (fn: Listener) => listeners.delete(fn),
  addEventListener: (_: string, fn: Listener) => listeners.set(fn, query),
  removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
  dispatchEvent: () => false,
})

/** Make the window desk-sized (1024px and wider) or phone-sized. Call it again mid-test to resize. */
export function setWide(on: boolean) {
  wide = on
  window.matchMedia = mediaQuery as unknown as typeof window.matchMedia
  act(() => {
    for (const [fn, query] of [...listeners]) fn({ matches: matches(query), media: query })
  })
}

/** Put the window back as the other tests expect it. */
export function resetWindow() {
  wide = false
  listeners.clear()
  window.matchMedia = original
}

// ---- the list ---------------------------------------------------------------------------------------

export type DeskOpts = {
  wide: boolean
  mode?: AutopilotMode
  suggestions?: ListSuggestion[]
  notes?: string
  items?: { description: string; category?: string; quantity?: string }[]
  /** Autopilot's assist run (needs mode 'assist'): names of the items it added. */
  added?: string[]
  /** Up next is ready, with this route. */
  route?: RouteItem[]
}

export const eggs: ListSuggestion = {
  key: 'eggs',
  description: 'Eggs',
  every_days: 7,
  score: 0.8,
  due_in_days: 2,
}

export type DeskCalls = {
  patched: { id: string; body: { completed?: boolean; description?: string } }[]
  deleted: string[]
  notesSaved: string[]
}

/** The List page at desk width (or phone width), with the mock House, list and Butler answers. */
export async function setupListPage(o: DeskOpts) {
  localStorage.setItem('gracie_api_key', 'test-key')
  localStorage.removeItem(`gracie_autopilot_seen_${listId}`)
  localStorage.removeItem(`gracie_up_next_hidden_${listId}`)
  setWide(o.wide)
  const mode = o.mode ?? 'suggest'
  const calls: DeskCalls = { patched: [], deleted: [], notesSaved: [] }
  let notes = o.notes ?? ''
  let rows = (o.items ?? []).map((it, i) => ({
    ...it,
    item_id: `it-${i}`,
    list_id: listId,
    room_id: roomId,
    completed: false,
    source: o.added?.includes(it.description) ? ('autopilot' as const) : undefined,
    order: i,
    created_at: now,
    updated_at: now,
  }))
  const features =
    mode === 'off'
      ? []
      : mode === 'assist'
        ? ['run_hint', 'auto_add', 'up_next']
        : ['run_hint', 'suggestions', 'up_next']
  const runAt = new Date(Date.now() + 3 * 86_400_000).toISOString()
  server.use(
    http.get('/api/me', () => json({ user_id: 'u1', name: 'Alice', room_id: roomId })),
    http.get('/api/rooms/me', () =>
      json({
        display_name: 'Home',
        members: ['Alice'],
        autopilot_mode: mode,
        autopilot_features: features,
      }),
    ),
    http.get(`/api/rooms/${roomId}/lists`, () =>
      json([
        {
          list_id: listId,
          room_id: roomId,
          name: 'Groceries',
          description: '',
          notes,
          icon: 'APPLE',
          is_deleted: false,
          deletion_votes: {},
          created_at: now,
          updated_at: now,
        },
      ]),
    ),
    http.patch(`/api/rooms/${roomId}/lists/${listId}`, async ({ request }) => {
      const body = (await request.json()) as { notes?: string }
      if (body.notes !== undefined) {
        notes = body.notes
        calls.notesSaved.push(body.notes)
      }
      return json({ list_id: listId, notes })
    }),
    http.get(`/api/rooms/${roomId}/lists/${listId}/items`, ({ request }) => {
      const all = new URL(request.url).searchParams.get('include_completed') === 'true'
      return json(all ? rows : rows.filter((r) => !r.completed))
    }),
    http.patch(`/api/rooms/${roomId}/lists/${listId}/items/:id`, async ({ params, request }) => {
      const body = (await request.json()) as { completed?: boolean; description?: string }
      calls.patched.push({ id: String(params.id), body })
      rows = rows.map((r) => (r.item_id === params.id ? { ...r, ...body } : r))
      return json(rows.find((r) => r.item_id === params.id))
    }),
    http.delete(`/api/rooms/${roomId}/lists/${listId}/items/:id`, ({ params }) => {
      calls.deleted.push(String(params.id))
      rows = rows.filter((r) => r.item_id !== params.id)
      return new Response(null, { status: 204 })
    }),
    http.get(`/api/rooms/${roomId}/pantry`, () => json([])),
    http.get(`/api/rooms/${roomId}/lists/${listId}/run-hint`, () =>
      json({
        run_hint: { likely: 'unknown', checks_to_start: 3, idle_end_min: 45, burst_sec: 0 },
      }),
    ),
    http.get(`/api/rooms/${roomId}/lists/${listId}/suggestions`, () =>
      json({ suggestions: o.suggestions ?? [] }),
    ),
    http.get(`/api/rooms/${roomId}/lists/${listId}/autopilot`, () => {
      const view: AutopilotView = {
        mode,
        features: features as AutopilotView['features'],
        stack: o.route ? ['up_next', 'auto_add', 'suggestions'] : ['auto_add', 'suggestions'],
        applied: (o.added ?? []).map((name) => {
          const row = rows.find((r) => r.description === name)
          return {
            action_id: `a-${row?.item_id}`,
            item_id: row?.item_id ?? '',
            key: name.toLowerCase(),
            state: 'applied' as const,
            run_at: runAt,
            reason: { code: 'every_days' as const, params: { days: 7 } },
            confidence: 0.9,
          }
        }),
        suggestions: [],
        ...(o.route ? { up_next: { ready: true, route: o.route } } : {}),
      }
      return json(view)
    }),
    http.post('/api/events', () => json({ accepted: 0, rejected: 0 })),
  )
  const user = userEvent.setup()
  const view = render(
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
  await screen.findByRole('heading', { name: /Groceries/ })
  return { user, calls, ...view }
}
