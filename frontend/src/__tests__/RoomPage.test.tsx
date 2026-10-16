import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
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

const DEFAULT_LISTS = [
  {
    list_id: 'l1',
    room_id: 'r1',
    name: 'Groceries',
    description: 'Weekly shop',
    icon: 'BROCCOLI',
  },
  { list_id: 'l2', room_id: 'r1', name: 'Road trip' },
]

const renderRoom = (
  room: any = { display_name: 'The House', members: ['u1'] },
  lists: unknown[] = DEFAULT_LISTS,
) => {
  localStorage.setItem('gracie_api_key', 'k_test')
  server.use(
    http.get('/api/me', () => json({ user_id: 'u1', name: 'Alice', avatar_key: 'alice' })),
    http.get('/api/rooms/r1/lists', () => json(lists)),
  )
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

  it('autosaves list edits and confirms before the vote that deletes', async () => {
    let patched: any = null
    let voted = false
    server.use(
      http.patch('/api/rooms/r1/lists/l1', async ({ request }) => {
        patched = await request.json()
        return json({ list_id: 'l1', room_id: 'r1', name: patched.name ?? 'Groceries' })
      }),
      http.post('/api/rooms/r1/lists/l1/deletion/vote', () => {
        voted = true
        return json({ deleted: true })
      }),
    )
    renderRoom()
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Groceries' }))
    await userEvent.click(await screen.findByText('Edit details'))
    const name = await screen.findByDisplayValue('Groceries')
    // No Save button: the name saves when it is committed.
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()
    await userEvent.clear(name)
    await userEvent.type(name, 'Weekly shop{Enter}')
    await waitFor(() => expect(patched).toEqual({ name: 'Weekly shop' }))

    // Alone in the House, the vote is the last one: the sheet says so, and nothing is sent yet.
    await userEvent.click(screen.getByRole('button', { name: 'Delete list' }))
    expect(await screen.findByText(/this can’t be undone/i)).toBeInTheDocument()
    expect(voted).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(voted).toBe(true))
  })

  it('says how many votes a shared list needs before deleting', async () => {
    renderRoom(
      {
        display_name: 'The House',
        members: ['Alice', 'Sam', 'Jo'],
        members_meta: [
          { name: 'Alice', avatar_key: 'a', user_id: 'u1' },
          { name: 'Sam', avatar_key: 's', user_id: 'u2' },
          { name: 'Jo', avatar_key: 'j', user_id: 'u3' },
        ],
      },
      [{ list_id: 'l1', room_id: 'r1', name: 'Groceries', deletion_votes: { u2: 'x' } }],
    )
    expect(await screen.findByText('Delete vote 1 of 3')).toBeInTheDocument()
    expect(screen.getByText('Alice, Sam and Jo')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Groceries' }))
    await userEvent.click(await screen.findByText('Vote to delete'))
    expect(await screen.findByText(/yours makes 2 of 3/i)).toBeInTheDocument()
  })

  it('shows the House’s current code and replaces it only on request', async () => {
    let rotations = 0
    let reads = 0
    server.use(
      http.get('/api/rooms/share', () => {
        reads++
        return json({ token: rotations ? `NEW${rotations}` : 'K7M2Q' })
      }),
      http.post('/api/rooms/share', () => json({ token: `NEW${++rotations}` })),
    )
    renderRoom()
    await userEvent.click(screen.getByRole('button', { name: /invite/i }))
    expect(await screen.findByText('K7M2Q')).toBeInTheDocument()
    // Closing and opening again reads the same code: nothing is rotated by looking.
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(screen.getByRole('button', { name: /invite/i }))
    await waitFor(() => expect(reads).toBe(2))
    expect(await screen.findByText('K7M2Q')).toBeInTheDocument()
    expect(rotations).toBe(0)

    await userEvent.click(screen.getByRole('button', { name: /get new code/i }))
    expect(await screen.findByText('NEW1')).toBeInTheDocument()
    expect(screen.getByText(/the old one no longer works/i)).toBeInTheDocument()
  })

  it('creates a list with an icon picked from the tiles', async () => {
    let body: any = null
    server.use(
      http.post('/api/rooms/r1/lists', async ({ request }) => {
        body = await request.json()
        return json({ list_id: 'l9', room_id: 'r1', name: body.name })
      }),
    )
    renderRoom()
    await userEvent.click(screen.getByRole('button', { name: /new list/i }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'List name' }), 'Garden')
    await userEvent.click(screen.getByRole('button', { name: /icon/i }))
    const tiles = await screen.findByRole('group', { name: 'List icon' })
    expect(within(tiles).getByRole('button', { name: 'None' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(within(tiles).getByRole('button', { name: 'Sunflower' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }))
    await waitFor(() => expect(body).toEqual({ name: 'Garden', icon: 'SUNFLOWER' }))
  })

  it('saves a new icon from Edit list as soon as it is picked, and can clear it', async () => {
    const patches: any[] = []
    server.use(
      http.patch('/api/rooms/r1/lists/l1', async ({ request }) => {
        patches.push(await request.json())
        return json({ list_id: 'l1', room_id: 'r1', name: 'Groceries' })
      }),
    )
    renderRoom()
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Groceries' }))
    await userEvent.click(await screen.findByText('Edit details'))
    await userEvent.click(await screen.findByRole('button', { name: /icon/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'None' }))
    await waitFor(() => expect(patches).toContainEqual({ icon: '' }))
  })

  it('copies the invite code and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    server.use(http.get('/api/rooms/share', () => json({ token: 'K7M2Q' })))
    renderRoom()
    await userEvent.click(screen.getByRole('button', { name: /invite/i }))
    await screen.findByText('K7M2Q')
    await userEvent.click(screen.getByRole('button', { name: 'Copy code' }))
    expect(writeText).toHaveBeenCalledWith('K7M2Q')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })
})
