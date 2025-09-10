import React from 'react'
import { http } from 'msw'
import { server } from '../testServer'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@auth/AuthProvider'
import { ListPage } from '@pages/ListPage'

const setup = async () => {
  localStorage.setItem('gracie_api_key', 'test-key')
  const roomId = 'room-1'
  const listId = 'list-1'
  server.use(
    http.get('/api/me', () => new Response(
      JSON.stringify({ user_id: 'u1', name: 'Alice', room_id: roomId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )),
    http.get(`/api/rooms/${roomId}/lists`, () => new Response(
      JSON.stringify([
        { list_id: listId, room_id: roomId, name: 'Groceries', description: '', notes: '', icon: 'APPLE', deletion_votes: {}, is_deleted: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      ]),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )),
    http.get(`/api/rooms/${roomId}/lists/${listId}/items`, ({ request }) => {
      const url = new URL(request.url)
      if (!url.searchParams.has('include_completed')) return new Response(null, { status: 400 })
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
  )
  const qc = new QueryClient()
  render(
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
  await new Promise((r) => setTimeout(r, 30))
  return { roomId, listId }
}

describe('ListPage notes', () => {
  it('allows typing and saving notes', async () => {
    const { roomId, listId } = await setup()
    let patched = false
    server.use(
      http.patch(`/api/rooms/${roomId}/lists/${listId}`, async ({ request }) => {
        const body = await request.json() as any
        if (typeof body.notes === 'string') patched = true
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      })
    )

    // Switch to Notes tab
    const notesTab = await screen.findByRole('tab', { name: /notes/i })
    await userEvent.click(notesTab)

    const textarea = await screen.findByPlaceholderText(/write notes/i)
    await userEvent.type(textarea, 'Buy oat milk')
    const saveBtn = await screen.findByRole('button', { name: /save/i })
    await userEvent.click(saveBtn)

    await new Promise((r) => setTimeout(r, 30))
    expect(patched).toBe(true)
  })
})
