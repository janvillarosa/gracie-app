import React from 'react'
import { http } from 'msw'
import { server } from '../testServer'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@auth/AuthProvider'
import { ListPage } from '@pages/ListPage'

const setup = async () => {
  // Set an API key to be considered authed
  localStorage.setItem('gracie_api_key', 'test-key')

  // Mock minimal API flows used by ListPage
  const roomId = 'room-1'
  const listId = 'list-1'
  server.use(
    http.get('/api/me', () => {
      return new Response(
        JSON.stringify({ user_id: 'u1', name: 'Alice', room_id: roomId }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }),
    http.get(`/api/rooms/${roomId}/lists`, () => {
      return new Response(
        JSON.stringify([
          { list_id: listId, room_id: roomId, name: 'Groceries', description: '', icon: 'APPLE', deletion_votes: {}, is_deleted: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }),
    http.get(`/api/rooms/${roomId}/lists/${listId}/items`, ({ request }) => {
      // include_completed param isn't used by the handler, but endpoint always appends it
      const url = new URL(request.url)
      if (!url.searchParams.has('include_completed')) {
        return new Response(null, { status: 400 })
      }
      // Start with empty list by default
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
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
    </MemoryRouter>
  )

  // Wait a tick for initial queries to settle in tests
  await new Promise((r) => setTimeout(r, 30))
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
        const payload = { item_id: 'it-' + created, list_id: listId, room_id: roomId, description: body.description, completed: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        return new Response(JSON.stringify(payload), { status: 201, headers: { 'Content-Type': 'application/json' } })
      })
    )

    const input = await screen.findByPlaceholderText('Add an item')
    expect(input).toBeInTheDocument()

    await userEvent.type(input, 'Milk')
    expect(input).toHaveValue('Milk')
    await userEvent.type(input, '{enter}')

    // Allow microtasks to run
    await new Promise((r) => setTimeout(r, 40))
    expect(created).toBe(1)
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
  })

  it('does not submit on Shift+Enter; inserts newline', async () => {
    const { roomId, listId } = await setup()
    let created = 0
    server.use(
      http.post(`/api/rooms/${roomId}/lists/${listId}/items`, () => {
        created += 1
        return new Response(JSON.stringify({}), { status: 201, headers: { 'Content-Type': 'application/json' } })
      })
    )

    const input = await screen.findByPlaceholderText('Add an item')
    await userEvent.type(input, 'Line1')
    // Simulate Shift+Enter via userEvent to ensure jsdom updates value
    await userEvent.type(input, '{Shift>}{Enter}{/Shift}')
    expect(input).toHaveValue('Line1\n')
    // No create call triggered
    await new Promise((r) => setTimeout(r, 20))
    expect(created).toBe(0)
  })

  it('does not submit while IME composing', async () => {
    const { roomId, listId } = await setup()
    let created = 0
    server.use(
      http.post(`/api/rooms/${roomId}/lists/${listId}/items`, () => {
        created += 1
        return new Response(JSON.stringify({}), { status: 201, headers: { 'Content-Type': 'application/json' } })
      })
    )

    const input = await screen.findByPlaceholderText('Add an item')
    await userEvent.type(input, 'Test Item')
    // Compose Enter event; ensure isComposing is set at top-level as React Testing Library does
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 })
    await new Promise((r) => setTimeout(r, 20))
    expect(created).toBe(0)
  })
})
