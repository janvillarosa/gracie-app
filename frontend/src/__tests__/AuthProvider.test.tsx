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
  return { ...mod, getMe: vi.fn() }
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
  })
})
