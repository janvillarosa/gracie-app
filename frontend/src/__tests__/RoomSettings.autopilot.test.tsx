import { http } from 'msw'
import { server } from '../testServer'
import { render, screen, waitFor, within } from '@testing-library/react'
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

type Room = { autopilot_mode?: string; suggestions_off?: boolean }

const setup = (initial: Room, fail = false) => {
  localStorage.setItem('gracie_api_key', 'test-key')
  let room = { display_name: 'Home', members: ['Alice'], ...initial }
  const puts: Record<string, unknown>[] = []
  server.use(
    http.get('/api/me', () => json({ user_id: 'u1', name: 'Alice', room_id: 'room-1' })),
    http.get('/api/rooms/me', () => json(room)),
    http.put('/api/rooms/settings', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      puts.push(body)
      if (fail) return new Response('{"error":"nope"}', { status: 500 })
      room = { ...room, ...body }
      return json(room)
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

const group = () => screen.findByRole('group', { name: 'Autopilot' })

describe('House settings: autopilot', () => {
  it('shows Off · Suggest · Assist with Suggest chosen by default', async () => {
    setup({})
    const g = await group()
    const options = within(g)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(options).toEqual(['Off', 'Suggest', 'Assist'])
    expect(within(g).getByRole('button', { name: 'Suggest' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText(/Nothing changes until someone taps/)).toBeInTheDocument()
  })

  it('reads a House that turned suggestions off before modes as Off', async () => {
    setup({ suggestions_off: true })
    const g = await group()
    expect(within(g).getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('choosing Assist saves at once and says what it does', async () => {
    const puts = setup({ autopilot_mode: 'suggest' })
    const g = await group()
    await userEvent.click(within(g).getByRole('button', { name: 'Assist' }))
    await waitFor(() => expect(puts).toEqual([{ autopilot_mode: 'assist' }]))
    await waitFor(() =>
      expect(within(g).getByRole('button', { name: 'Assist' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    expect(
      screen.getByText(
        'Adds things to your lists before you shop. You can always undo. It never buys or books anything.',
      ),
    ).toBeInTheDocument()
  })

  it('goes back to the saved mode when the save fails', async () => {
    setup({ autopilot_mode: 'suggest' }, true)
    const g = await group()
    await userEvent.click(within(g).getByRole('button', { name: 'Off' }))
    await waitFor(() =>
      expect(within(g).getByRole('button', { name: 'Suggest' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
  })
})
