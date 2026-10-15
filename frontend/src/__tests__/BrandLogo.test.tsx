import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BrandLogo } from '@components/BrandLogo'
import { startWelcome, WELCOME_MS } from '@lib/welcome'

describe('BrandLogo', () => {
  it('renders the Bauhouse logo and link', () => {
    render(
      <MemoryRouter>
        <BrandLogo to="/login" />
      </MemoryRouter>,
    )
    const container = screen.getByLabelText('Bauhouse logo')
    expect(within(container).getByRole('img', { name: 'Bauhouse' })).toBeInTheDocument()
    const link = within(container).getByRole('link', { name: /go to app home/i })
    expect(link).toHaveAttribute('href', '/login')
  })

  it('can name its link for where it goes', () => {
    render(
      <MemoryRouter>
        <BrandLogo to="/" linkLabel="Bauhouse home" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Bauhouse home' })).toHaveAttribute('href', '/')
  })

  it('plays the welcome only for a logo that mounts just after logging in', () => {
    let now = 1000
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    startWelcome()
    const { unmount } = render(
      <MemoryRouter>
        <BrandLogo />
      </MemoryRouter>,
    )
    expect(screen.getByRole('img', { name: 'Bauhouse' })).toHaveClass('is-welcome')
    unmount()

    now += WELCOME_MS
    render(
      <MemoryRouter>
        <BrandLogo />
      </MemoryRouter>,
    )
    expect(screen.getByRole('img', { name: 'Bauhouse' })).not.toHaveClass('is-welcome')
    clock.mockRestore()
  })
})
