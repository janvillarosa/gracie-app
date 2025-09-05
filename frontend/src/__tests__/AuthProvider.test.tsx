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

describe('AuthProvider', () => {
  it('clears invalid api key and navigates to /login', async () => {
    const getMe = endpoints.getMe as unknown as vi.Mock
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
      </MemoryRouter>
    )
    await waitFor(() => expect(localStorage.getItem('gracie_api_key')).toBeNull())
    expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true })
  })
})
