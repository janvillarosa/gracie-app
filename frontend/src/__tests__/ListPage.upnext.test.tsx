import { http } from 'msw'
import { server } from '../testServer'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@auth/AuthProvider'
import { tracker } from '@lib/analytics'
import { ListPage } from '@pages/ListPage'
import type { AutopilotView, RouteItem } from '@api/types'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const roomId = 'room-1'
const listId = 'list-1'
const now = new Date().toISOString()

const item = (id: string, description: string, completed = false) => ({
  item_id: id,
  list_id: listId,
  room_id: roomId,
  description,
  completed,
  created_at: now,
  updated_at: now,
})

const spot = (id: string, key: string, s: number, done = false): RouteItem => ({
  item_id: id,
  key,
  spot: s,
  done,
})

// Bananas are already checked off; the House's usual walk is bananas, milk, eggs, bread, cheese.
const route = (anchorDone: string[] = []): RouteItem[] => [
  spot('i-ban', 'bananas', 0, true),
  spot('i-milk', 'milk', 0.25, anchorDone.includes('i-milk')),
  spot('i-eggs', 'eggs', 0.5, anchorDone.includes('i-eggs')),
  spot('i-bread', 'bread', 0.75),
  spot('i-cheese', 'cheese', 1),
]

type Opts = {
  mode?: 'off' | 'suggest' | 'assist'
  ready?: boolean
  run?: { started_at: string; anchor_item_id?: string }
  route?: RouteItem[]
  upNext?: boolean
  stack?: AutopilotView['stack']
  doneIds?: string[]
}

const setup = (o: Opts = {}) => {
  localStorage.setItem('gracie_api_key', 'test-key')
  localStorage.removeItem(`gracie_up_next_hidden_${listId}`)
  const mode = o.mode ?? 'suggest'
  const done = new Set(o.doneIds ?? [])
  const all = [
    item('i-milk', 'Milk'),
    item('i-eggs', 'Eggs'),
    item('i-bread', 'Bread'),
    item('i-cheese', 'Cheese'),
  ]
  const calls = {
    autopilot: 0,
    put: [] as { id: string; body: { completed?: boolean } }[],
    events: [] as { name: string; props?: Record<string, unknown> }[],
  }
  const hasUpNext = o.upNext ?? true
  server.use(
    http.get('/api/me', () => json({ user_id: 'u1', name: 'Alice', room_id: roomId })),
    http.get('/api/rooms/me', () =>
      json({
        display_name: 'Home',
        members: ['Alice'],
        autopilot_mode: mode,
        autopilot_features: mode === 'off' ? [] : ['run_hint', 'suggestions', 'up_next'],
      }),
    ),
    http.get(`/api/rooms/${roomId}/lists`, () =>
      json([
        {
          list_id: listId,
          room_id: roomId,
          name: 'Groceries',
          is_deleted: false,
          deletion_votes: {},
          created_at: now,
          updated_at: now,
        },
      ]),
    ),
    http.get(`/api/rooms/${roomId}/lists/${listId}/items`, () =>
      json(all.filter((it) => !done.has(it.item_id))),
    ),
    http.patch(
      `/api/rooms/${roomId}/lists/${listId}/items/:itemId`,
      async ({ request, params }) => {
        const body = (await request.json()) as { completed?: boolean }
        calls.put.push({ id: params.itemId as string, body })
        if (body.completed) done.add(params.itemId as string)
        return json({ ...item(params.itemId as string, 'x'), completed: !!body.completed })
      },
    ),
    http.get(`/api/rooms/${roomId}/lists/${listId}/suggestions`, () =>
      json({
        suggestions: [
          { key: 'coffee beans', description: 'Coffee beans', every_days: 7, score: 0.8 },
        ],
      }),
    ),
    http.get(`/api/rooms/${roomId}/lists/${listId}/autopilot`, () => {
      calls.autopilot++
      const view: AutopilotView = {
        mode,
        features: mode === 'off' ? [] : ['run_hint', 'suggestions', 'up_next'],
        stack: o.stack ?? (hasUpNext ? ['up_next', 'suggestions'] : ['suggestions']),
        applied: [],
        suggestions: [],
        ...(hasUpNext
          ? { up_next: { ready: o.ready ?? true, run: o.run, route: o.route ?? route() } }
          : {}),
      }
      return json(view)
    }),
    http.post('/api/events', async ({ request }) => {
      const body = (await request.json()) as {
        events?: { name: string; props?: Record<string, unknown> }[]
      }
      calls.events.push(...(body.events ?? []))
      return json({ accepted: 0, rejected: 0 })
    }),
  )
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
  return { calls, ...view }
}

const upNext = () => screen.findByRole('region', { name: 'Up next' })

describe('ListPage Up next', () => {
  it('shows Up next in front on open when the House is shopping now, the suggestion waiting behind', async () => {
    const { container } = setup()
    const slip = await upNext()
    expect(within(slip).getByText('Milk')).toBeInTheDocument()
    expect(within(slip).getByText('Usually next · then Eggs')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Suggestion' })).toBeNull()
    expect(container.querySelectorAll('.slip-stack-peek')).toHaveLength(1)
  })

  it('waits for a first check-off when the House is not shopping yet', async () => {
    setup({ ready: false })
    await screen.findByRole('region', { name: 'Suggestion' })
    expect(screen.queryByRole('region', { name: 'Up next' })).toBeNull()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Check off Milk' }))
    const slip = await upNext()
    expect(within(slip).getByText('Eggs')).toBeInTheDocument()
    expect(within(slip).getByText('Usually next · then Bread')).toBeInTheDocument()
  })

  it('a tick on the slip checks the item off and hands the slip to the next pick', async () => {
    const { calls } = setup()
    const slip = await upNext()
    await userEvent.click(within(slip).getByRole('checkbox', { name: 'Milk, done' }))
    await waitFor(() => expect(calls.put).toEqual([{ id: 'i-milk', body: { completed: true } }]))
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Up next' })).getByText('Eggs'),
      ).toBeInTheDocument(),
    )
    expect(
      within(screen.getByRole('region', { name: 'Up next' })).getByRole('status'),
    ).toHaveTextContent('Up next: Eggs')
  })

  it('✕ puts Up next away for this run and the suggestion comes forward', async () => {
    const { calls } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Hide up next' }))
    expect(await screen.findByRole('region', { name: 'Suggestion' })).toHaveTextContent(
      'Coffee beans',
    )
    expect(screen.queryByRole('region', { name: 'Up next' })).toBeNull()
    expect(localStorage.getItem(`gracie_up_next_hidden_${listId}`)).toContain('window')
    await tracker.flush()
    await waitFor(() =>
      expect(calls.events).toContainEqual(
        expect.objectContaining({
          name: 'nudge.dismissed',
          props: expect.objectContaining({ kind: 'up_next' }),
        }),
      ),
    )
  })

  it('starts from the run in progress on another phone', async () => {
    setup({
      run: { started_at: new Date().toISOString(), anchor_item_id: 'i-eggs' },
      route: route(['i-milk', 'i-eggs']),
      doneIds: ['i-milk', 'i-eggs'],
    })
    const slip = await upNext()
    expect(within(slip).getByText('Bread')).toBeInTheDocument()
    expect(within(slip).getByText('Usually next · then Cheese')).toBeInTheDocument()
  })

  it('tracks whether the next check-off followed the pick', async () => {
    const { calls } = setup()
    await upNext()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Check off Eggs' }))
    await tracker.flush()
    await waitFor(() =>
      expect(calls.events).toContainEqual(
        expect.objectContaining({ name: 'nudge.followed', props: { kind: 'up_next', hit: true } }),
      ),
    )
  })

  it('shows no slip when the server’s stack has no Up next', async () => {
    const { calls } = setup({ upNext: false })
    await screen.findByRole('region', { name: 'Suggestion' })
    expect(calls.autopilot).toBeGreaterThan(0)
    expect(screen.queryByRole('region', { name: 'Up next' })).toBeNull()
  })

  it('an Off House never asks for the stack or shows a slip', async () => {
    const { calls } = setup({ mode: 'off' })
    await screen.findByPlaceholderText('Add an item')
    expect(screen.queryByRole('region', { name: 'Up next' })).toBeNull()
    expect(calls.autopilot).toBe(0)
  })
})
