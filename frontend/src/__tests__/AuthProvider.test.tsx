import React from 'react'
import { render, waitFor } from '@testing-library/react'
import * as endpoints from '@api/endpoints'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const mod = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...mod, useNavigate: () => navigateMock }
})

vi.mock('@api/endpoints', async () => {
  const mod = await vi.importActual<typeof import('@api/endpoints')>('@api/endpoints')
  return { ...mod, getMe: vi.fn(), logoutSession: vi.fn(() => Promise.resolve()) }
})

const mount = async () => {
  const { AuthProvider: Provider } = await import('@auth/AuthProvider')
  const { MemoryRouter } = await import('react-router-dom')
  render(
    <MemoryRouter>
      <Provider>
        <div data-testid="child" />
      </Provider>
    </MemoryRouter>,
  )
}

describe('AuthProvider', () => {
  beforeEach(() => {
    navigateMock.mockClear()
    ;(endpoints.logoutSession as unknown as ReturnType<typeof vi.fn>).mockClear()
    localStorage.clear()
  })

  it.each([
    ['offline', new TypeError('Failed to fetch')],
    ['a 5xx', Object.assign(new Error('internal server error'), { status: 503 })],
  ])('keeps the key and the trips database when launched with %s', async (_n, err) => {
    const getMe = endpoints.getMe as unknown as ReturnType<typeof vi.fn>
    getMe.mockRejectedValueOnce(err)
    localStorage.setItem('gracie_api_key', 'good')
    localStorage.setItem('bauhouse_trips_dbs', JSON.stringify(['bauhouse-trips-u1']))
    const wipe = vi.spyOn(indexedDB, 'deleteDatabase')
    await mount()
    await waitFor(() => expect(getMe).toHaveBeenCalled())
    await Promise.resolve()
    expect(localStorage.getItem('gracie_api_key')).toBe('good')
    expect(localStorage.getItem('bauhouse_trips_dbs')).not.toBeNull()
    expect(wipe).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
    wipe.mockRestore()
  })

  it('clears invalid api key and navigates to /login', async () => {
    const getMe = endpoints.getMe as unknown as ReturnType<typeof vi.fn>
    getMe.mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { status: 401 }))
    localStorage.setItem('gracie_api_key', 'bad')
    // import after mocks
    const { AuthProvider: Provider } = await import('@auth/AuthProvider')
    const { MemoryRouter } = await import('react-router-dom')
    render(
      <MemoryRouter>
        <Provider>
          <div data-testid="child" />
        </Provider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(localStorage.getItem('gracie_api_key')).toBeNull())
    expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true })
    // A refused key has no session left to end.
    expect(endpoints.logoutSession).not.toHaveBeenCalled()
  })

  it('logging out signs out at once but keeps changes that could not be sent', async () => {
    const getMe = endpoints.getMe as unknown as ReturnType<typeof vi.fn>
    getMe.mockResolvedValue({ user_id: 'u_out' })
    localStorage.setItem('gracie_api_key', 'good')
    const { getTripStore, TripStore, getPendingOnLogout, resetTripStores } = await import(
      '@lib/trips/store'
    )
    const { wipeTripDatabases } = await import('@lib/trips/db')
    const offline = {
      sync: () => Promise.reject(new Error('offline')),
      ops: () => Promise.reject(new Error('offline')),
    }
    const store = getTripStore(
      'u_out:r',
      () => new TripStore({ roomId: 'r', userId: 'u_out', api: offline }),
    )
    await store.hydrate()
    store.createTrip({ title: 'Unsent' })
    await store.settle()
    const { AuthProvider: Provider, useAuth } = await import('@auth/AuthProvider')
    const { MemoryRouter } = await import('react-router-dom')
    const Out: React.FC = () => {
      const { setApiKey } = useAuth()
      return <button onClick={() => setApiKey(null)}>out</button>
    }
    const { getByText } = render(
      <MemoryRouter>
        <Provider>
          <Out />
        </Provider>
      </MemoryRouter>,
    )
    getByText('out').click()
    await waitFor(() => expect(localStorage.getItem('gracie_api_key')).toBeNull())
    await waitFor(() => expect(getPendingOnLogout()).toBe(1))
    // Only this device's session ends, with the key it held, once the queue was tried.
    await waitFor(() => expect(endpoints.logoutSession).toHaveBeenCalledWith('good'))
    expect((await indexedDB.databases()).map((d) => d.name)).toContain('bauhouse-trips-u_out')
    await resetTripStores()
    await wipeTripDatabases()
  })
})
