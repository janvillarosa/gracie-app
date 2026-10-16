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

const setup = (done: { item_id: string; description: string }[] = []) => {
  localStorage.setItem('gracie_api_key', 'test-key')
  const now = new Date().toISOString()
  const items = [
    {
      item_id: 'a',
      list_id: 'l1',
      room_id: 'r1',
      description: 'Milk',
      completed: false,
      created_at: now,
      updated_at: now,
    },
    {
      item_id: 'b',
      list_id: 'l1',
      room_id: 'r1',
      description: 'Bread',
      completed: false,
      created_at: now,
      updated_at: now,
    },
  ]
  for (const d of done) {
    items.push({
      ...items[0],
      item_id: d.item_id,
      description: d.description,
      completed: true,
    })
  }
  server.use(
    http.get('/api/me', () => json({ user_id: 'u1', name: 'Alice', room_id: 'r1' })),
    http.get('/api/rooms/r1/lists', () =>
      json([
        {
          list_id: 'l1',
          room_id: 'r1',
          name: 'Chores',
          description: '',
          deletion_votes: {},
          is_deleted: false,
          created_at: now,
          updated_at: now,
        },
      ]),
    ),
    http.get('/api/rooms/r1/lists/l1/items', ({ request }) => {
      const withDone = new URL(request.url).searchParams.get('include_completed') === 'true'
      return json(withDone ? items : items.filter((x) => !x.completed))
    }),
  )
  render(
    <MemoryRouter initialEntries={['/app/lists/l1']}>
      <AuthProvider>
        <QueryClientProvider client={new QueryClient()}>
          <Routes>
            <Route path="/app/lists/:listId" element={<ListPage />} />
          </Routes>
        </QueryClientProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('ListPage optimistic updates', () => {
  it('removes a deleted item immediately and brings it back on Undo without calling the API', async () => {
    setup()
    const onDelete = vi.fn()
    server.use(
      http.delete('/api/rooms/r1/lists/l1/items/a', () => {
        onDelete()
        return json({})
      }),
    )
    await screen.findByText('Milk')
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete item' })[0])
    await waitFor(() => expect(screen.queryByText('Milk')).not.toBeInTheDocument())
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Milk')).toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('restores a deleted item if the request fails once the undo window closes', async () => {
    setup()
    server.use(http.delete('/api/rooms/r1/lists/l1/items/a', () => json({ error: 'nope' }, 500)))
    await screen.findByText('Milk')
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete item' })[0])
    await waitFor(() => expect(screen.queryByText('Milk')).not.toBeInTheDocument())
    // The toast closes after its 5s window, then the delete is sent and fails.
    expect(await screen.findByText('Milk', {}, { timeout: 8000 })).toBeInTheDocument()
  }, 12000)

  it('drops a completed item from the open list right away', async () => {
    setup()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    server.use(
      http.patch('/api/rooms/r1/lists/l1/items/a', async () => {
        await gate
        return json({})
      }),
    )
    await screen.findByText('Milk')
    await userEvent.click(screen.getAllByRole('checkbox')[0])
    await waitFor(() => expect(screen.queryByText('Milk')).not.toBeInTheDocument())
    release()
  })

  it('lets Clear completed be undone without calling the API', async () => {
    setup([{ item_id: 'c', description: 'Eggs' }])
    const onClear = vi.fn()
    server.use(
      http.post('/api/rooms/r1/lists/l1/clear', () => {
        onClear()
        return json({})
      }),
    )
    await screen.findByText('Milk')
    await userEvent.click(screen.getByRole('button', { name: 'More list actions' }))
    await userEvent.click(await screen.findByText('Clear completed'))
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument(),
    )
    expect(onClear).not.toHaveBeenCalled()
  })

  it('sends Clear completed once the undo window closes', async () => {
    setup([{ item_id: 'c', description: 'Eggs' }])
    const onClear = vi.fn()
    server.use(
      http.post('/api/rooms/r1/lists/l1/clear', () => {
        onClear()
        return json({})
      }),
    )
    await screen.findByText('Milk')
    await userEvent.click(screen.getByRole('button', { name: 'More list actions' }))
    await userEvent.click(await screen.findByText('Clear completed'))
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(onClear).not.toHaveBeenCalled()
    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1), { timeout: 8000 })
  }, 12000)
})
