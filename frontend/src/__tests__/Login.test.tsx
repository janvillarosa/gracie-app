import { http } from 'msw'
import { server } from '../testServer'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Login } from '@pages/Login'
import React from 'react'

// Mock useAuth to capture setApiKey without needing full provider
const setApiKeyMock = vi.fn()
vi.mock('@auth/AuthProvider', () => ({
  useAuth: () => ({ setApiKey: setApiKeyMock })
}))

// Mock useNavigate to avoid actual navigation
vi.mock('react-router-dom', async () => {
  const mod = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...mod,
    useNavigate: () => vi.fn(),
  }
})

describe('Login page', () => {
  it('logs in and stores api key', async () => {
    server.use(
      http.post('/api/auth/login', async ({ request }) => {
        const body = await request.json() as any
        if (!body?.username || !body?.password)
          return new Response(null, { status: 400 })
        return new Response(JSON.stringify({ api_key: 'k_123', user: { user_id: 'usr_1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
    )

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    )

    const email = screen.getByPlaceholderText('you@example.com')
    const pwd = screen.getByPlaceholderText('Your password')
    const btn = screen.getByRole('button', { name: /log in/i })
    expect(btn).toBeDisabled()
    fireEvent.change(email, { target: { value: 'a@b.com' } })
    fireEvent.change(pwd, { target: { value: 'pw' } })
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    await new Promise((r) => setTimeout(r, 50))
    expect(setApiKeyMock).toHaveBeenCalledWith('k_123')
  })
})
