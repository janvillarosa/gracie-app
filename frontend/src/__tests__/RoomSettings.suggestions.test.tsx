import { http } from 'msw'
import { server } from '../testServer'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@auth/AuthProvider'
import { RoomSettings } from '@pages/RoomSettings'

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const setup = (suggestionsOff: boolean) => {
  localStorage.setItem('gracie_api_key', 'test-key')
  let off = suggestionsOff
  const puts: { suggestions_off: boolean }[] = []
  server.use(
    http.get('/api/me', () => json({ user_id: 'u1', name: 'Alice', room_id: 'room-1' })),
    http.get('/api/rooms/me', () =>
      json({ display_name: 'Home', members: ['Alice'], suggestions_off: off }),
    ),
    http.put('/api/rooms/settings', async ({ request }) => {
      const body = (await request.json()) as { suggestions_off: boolean }
      puts.push(body)
      off = body.suggestions_off
      return json({ display_name: 'Home', members: ['Alice'], suggestions_off: off })
    }),
  )
  render(
    <MemoryRouter>
      <AuthProvider>
        <QueryClientProvider client={new QueryClient()}>
          <RoomSettings />
        </QueryClientProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
  return puts
}

describe('House settings: smart suggestions', () => {
  it('is on by default and turning it off saves at once', async () => {
    const puts = setup(false)
    const toggle = await screen.findByRole('switch', { name: 'Smart suggestions' })
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).toBeChecked()
    await userEvent.click(toggle)
    await waitFor(() => expect(puts).toEqual([{ suggestions_off: true }]))
    await waitFor(() => expect(toggle).not.toBeChecked())
  })

  it('turns back on', async () => {
    const puts = setup(true)
    const toggle = await screen.findByRole('switch', { name: 'Smart suggestions' })
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).not.toBeChecked()
    await userEvent.click(toggle)
    await waitFor(() => expect(puts).toEqual([{ suggestions_off: false }]))
  })
})
