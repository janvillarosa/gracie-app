import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BrandLogo } from '@components/BrandLogo'

describe('BrandLogo', () => {
  it('renders the Bauhouse logo and link', () => {
    render(
      <MemoryRouter>
        <BrandLogo to="/login" />
      </MemoryRouter>
    )
    const container = screen.getByLabelText('Bauhouse logo')
    const img = within(container).getByAltText('Bauhouse')
    expect(img).toBeInTheDocument()
    const link = within(container).getByRole('link', { name: /go to app home/i })
    expect(link).toHaveAttribute('href', '/login')
  })
})
