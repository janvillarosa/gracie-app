import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http } from 'msw'
import { server } from '../testServer'
import { AuthProvider } from '@auth/AuthProvider'
import { RoomPage } from '@pages/RoomPage'

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const renderRoom = () => {
  localStorage.setItem('gracie_api_key', 'k_test')
  server.use(
    http.get('/api/me', () => json({ user_id: 'u1', name: 'Alice', avatar_key: 'alice' })),
    http.get('/api/rooms/r1/lists', () =>
      json([
        {
          list_id: 'l1',
          room_id: 'r1',
          name: 'Groceries',
          description: 'Weekly shop',
          icon: 'BROCCOLI',
        },
        { list_id: 'l2', room_id: 'r1', name: 'Road trip' },
      ]),
    ),
  )
  const room = { display_name: 'The House', members: ['u1'] } as any
  render(
    <MemoryRouter initialEntries={['/app']}>
      <AuthProvider>
        <QueryClientProvider client={new QueryClient()}>
          <Routes>
            <Route path="/app" element={<RoomPage room={room} roomId="r1" userId="u1" />} />
            <Route path="/app/settings" element={<div>Settings page</div>} />
            <Route path="/app/lists/:listId" element={<div>List page</div>} />
          </Routes>
        </QueryClientProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('RoomPage navigation', () => {
  it('renders each list as a real link with its own actions button', async () => {
    renderRoom()
    const link = await screen.findByRole('link', { name: /groceries/i })
    expect(link).toHaveAttribute('href', '/app/lists/l1')
    // The actions button is a sibling of the link, never nested inside it
    const actions = screen.getByRole('button', { name: 'Actions for Groceries' })
    expect(link).not.toContainElement(actions)

    await userEvent.click(actions)
    expect(await screen.findByText('Edit details')).toBeInTheDocument()
  })

  it('opens a list when its row is clicked', async () => {
    renderRoom()
    await userEvent.click(await screen.findByRole('link', { name: /groceries/i }))
    expect(await screen.findByText('List page')).toBeInTheDocument()
  })

  it('goes straight to house settings from the gear button', async () => {
    renderRoom()
    await userEvent.click(screen.getByRole('button', { name: 'House settings' }))
    expect(await screen.findByText('Settings page')).toBeInTheDocument()
  })

  it('creates a list from the New list dialog', async () => {
    let body: any = null
    server.use(
      http.post('/api/rooms/r1/lists', async ({ request }) => {
        body = await request.json()
        return json({ list_id: 'l9', room_id: 'r1', name: body.name })
      }),
    )
    renderRoom()
    await userEvent.click(screen.getByRole('button', { name: /new list/i }))
    await userEvent.type(await screen.findByPlaceholderText('List name'), 'Chores')
    await userEvent.click(screen.getByRole('button', { name: /create/i }))
    await waitFor(() => expect(body).toEqual({ name: 'Chores' }))
  })

  it('edits a list and votes to delete it from the row menu', async () => {
    let patched: any = null
    let voted = false
    server.use(
      http.patch('/api/rooms/r1/lists/l1', async ({ request }) => {
        patched = await request.json()
        return json({ list_id: 'l1', room_id: 'r1', name: patched.name })
      }),
      http.post('/api/rooms/r1/lists/l1/deletion/vote', () => {
        voted = true
        return json({ deleted: false })
      }),
    )
    renderRoom()
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Groceries' }))
    await userEvent.click(await screen.findByText('Edit details'))
    const name = await screen.findByDisplayValue('Groceries')
    await userEvent.clear(name)
    await userEvent.type(name, 'Weekly shop')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(patched).toMatchObject({ name: 'Weekly shop' }))

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Groceries' }))
    await userEvent.click(await screen.findByText('Vote to delete list'))
    await waitFor(() => expect(voted).toBe(true))
  })

  it('shows the share code and makes a new one on request', async () => {
    let n = 0
    server.use(http.post('/api/rooms/share', () => json({ token: `code-${++n}` })))
    renderRoom()
    await userEvent.click(screen.getByRole('button', { name: /share code/i }))
    expect(await screen.findByDisplayValue('code-1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /new code/i }))
    expect(await screen.findByDisplayValue('code-2')).toBeInTheDocument()
  })
})
