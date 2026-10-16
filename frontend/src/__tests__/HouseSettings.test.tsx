import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http } from 'msw'
import { server } from '../testServer'
import { AuthProvider } from '@auth/AuthProvider'
import { RoomSettings } from '@pages/RoomSettings'
import { NoRoomPage } from '@pages/NoRoomPage'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const room = (over: Record<string, unknown> = {}) => ({
  display_name: 'Elm Street',
  description: 'Mia, Sam and the cat',
  members: ['Mia', 'Sam'],
  members_meta: [
    { name: 'Mia', avatar_key: 'm', user_id: 'u1' },
    { name: 'Sam', avatar_key: 's', user_id: 'u2' },
  ],
  my_deletion_vote: false,
  deletion_votes: 0,
  ...over,
})

const renderAt = (path: string, element: React.ReactElement) => {
  localStorage.setItem('gracie_api_key', 'k_test')
  server.use(http.get('/api/me', () => json({ user_id: 'u1', name: 'Mia', avatar_key: 'm' })))
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <QueryClientProvider client={new QueryClient()}>
          <Routes>
            <Route path={path} element={element} />
            <Route path="/app" element={<div>House page</div>} />
          </Routes>
        </QueryClientProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('House settings', () => {
  it('lists the members and saves the description when it is committed', async () => {
    let saved: any = null
    server.use(
      http.get('/api/rooms/me', () => json(room())),
      http.put('/api/rooms/settings', async ({ request }) => {
        saved = await request.json()
        return new Response(null, { status: 204 })
      }),
    )
    renderAt('/app/settings', <RoomSettings />)
    expect(await screen.findByText('2 members')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
    // No Save button: the field saves when it is committed.
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()
    const desc = screen.getByRole('textbox', { name: 'Description' })
    await userEvent.clear(desc)
    await userEvent.type(desc, 'Two humans, one cat{Enter}')
    await waitFor(() => expect(saved).toEqual({ description: 'Two humans, one cat' }))
  })

  it('checks the House name rule where it is typed', async () => {
    server.use(http.get('/api/rooms/me', () => json(room())))
    renderAt('/app/settings', <RoomSettings />)
    const name = await screen.findByRole('textbox', { name: 'House name' })
    await userEvent.type(name, '!')
    expect(screen.getByRole('alert')).toHaveTextContent(/letters, numbers or spaces/i)
  })

  it('asks before the vote, and counts it', async () => {
    let voted = false
    server.use(
      http.get('/api/rooms/me', () => json(room())),
      http.post('/api/rooms/deletion/vote', () => {
        voted = true
        return json({ deleted: false })
      }),
    )
    renderAt('/app/settings', <RoomSettings />)
    await userEvent.click(await screen.findByRole('button', { name: 'Vote to delete' }))
    expect(await screen.findByText(/yours makes 1 of 2/i)).toBeInTheDocument()
    expect(voted).toBe(false)
    const keys = screen.getAllByRole('button', { name: 'Vote to delete' })
    await userEvent.click(keys[keys.length - 1])
    await waitFor(() => expect(voted).toBe(true))
  })

  it('lets a voter take the vote back', async () => {
    let cancelled = false
    server.use(
      http.get('/api/rooms/me', () => json(room({ my_deletion_vote: true, deletion_votes: 1 }))),
      http.post('/api/rooms/deletion/cancel', () => {
        cancelled = true
        return new Response(null, { status: 204 })
      }),
    )
    renderAt('/app/settings', <RoomSettings />)
    expect(await screen.findByText(/you voted to delete it\. 1 of 2 so far/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel my vote' }))
    await waitFor(() => expect(cancelled).toBe(true))
  })
})

describe('No House yet', () => {
  it('joins with a code, and says so inline when the code is wrong', async () => {
    let sent: any = null
    server.use(
      http.post('/api/rooms/join', async ({ request }) => {
        sent = await request.json()
        return json({ error: 'forbidden' }, 403)
      }),
    )
    renderAt('/app', <NoRoomPage />)
    const code = screen.getByRole('textbox', { name: 'House code' })
    const join = screen.getByRole('button', { name: 'Join' })
    expect(join).toBeDisabled()
    // Lowercase and stray characters are cleaned as you type.
    await userEvent.type(code, 'k7m-2q')
    expect(code).toHaveValue('K7M2Q')
    await userEvent.click(join)
    await waitFor(() => expect(sent).toEqual({ token: 'K7M2Q' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/doesn’t match a House/i)
  })

  it('creates a House from the sheet', async () => {
    let created = false
    let settings: any = null
    server.use(
      http.post('/api/rooms', () => {
        created = true
        return json({ display_name: '', members: ['Mia'] })
      }),
      http.put('/api/rooms/settings', async ({ request }) => {
        settings = await request.json()
        return new Response(null, { status: 204 })
      }),
    )
    renderAt('/app/new', <NoRoomPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Create a House' }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'House name' }), 'Elm Street')
    await userEvent.click(screen.getByRole('button', { name: 'Create House' }))
    await waitFor(() => expect(created).toBe(true))
    await waitFor(() => expect(settings).toEqual({ display_name: 'Elm Street', description: '' }))
  })
})
