import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http } from 'msw'
import { server } from '../testServer'
import { AuthProvider } from '@auth/AuthProvider'
import { TopNav } from '@components/TopNav'

describe('TopNav', () => {
  it('shows avatar dropdown with Account settings and Log out', async () => {
    localStorage.setItem('gracie_api_key', 'k_test')
    server.use(
      http.get(
        '/api/me',
        () =>
          new Response(JSON.stringify({ user_id: 'u1', name: 'Alice', avatar_key: 'alice' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )

    const qc = new QueryClient()
    render(
      <MemoryRouter>
        <AuthProvider>
          <QueryClientProvider client={qc}>
            <TopNav />
          </QueryClientProvider>
        </AuthProvider>
      </MemoryRouter>,
    )

    const trigger = await screen.findByRole('button', { name: /open account menu/i })
    await userEvent.click(trigger)

    // Dropdown items should render in a portal
    expect(await screen.findByText('Account settings')).toBeInTheDocument()
    expect(screen.getByText('Log out')).toBeInTheDocument()

    await userEvent.click(screen.getByText('Log out'))
    // Key should be removed on logout
    expect(localStorage.getItem('gracie_api_key')).toBeNull()
  })
})
