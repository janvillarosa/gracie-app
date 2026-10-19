import React from 'react'
import { http } from 'msw'
import { server } from '../testServer'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@auth/AuthProvider'
import { ListPage } from '@pages/ListPage'

const setup = async (listItems: any[] = []) => {
  // Set an API key to be considered authed
  localStorage.setItem('gracie_api_key', 'test-key')

  // Mock minimal API flows used by ListPage
  const roomId = 'room-1'
  const listId = 'list-1'
  server.use(
    http.get('/api/me', () => {
      return new Response(JSON.stringify({ user_id: 'u1', name: 'Alice', room_id: roomId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
    http.get(`/api/rooms/${roomId}/lists`, () => {
      return new Response(
        JSON.stringify([
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
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }),
    http.get(`/api/rooms/${roomId}/lists/${listId}/items`, ({ request }) => {
      // include_completed param isn't used by the handler, but endpoint always appends it
      const url = new URL(request.url)
      if (!url.searchParams.has('include_completed')) {
        return new Response(null, { status: 400 })
      }
      // Start with provided list items (default empty)
      return new Response(JSON.stringify(listItems), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )

  const qc = new QueryClient()
  const ui = render(
    <MemoryRouter initialEntries={[`/app/lists/${listId}`]}>
      <AuthProvider>
        <QueryClientProvider client={qc}>
          <Routes>
            <Route path="/app/lists/:listId" element={<ListPage />} />
          </Routes>
        </QueryClientProvider>
      </AuthProvider>
    </MemoryRouter>,
  )

  // Callers await visible elements (findBy*), so no arbitrary settle is needed.
  return { ui, roomId, listId }
}

describe('ListPage add bar', () => {
  it('adds an item on Enter, keeps focus, and clears input', async () => {
    const { roomId, listId } = await setup()
    let created = 0
    server.use(
      http.post(`/api/rooms/${roomId}/lists/${listId}/items`, async ({ request }) => {
        created += 1
        const body = (await request.json()) as any
        const payload = {
          item_id: 'it-' + created,
          list_id: listId,
          room_id: roomId,
          description: body.description,
          completed: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        return new Response(JSON.stringify(payload), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const input = await screen.findByPlaceholderText('Add an item')
    expect(input).toBeInTheDocument()

    await userEvent.type(input, 'Milk')
    expect(input).toHaveValue('Milk')
    await userEvent.type(input, '{enter}')

    await waitFor(() => expect(created).toBe(1))
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
  })

  it('does not submit on Shift+Enter; inserts newline', async () => {
    const { roomId, listId } = await setup()
    let created = 0
    server.use(
      http.post(`/api/rooms/${roomId}/lists/${listId}/items`, () => {
        created += 1
        return new Response(JSON.stringify({}), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const input = await screen.findByPlaceholderText('Add an item')
    await userEvent.type(input, 'Line1')
    // Simulate Shift+Enter via userEvent to ensure jsdom updates value
    await userEvent.type(input, '{Shift>}{Enter}{/Shift}')
    expect(input).toHaveValue('Line1\n')
    // Shift+Enter returns before any request is initiated, so no create fires.
    expect(created).toBe(0)
  })

  it('does not submit while IME composing', async () => {
    const { roomId, listId } = await setup()
    let created = 0
    server.use(
      http.post(`/api/rooms/${roomId}/lists/${listId}/items`, () => {
        created += 1
        return new Response(JSON.stringify({}), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const input = await screen.findByPlaceholderText('Add an item')
    await userEvent.type(input, 'Test Item')
    // Compose Enter event; ensure isComposing is set at top-level as React Testing Library does
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 })
    // Composing Enter returns before any request is initiated, so no create fires.
    expect(created).toBe(0)
  })

  it('shows the new item immediately, before the server responds', async () => {
    const { roomId, listId } = await setup()
    const saved: any[] = []
    server.use(
      http.get(`/api/rooms/${roomId}/lists/${listId}/items`, () => {
        return new Response(JSON.stringify(saved), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
    let release: () => void = () => {}
    const held = new Promise<void>((r) => {
      release = r
    })
    server.use(
      http.post(`/api/rooms/${roomId}/lists/${listId}/items`, async ({ request }) => {
        const body = (await request.json()) as any
        await held
        const created = {
          item_id: 'srv-1',
          list_id: listId,
          room_id: roomId,
          description: body.description,
          quantity: body.quantity,
          unit: body.unit,
          category: 'grains',
          completed: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        saved.push(created)
        return new Response(JSON.stringify(created), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const input = await screen.findByPlaceholderText('Add an item')
    await userEvent.type(input, '2 kg rice{enter}')

    // Optimistic row is on screen while the request is still held.
    expect(await screen.findByText('rice')).toBeInTheDocument()
    expect(screen.queryByText('grains')).not.toBeInTheDocument()

    release()
    // The saved item (with its server-assigned category) replaces the placeholder in place.
    expect(await screen.findByText('grains')).toBeInTheDocument()
    expect(screen.getAllByText('rice')).toHaveLength(1)
  })

  it('removes the optimistic row and restores the text when adding fails', async () => {
    const { roomId, listId } = await setup()
    server.use(
      http.post(`/api/rooms/${roomId}/lists/${listId}/items`, () => {
        return new Response(JSON.stringify({ error: 'nope' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const input = await screen.findByPlaceholderText('Add an item')
    await userEvent.type(input, 'Butter{enter}')

    await waitFor(() => expect(input).toHaveValue('Butter'))
    await waitFor(() => expect(document.querySelector('.item-desc')).toBeNull())
  })

  it('previews the parsed quantity while typing', async () => {
    await setup()
    const input = await screen.findByPlaceholderText('Add an item')
    await userEvent.type(input, '3 cans tomatoes')
    expect(screen.getByText('3 cans')).toBeInTheDocument()
    await userEvent.clear(input)
    expect(screen.queryByText('3 cans')).not.toBeInTheDocument()
  })

  it('shows unchecked item count when present', async () => {
    const updatedAt = new Date().toISOString()
    const listItems = [
      {
        item_id: 'a',
        list_id: 'list-1',
        room_id: 'room-1',
        description: 'Milk',
        completed: false,
        created_at: updatedAt,
        updated_at: updatedAt,
      },
      {
        item_id: 'b',
        list_id: 'list-1',
        room_id: 'room-1',
        description: 'Eggs',
        completed: true,
        created_at: updatedAt,
        updated_at: updatedAt,
      },
      {
        item_id: 'c',
        list_id: 'list-1',
        room_id: 'room-1',
        description: 'Bread',
        completed: false,
        created_at: updatedAt,
        updated_at: updatedAt,
      },
    ]
    await setup(listItems)
    expect(await screen.findByText(/^2 to get · updated/)).toBeInTheDocument()
  })

  it('picking a slip for an item on the list bumps it instead of adding a row', async () => {
    const at = new Date().toISOString()
    const row = (item_id: string, description: string, extra = {}) => ({
      item_id,
      list_id: 'list-1',
      room_id: 'room-1',
      description,
      completed: false,
      created_at: at,
      updated_at: at,
      ...extra,
    })
    const { roomId, listId } = await setup([row('a', 'Chickpeas', { quantity: '1', unit: 'tin' })])
    const patches: any[] = []
    let created = 0
    server.use(
      http.get(`/api/rooms/${roomId}/pantry`, () =>
        Response.json([
          {
            description: 'Chickpeas',
            category: 'Pantry',
            quantity: '1',
            unit: 'tin',
            times_added: 3,
            last_added_at: at,
            common: false,
          },
        ]),
      ),
      http.patch(`/api/rooms/${roomId}/lists/${listId}/items/a`, async ({ request }) => {
        const body = await request.json()
        patches.push(body)
        return Response.json(row('a', 'Chickpeas', { quantity: '2', unit: 'tin' }))
      }),
      http.post(`/api/rooms/${roomId}/lists/${listId}/items`, () => {
        created += 1
        return Response.json(row('z', 'Chickpeas'))
      }),
    )
    await screen.findByText('Chickpeas')
    await userEvent.type(screen.getByRole('combobox'), 'chick pea')
    await userEvent.click(await screen.findByRole('option', { name: /on list, 1 tin/ }))
    await waitFor(() => expect(patches).toEqual([{ quantity: '2' }]))
    expect(created).toBe(0)
  })
})
