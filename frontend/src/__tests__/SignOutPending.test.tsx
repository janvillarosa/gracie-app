import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Login } from '@pages/Login'
import { UserSettings } from '@pages/UserSettings'
import { server } from '../testServer'

// The data layer's count of trip changes that were not sent at the last sign-out.
const pending = { n: 0, subs: new Set<() => void>() }
const setPending = (n: number) => {
  pending.n = n
  for (const f of pending.subs) f()
}
vi.mock('@lib/trips/hooks', async (orig) => ({
  ...(await orig<typeof import('@lib/trips/hooks')>()),
  getPendingOnLogout: () => pending.n,
  subscribePendingOnLogout: (fn: () => void) => {
    pending.subs.add(fn)
    return () => pending.subs.delete(fn)
  },
}))

const auth = { apiKey: 'k_1', setApiKey: vi.fn(), signOut: vi.fn(async () => 0) }
vi.mock('@auth/AuthProvider', () => ({ useAuth: () => auth }))

const navigate = vi.fn()
vi.mock('@lib/viewTransition', async (orig) => ({
  ...(await orig<typeof import('@lib/viewTransition')>()),
  useTransitionNavigate: () => navigate,
}))

beforeEach(() => {
  setPending(0)
  auth.signOut.mockClear()
  auth.setApiKey.mockClear()
  navigate.mockClear()
})

describe('Login after a sign-out with unsent trip changes', () => {
  const page = () =>
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )

  it('says nothing when everything was sent', () => {
    page()
    expect(screen.queryByText(/couldn’t be sent/)).not.toBeInTheDocument()
  })

  it('warns above the form, with the count, and keeps up with it', async () => {
    page()
    act(() => setPending(3))
    const note = await screen.findByText(/3 changes to your trips couldn’t be sent/)
    expect(note.closest('.ui-note')).toHaveClass('is-warn')
    expect(note).toHaveTextContent('Log in again on this device to send them.')
    // Above the form.
    const form = screen.getByPlaceholderText('you@example.com').closest('form') as HTMLElement
    expect(note.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    act(() => setPending(1))
    expect(await screen.findByText(/1 change to your trips couldn’t be sent/)).toBeInTheDocument()
    expect(screen.getByText(/to send it\./)).toBeInTheDocument()
    act(() => setPending(0))
    await waitFor(() => expect(screen.queryByText(/couldn’t be sent/)).not.toBeInTheDocument())
  })
})

describe('Account deletion', () => {
  it('signs out as expired, so the trips data layer handles what is left', async () => {
    server.use(
      http.get('/api/me', () =>
        Response.json({ user_id: 'usr_1', name: 'Jan', username: 'jan@example.com' }),
      ),
      http.delete('/api/me', () => new Response(null, { status: 204 })),
    )
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <UserSettings />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Delete account' }))
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Type DELETE to confirm' }),
      'DELETE',
    )
    const keys = screen.getAllByRole('button', { name: 'Delete account' })
    await userEvent.click(keys[keys.length - 1])
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith('expired'))
    expect(auth.setApiKey).not.toHaveBeenCalled()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replace: true }))
  })
})
