import { http } from 'msw'
import { server } from '../testServer'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Register } from '@pages/Register'

describe('Register page', () => {
  it('disables submit until valid and calls API on submit', async () => {
    render(
      <MemoryRouter>
        <Register />
      </MemoryRouter>
    )
    const button = screen.getByRole('button', { name: /create account/i })
    expect(button).toBeDisabled()

    const email = screen.getByPlaceholderText('you@example.com')
    const pwd = screen.getByPlaceholderText('At least 8 characters')
    const name = screen.getByPlaceholderText('Your name (optional)')

    fireEvent.change(email, { target: { value: 'alice@example.com' } })
    fireEvent.change(pwd, { target: { value: 'password123' } })
    fireEvent.change(name, { target: { value: 'Alice' } })
    expect(button).not.toBeDisabled()

    let called = false
    server.use(
      http.post('/api/auth/register', () => {
        called = true
        return new Response(null, { status: 201 })
      })
    )

    fireEvent.click(button)
    // Allow microtasks to run
    await new Promise((r) => setTimeout(r, 50))
    expect(called).toBe(true)
  })
})
