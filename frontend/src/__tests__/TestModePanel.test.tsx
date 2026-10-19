import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http } from 'msw'
import { server } from '../testServer'
import { AuthProvider } from '@auth/AuthProvider'
import { UserSettings } from '@pages/UserSettings'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ACTIONS = [
  {
    id: 'push.test',
    label: 'Send me a test push',
    description: 'To your devices.',
    touches_house: false,
  },
  {
    id: 'adds.simulate',
    label: 'Simulate housemate adds',
    description: 'Adds three items.',
    touches_house: true,
  },
]

function renderAccount(testAccount: boolean) {
  localStorage.setItem('gracie_api_key', 'k_test')
  server.use(
    http.get('/api/me', () => json({ user_id: 'u1', name: 'Mia', test_account: testAccount })),
    http.get('/api/rooms/me', () => json({ display_name: 'Elm Street', members: ['Mia'] })),
    http.get('/api/me/notifications', () =>
      json({ itemAdds: true, autopilot: true, tripReminders: true }),
    ),
    http.get('/api/test/actions', () =>
      testAccount ? json({ actions: ACTIONS }) : json({ error: 'not found' }, 404),
    ),
  )
  render(
    <MemoryRouter initialEntries={['/app/account']}>
      <AuthProvider>
        <QueryClientProvider client={new QueryClient()}>
          <Routes>
            <Route path="/app/account" element={<UserSettings />} />
          </Routes>
        </QueryClientProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

afterEach(() => localStorage.clear())

describe('Test mode panel', () => {
  it('lists the server’s actions', async () => {
    renderAccount(true)
    expect(await screen.findByText('Send me a test push')).toBeInTheDocument()
    expect(screen.getByText('Simulate housemate adds')).toBeInTheDocument()
    expect(screen.getByText('Adds three items.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Run / })).toHaveLength(2)
  })

  it('runs one and shows what it said, busy meanwhile', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    renderAccount(true)
    server.use(
      http.post('/api/test/actions/push.test', async () => {
        await gate
        return json({ message: 'Sent to 2 of 2 devices' })
      }),
    )
    await userEvent.click(await screen.findByRole('button', { name: /Run Send me a test push/ }))
    expect(await screen.findByRole('button', { name: /Running…/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Run Simulate/ })).toBeDisabled()
    release()
    const status = await screen.findByText('Sent to 2 of 2 devices')
    expect(status).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => expect(screen.getByRole('button', { name: /Run Simulate/ })).toBeEnabled())
  })

  it('shows a refusal as the server worded it', async () => {
    renderAccount(true)
    server.use(
      http.post('/api/test/actions/adds.simulate', () =>
        json({ error: 'Sam isn’t a test account.' }, 409),
      ),
    )
    await userEvent.click(
      await screen.findByRole('button', { name: /Run Simulate housemate adds/ }),
    )
    expect(await screen.findByText('Sam isn’t a test account.')).toBeInTheDocument()
  })

  it('is not there for a normal account', async () => {
    renderAccount(false)
    await screen.findByText('Notifications')
    expect(screen.queryByText('Test mode')).toBeNull()
    expect(screen.queryByText('Send me a test push')).toBeNull()
  })
})
