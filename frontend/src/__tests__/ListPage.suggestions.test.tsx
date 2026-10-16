import { http } from 'msw'
import { server } from '../testServer'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@auth/AuthProvider'
import { ListPage } from '@pages/ListPage'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const roomId = 'room-1'
const listId = 'list-1'
const milk = { key: 'whole milk', description: 'Whole milk', every_days: 7, score: 0.8 }
const eggs = { key: 'eggs', description: 'Eggs', every_days: 14, score: 0.7 }
const jam = { key: 'jam', description: 'Jam', every_days: 30, score: 0.68 }
const tea = { key: 'tea', description: 'Tea', every_days: 30, score: 0.66 }

type Sg = { key: string; description: string; every_days: number; score: number }
type CreateBody = { description: string; source?: string }

const setup = (suggestions: Sg[]) => {
  localStorage.setItem('gracie_api_key', 'test-key')
  const calls = {
    created: [] as CreateBody[],
    ignored: [] as { key: string }[],
    events: [] as string[],
  }
  let queue = [...suggestions]
  // Mirrors the server: two ignores in a row pause suggestions; an accepted one ends the streak.
  let ignoredInARow = 0
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
    http.get(`/api/rooms/${roomId}/lists/${listId}/items`, () => json([])),
    http.get(`/api/rooms/${roomId}/lists/${listId}/suggestions`, () =>
      json({ suggestions: ignoredInARow >= 2 ? [] : queue.slice(0, 1) }),
    ),
    http.post(`/api/rooms/${roomId}/lists/${listId}/items`, async ({ request }) => {
      const body = (await request.json()) as CreateBody
      calls.created.push(body)
      if (body.source === 'suggestion') ignoredInARow = 0
      // The server stops suggesting what is on the list.
      queue = queue.filter((s) => s.description !== body.description)
      return json(
        {
          item_id: 'it-1',
          list_id: listId,
          room_id: roomId,
          description: body.description,
          completed: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        201,
      )
    }),
    http.post(`/api/rooms/${roomId}/lists/${listId}/suggestions/ignore`, async ({ request }) => {
      const body = (await request.json()) as { key: string }
      calls.ignored.push(body)
      ignoredInARow += 1
      queue = queue.filter((s) => s.key !== body.key)
      return new Response(null, { status: 204 })
    }),
    http.post('/api/events', async ({ request }) => {
      const body = (await request.json()) as { events?: { name: string }[] }
      for (const e of body.events ?? []) calls.events.push(e.name)
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

describe('ListPage smart suggestions', () => {
  it('shows nothing when nothing is due', async () => {
    setup([])
    await screen.findByPlaceholderText('Add an item')
    expect(screen.queryByRole('region', { name: 'Suggestion' })).not.toBeInTheDocument()
  })

  it('shows one suggestion at a time, the most confident, above the items', async () => {
    setup([milk, eggs, jam])
    const region = await screen.findByRole('region', { name: 'Suggestion' })
    expect(region).toHaveTextContent('Whole milk')
    expect(screen.queryByText('Eggs')).not.toBeInTheDocument()
  })

  it('adds the suggestion as an item tagged as coming from a suggestion', async () => {
    const calls = setup([milk])
    await userEvent.click(await screen.findByRole('button', { name: 'Add Whole milk' }))
    await waitFor(() => expect(calls.created).toHaveLength(1))
    expect(calls.created[0]).toMatchObject({ description: 'Whole milk', source: 'suggestion' })
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Suggestion' })).not.toBeInTheDocument(),
    )
  })

  it('ignoring pops the slip and the next one comes from the server', async () => {
    const calls = setup([milk, eggs, jam])
    await userEvent.click(
      await screen.findByRole('button', { name: /Ignore suggestion: Whole milk/ }),
    )
    await waitFor(() => expect(calls.ignored).toEqual([{ key: 'whole milk' }]))
    expect(await screen.findByText('Eggs')).toBeInTheDocument()
    expect(screen.queryByText('Whole milk')).not.toBeInTheDocument()
    expect(calls.created).toHaveLength(0)
  })

  it('stops suggesting after two ignores in a row', async () => {
    const calls = setup([milk, eggs, jam])
    await userEvent.click(
      await screen.findByRole('button', { name: /Ignore suggestion: Whole milk/ }),
    )
    await userEvent.click(await screen.findByRole('button', { name: /Ignore suggestion: Eggs/ }))
    await waitFor(() => expect(calls.ignored).toHaveLength(2))
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Suggestion' })).not.toBeInTheDocument(),
    )
    expect(screen.queryByText('Jam')).not.toBeInTheDocument()
  })
})
