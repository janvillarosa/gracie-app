import { http } from 'msw'
import { server } from '../testServer'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@auth/AuthProvider'
import { ListPage } from '@pages/ListPage'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const roomId = 'room-1'
const listId = 'list-1'
const now = new Date().toISOString()
const runAt = new Date(Date.now() + 3 * 86_400_000).toISOString()
const weekday = new Date(runAt).toLocaleDateString('en-GB', { weekday: 'long' })

const item = (id: string, description: string, source?: 'autopilot') => ({
  item_id: id,
  list_id: listId,
  room_id: roomId,
  description,
  completed: false,
  source,
  created_at: now,
  updated_at: now,
})

const setup = (mode: 'suggest' | 'assist') => {
  localStorage.setItem('gracie_api_key', 'test-key')
  localStorage.removeItem(`gracie_autopilot_seen_${listId}`)
  let items = [
    item('i-milk', 'Whole milk', 'autopilot'),
    item('i-eggs', 'Eggs', 'autopilot'),
    item('i-jam', 'Jam'),
  ]
  const calls = { autopilot: 0, undone: [] as string[] }
  server.use(
    http.get('/api/me', () => json({ user_id: 'u1', name: 'Alice', room_id: roomId })),
    http.get('/api/rooms/me', () =>
      json({ display_name: 'Home', members: ['Alice'], autopilot_mode: mode }),
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
    http.get(`/api/rooms/${roomId}/lists/${listId}/items`, () => json(items)),
    http.get(`/api/rooms/${roomId}/lists/${listId}/suggestions`, () => json({ suggestions: [] })),
    http.get(`/api/rooms/${roomId}/lists/${listId}/autopilot`, () => {
      calls.autopilot++
      const applied = [
        {
          action_id: 'a-milk',
          item_id: 'i-milk',
          key: 'whole milk',
          state: 'applied',
          run_at: runAt,
          reason: { code: 'every_days', params: { days: 9 } },
          confidence: 0.9,
        },
        {
          action_id: 'a-eggs',
          item_id: 'i-eggs',
          key: 'eggs',
          state: 'applied',
          run_at: runAt,
          reason: { code: 'every_days', params: { days: 7 } },
          confidence: 0.9,
        },
      ].filter((a) => !calls.undone.includes(a.action_id))
      return json({ mode, applied, suggestions: [] })
    }),
    http.post(`/api/rooms/${roomId}/lists/${listId}/autopilot/:actionId/undo`, ({ params }) => {
      calls.undone.push(params.actionId as string)
      items = items.filter((it) => `a-${it.item_id.slice(2)}` !== params.actionId)
      return new Response(null, { status: 204 })
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

describe('ListPage autopilot', () => {
  it('marks autopilot items and says why when the mark is tapped', async () => {
    setup('assist')
    const mark = await screen.findByRole('button', { name: 'Why Whole milk was added' })
    expect(screen.queryByRole('button', { name: 'Why Jam was added' })).toBeNull()
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Added by autopilot' })).toBeInTheDocument(),
    )
    await userEvent.click(mark)
    expect(mark).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByText('Added by autopilot. You buy it about every 9 days'),
    ).toBeInTheDocument()
  })

  it('shows "Added 2 for <day>" once, and Undo all takes them off the list', async () => {
    const calls = setup('assist')
    const slip = await screen.findByRole('region', { name: 'Added by autopilot' })
    expect(within(slip).getByText(`Added 2 for ${weekday}`)).toBeInTheDocument()
    expect(within(slip).getByText('Whole milk, Eggs')).toBeInTheDocument()
    await userEvent.click(within(slip).getByRole('button', { name: 'Undo all' }))
    await waitFor(() => expect(calls.undone.sort()).toEqual(['a-eggs', 'a-milk']))
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Added by autopilot' })).toBeNull(),
    )
    await waitFor(() => expect(screen.queryByText('Whole milk')).toBeNull())
    expect(localStorage.getItem(`gracie_autopilot_seen_${listId}`)).toBe(runAt)
  })

  it('closing the slip keeps the items and does not show it again for that run', async () => {
    const calls = setup('assist')
    const slip = await screen.findByRole('region', { name: 'Added by autopilot' })
    await userEvent.click(within(slip).getByRole('button', { name: 'Got it' }))
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Added by autopilot' })).toBeNull(),
    )
    expect(screen.getByText('Whole milk')).toBeInTheDocument()
    expect(calls.undone).toEqual([])
  })

  it('in suggest mode it never asks for the autopilot view', async () => {
    const calls = setup('suggest')
    await screen.findByText('Jam')
    expect(calls.autopilot).toBe(0)
    expect(screen.queryByRole('region', { name: 'Added by autopilot' })).toBeNull()
  })
})
