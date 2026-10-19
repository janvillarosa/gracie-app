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

const slider = () => screen.findByRole('slider', { name: 'Butler' })

describe('House settings: autopilot', () => {
  it('is a slider from Off to Assist, on Suggest by default', async () => {
    setup({})
    const s = await slider()
    expect(s).toHaveAttribute('aria-valuetext', 'Suggest')
    expect(s).toHaveAttribute('aria-describedby', 'autopilot-help')
    for (const name of ['Off', 'Suggest', 'Assist'])
      expect(screen.getByText(name)).toBeInTheDocument()
    expect(screen.getByText(/Nothing changes until someone taps/)).toBeInTheDocument()
  })

  it('reads a House that turned suggestions off before modes as Off', async () => {
    setup({ suggestions_off: true })
    expect(await slider()).toHaveAttribute('aria-valuetext', 'Off')
  })

  it('sliding to Assist saves at once and says what it does', async () => {
    const puts = setup({ autopilot_mode: 'suggest' })
    const s = await slider()
    s.focus()
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(puts).toEqual([{ autopilot_mode: 'assist' }]))
    await waitFor(() => expect(s).toHaveAttribute('aria-valuetext', 'Assist'))
    expect(
      screen.getByText(
        'Butler puts what it would have suggested on your lists before you shop. You can always undo. It never buys or books anything.',
      ),
    ).toBeInTheDocument()
  })

  it('goes back to the saved mode when the save fails', async () => {
    setup({ autopilot_mode: 'suggest' }, true)
    const s = await slider()
    s.focus()
    await userEvent.keyboard('{Home}')
    await waitFor(() => expect(s).toHaveAttribute('aria-valuetext', 'Suggest'))
  })
})
