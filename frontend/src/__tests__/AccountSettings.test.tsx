import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http } from 'msw'
import { server } from '../testServer'
import { AuthProvider } from '@auth/AuthProvider'
import { UserSettings } from '@pages/UserSettings'
import { RouteFallback } from '../routes/AppRoutes'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const me = {
  user_id: 'u1',
  name: 'Mia',
  username: 'mia@example.com',
  avatar_key: 'm',
  preferences: { trips_show_next_stop: true },
}

const renderAccount = (members = ['Mia', 'Sam']) => {
  localStorage.setItem('gracie_api_key', 'k_test')
  server.use(
    http.get('/api/me', () => json(me)),
    http.get('/api/rooms/me', () => json({ display_name: 'Elm Street', members })),
  )
  render(
    <MemoryRouter initialEntries={['/app/account']}>
      <AuthProvider>
        <QueryClientProvider client={new QueryClient()}>
          <Routes>
            <Route path="/app/account" element={<UserSettings />} />
            <Route path="/login" element={<div>Login page</div>} />
          </Routes>
        </QueryClientProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('Account settings', () => {
  it('says which House you are in and leads back to it', async () => {
    renderAccount()
    expect(await screen.findByText('In Elm Street')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Elm Street' })).toHaveAttribute('href', '/app')
  })

  it('saves the email on commit, and checks it first', async () => {
    let body: any = null
    server.use(
      http.patch('/api/me', async ({ request }) => {
        body = await request.json()
        return new Response(null, { status: 204 })
      }),
    )
    renderAccount()
    const email = await screen.findByRole('textbox', { name: 'Email' })
    await userEvent.clear(email)
    await userEvent.type(email, 'not-an-email{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent(/like you@example\.com/i)
    expect(body).toBeNull()
    await userEvent.clear(email)
    await userEvent.type(email, 'mia@home.test{Enter}')
    await waitFor(() => expect(body).toEqual({ username: 'mia@home.test' }))
  })

  it('says when an email is taken', async () => {
    server.use(http.patch('/api/me', () => json({ error: 'conflict' }, 409)))
    renderAccount()
    const email = await screen.findByRole('textbox', { name: 'Email' })
    await userEvent.clear(email)
    await userEvent.type(email, 'sam@example.com{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(/already used/i)
  })

  it('changes the password in its own sheet, with problems said inline', async () => {
    let body: any = null
    server.use(
      http.post('/api/me/password', async ({ request }) => {
        body = await request.json()
        if (body.current_password !== 'right-one') return json({ error: 'unauthorized' }, 401)
        return json({ api_key: 'k_new' })
      }),
    )
    renderAccount()
    await userEvent.click(await screen.findByRole('button', { name: /password/i }))
    const key = await screen.findByRole('button', { name: 'Change password' })
    await userEvent.type(screen.getByLabelText('New password'), 'short')
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('New password'), '-but-longer')
    await userEvent.type(screen.getByLabelText('New password again'), 'different')
    expect(screen.getByText(/doesn’t match/i)).toBeInTheDocument()
    expect(key).toBeDisabled()
    await userEvent.clear(screen.getByLabelText('New password again'))
    await userEvent.type(screen.getByLabelText('New password again'), 'short-but-longer')
    await userEvent.type(screen.getByLabelText('Current password'), 'wrong-one')
    await userEvent.click(key)
    expect(await screen.findByText(/isn’t your current password/i)).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Current password'))
    await userEvent.type(screen.getByLabelText('Current password'), 'right-one')
    await userEvent.click(key)
    await waitFor(() => expect(localStorage.getItem('gracie_api_key')).toBe('k_new'))
  })

  it('deletes the account only after DELETE is typed, saying what goes with it', async () => {
    let deleted = false
    server.use(
      http.delete('/api/me', () => {
        deleted = true
        return new Response(null, { status: 204 })
      }),
    )
    renderAccount(['Mia'])
    await userEvent.click(await screen.findByRole('button', { name: 'Delete account' }))
    expect(await screen.findByText(/only one in Elm Street, so it goes too/i)).toBeInTheDocument()
    const keys = screen.getAllByRole('button', { name: 'Delete account' })
    const key = keys[keys.length - 1]
    expect(key).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox', { name: /type delete/i }), 'DELETE')
    await userEvent.click(key)
    await waitFor(() => expect(deleted).toBe(true))
  })
})

describe('Route loading frame', () => {
  it('draws the top bar inside the app, so the page does not drop when it arrives', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/app/account']}>
        <RouteFallback />
      </MemoryRouter>,
    )
    expect(container.querySelector('.topnav')).not.toBeNull()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('stays bare outside the app', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/login']}>
        <RouteFallback />
      </MemoryRouter>,
    )
    expect(container.querySelector('.topnav')).toBeNull()
  })
})
