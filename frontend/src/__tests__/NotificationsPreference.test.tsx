import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http } from 'msw'
import { server } from '../testServer'
import { AuthProvider, useAuth } from '@auth/AuthProvider'
import { NotificationsPreference } from '@components/NotificationsPreference'
import { fake, fakeSubscription, installPush, IPHONE, PUBLIC_KEY, restorePush } from './pushFake'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const PREFS = { itemAdds: true, autopilot: true, tripReminders: false }

const SignOut: React.FC = () => {
  const { signOut } = useAuth()
  return (
    <button type="button" onClick={() => void signOut('user')}>
      Sign out
    </button>
  )
}

function renderSection(extra?: React.ReactNode) {
  localStorage.setItem('gracie_api_key', 'k_test')
  const saved: unknown[] = []
  const subs: { method: string; body: unknown }[] = []
  server.use(
    http.get('/api/me', () => json({ user_id: 'u1', name: 'Mia' })),
    http.get('/api/push/key', () => json({ publicKey: PUBLIC_KEY })),
    http.put('/api/push/subscriptions', async ({ request }) => {
      subs.push({ method: 'PUT', body: await request.json() })
      return new Response(null, { status: 204 })
    }),
    http.delete('/api/push/subscriptions', async ({ request }) => {
      subs.push({ method: 'DELETE', body: await request.json() })
      return new Response(null, { status: 204 })
    }),
    http.get('/api/me/notifications', () => json(PREFS)),
    http.put('/api/me/notifications', async ({ request }) => {
      saved.push(await request.json())
      return new Response(null, { status: 204 })
    }),
  )
  render(
    <MemoryRouter>
      <AuthProvider>
        <QueryClientProvider client={new QueryClient()}>
          <NotificationsPreference />
          {extra}
        </QueryClientProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
  return { saved, subs }
}

afterEach(() => {
  restorePush()
  localStorage.clear()
})

describe('Notifications in Account settings', () => {
  it('turns on from one key, then shows the three kinds', async () => {
    installPush()
    const { subs } = renderSection()
    const key = await screen.findByRole('button', { name: 'Turn on notifications' })
    await waitFor(() => expect(key).toBeEnabled())
    expect(screen.queryByRole('switch')).toBeNull()
    await userEvent.click(key)
    expect(await screen.findByRole('switch', { name: 'Housemates add things' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Autopilot adds things' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Trip reminders' })).not.toBeChecked()
    expect(fake.requestPermission).toHaveBeenCalledTimes(1)
    expect(subs[0]).toMatchObject({
      method: 'PUT',
      body: { endpoint: 'https://push.example.com/new' },
    })
  })

  it('saves a kind as it changes', async () => {
    installPush({ permission: 'granted', subscription: fakeSubscription('https://p.example/a') })
    const { saved } = renderSection()
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Trip reminders' })).toBeEnabled(),
    )
    await userEvent.click(screen.getByRole('switch', { name: 'Trip reminders' }))
    await waitFor(() => expect(saved).toEqual([{ ...PREFS, tripReminders: true }]))
    expect(screen.getByRole('switch', { name: 'Trip reminders' })).toBeChecked()
  })

  it('puts a kind back when the server says no', async () => {
    installPush({ permission: 'granted', subscription: fakeSubscription('https://p.example/a') })
    renderSection()
    server.use(http.put('/api/me/notifications', () => json({ error: 'nope' }, 400)))
    const autopilot = await screen.findByRole('switch', { name: 'Autopilot adds things' })
    await waitFor(() => expect(autopilot).toBeEnabled())
    await userEvent.click(autopilot)
    await waitFor(() => expect(autopilot).toBeChecked())
    expect(await screen.findByText('nope')).toBeInTheDocument()
  })

  it('turns off on this device', async () => {
    const sub = fakeSubscription('https://p.example/a')
    installPush({ permission: 'granted', subscription: sub })
    const { subs } = renderSection()
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off on this device' }))
    expect(await screen.findByRole('button', { name: 'Turn on notifications' })).toBeInTheDocument()
    expect(sub.unsubscribe).toHaveBeenCalled()
    expect(subs).toContainEqual({ method: 'DELETE', body: { endpoint: 'https://p.example/a' } })
  })

  it('says how to add Bauhouse to the Home Screen on an iPhone in Safari', async () => {
    installPush({ ua: IPHONE })
    renderSection()
    expect(screen.getByText('Add Bauhouse to your Home Screen first')).toBeInTheDocument()
    expect(screen.getByText('Choose Add to Home Screen.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).toBeNull()
  })

  it('says where to unblock them once blocked', async () => {
    installPush({ permission: 'denied' })
    renderSection()
    expect(screen.getByText('Notifications are blocked')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('moves to blocked when the prompt is answered no', async () => {
    installPush({ answer: 'denied' })
    renderSection()
    const key = await screen.findByRole('button', { name: 'Turn on notifications' })
    await waitFor(() => expect(key).toBeEnabled())
    await userEvent.click(key)
    expect(await screen.findByText('Notifications are blocked')).toBeInTheDocument()
  })

  it('says so in a browser without push', () => {
    installPush({ noApis: true })
    renderSection()
    expect(screen.getByText('Not in this browser')).toBeInTheDocument()
  })

  it('says when turning on failed, and stays off', async () => {
    installPush()
    renderSection()
    server.use(http.get('/api/push/key', () => json({ error: 'push is off here' }, 404)))
    const key = await screen.findByRole('button', { name: 'Turn on notifications' })
    await waitFor(() => expect(key).toBeEnabled())
    await userEvent.click(key)
    expect(await screen.findByText('push is off here')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn on notifications' })).toBeEnabled()
  })

  it('hands the subscription over on start, and takes it off the server on sign out', async () => {
    const sub = fakeSubscription('https://p.example/a')
    installPush({ permission: 'granted', subscription: sub })
    const { subs } = renderSection(<SignOut />)
    await waitFor(() =>
      expect(subs).toContainEqual({
        method: 'PUT',
        body: expect.objectContaining({ endpoint: 'https://p.example/a' }),
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(sub.unsubscribe).toHaveBeenCalled())
    expect(subs).toContainEqual({ method: 'DELETE', body: { endpoint: 'https://p.example/a' } })
  })
})
