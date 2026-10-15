import { CreateHouseModal } from '@components/CreateHouseModal'
import { PENDING_HOUSE_KEY, takePendingHouse } from '@lib/pendingHouse'
import { Landing } from '@pages/Landing'
import { AppRoutes } from '@routes/AppRoutes'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

let authed = false
vi.mock('@auth/AuthProvider', () => ({
  useAuth: () => ({ isAuthed: authed }),
}))

const renderLanding = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/register" element={<p>Register page</p>} />
      </Routes>
    </MemoryRouter>,
  )

describe('Landing page', () => {
  beforeEach(() => {
    authed = false
    sessionStorage.clear()
  })

  it('leads with the pitch and the sign-up key', () => {
    renderLanding()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Manage your life together.' }),
    ).toBeInTheDocument()
    const demo = screen.getByRole('list', { name: 'The House’s list' })
    for (const line of [
      'Simple enough',
      'sorts your list into aisles',
      'Everyone at home',
      'Works without signal',
    ]) {
      expect(within(demo).getByText(new RegExp(line))).toBeInTheDocument()
    }
    expect(screen.getAllByRole('link', { name: 'Try Bauhouse free' })[0]).toHaveAttribute(
      'href',
      '/register',
    )
  })

  it('adds the visitor’s line, stamps it, and Sam ticks it off', async () => {
    renderLanding()
    const bar = screen.getByRole('textbox', { name: 'Add an item' })
    fireEvent.change(bar, { target: { value: 'oat milk' } })
    fireEvent.submit(bar)
    const list = screen.getByRole('list', { name: 'The House’s list' })
    expect(within(list).getByText('Oat milk')).toBeInTheDocument()
    expect(bar).toHaveValue('')
    expect(await within(list).findByText('Dairy')).toBeInTheDocument()
    // Sam ticks it, and it folds away under the checked-off items, as on the List page.
    const toggle = await screen.findByRole(
      'button',
      { name: 'Show checked-off items (1)' },
      { timeout: 5000 },
    )
    expect(within(list).queryByText('Oat milk')).toBeNull()
    fireEvent.click(toggle)
    const done = screen.getByRole('list', { name: 'Checked-off items' })
    expect(within(done).getByRole('checkbox', { name: /Oat milk/ })).toBeChecked()
  })

  it('ignores an empty line', () => {
    renderLanding()
    const bar = screen.getByRole('textbox', { name: 'Add an item' })
    fireEvent.change(bar, { target: { value: '   ' } })
    fireEvent.submit(bar)
    expect(
      within(screen.getByRole('list', { name: 'The House’s list' })).getAllByRole('listitem'),
    ).toHaveLength(4)
  })

  it('stops the demo when the list is full and points to sign-up', () => {
    renderLanding()
    const bar = screen.getByRole('textbox', { name: 'Add an item' })
    for (let i = 0; i < 9; i++) {
      fireEvent.change(bar, { target: { value: `thing ${i}` } })
      fireEvent.submit(bar)
    }
    expect(bar).toBeDisabled()
    expect(bar).toHaveAttribute('placeholder', 'This list is full')
    expect(
      screen.getByText('That’s a full list. Create a free account to keep adding.'),
    ).toBeInTheDocument()
  })

  it('splits the page plainly into the House’s lists and trip planning', () => {
    renderLanding()
    const nav = screen.getByRole('navigation', { name: 'What Bauhouse is for' })
    expect(within(nav).getByRole('link', { name: /Lists for the house/ })).toHaveAttribute(
      'href',
      '#lists',
    )
    expect(within(nav).getByRole('link', { name: /Trip planning/ })).toHaveAttribute(
      'href',
      '#trips',
    )
    // Each part is its own labelled section, in that order.
    const lists = screen.getByRole('heading', { level: 2, name: 'Lists for the house.' })
    const trips = screen.getByRole('heading', { level: 2, name: 'Plan the trip in one place.' })
    expect(lists.compareDocumentPosition(trips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(lists.closest('section')).toHaveAttribute('id', 'lists')
    expect(trips.closest('section')).toHaveAttribute('id', 'trips')
  })

  it('sells not having to fiddle: no template, no spreadsheet, every device', () => {
    renderLanding()
    expect(
      screen.getByText(/no Notion template to build and no Google Sheet or Doc to share around/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/No Notion template to build, no Google Sheet to share/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Every device, with or without signal.' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/installs to your home screen/)).toBeInTheDocument()
    // The typing list is decoration for sighted visitors.
    expect(screen.getByText('Basmati rice').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('rings the whole House up at nothing', () => {
    renderLanding()
    expect(screen.getByRole('heading', { level: 2, name: 'It costs nothing.' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Total 0\.00, nothing due/ })).toBeInTheDocument()
  })

  it('holds itinerary changes while there is no signal', () => {
    renderLanding()
    const signal = screen.getByRole('switch', { name: 'No signal' })
    fireEvent.click(signal)
    expect(signal).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('checkbox', { name: /Tram 28 to Graça/ }))
    expect(screen.getByText('No signal. 1 change saved on this phone')).toBeInTheDocument()
    expect(screen.getByText('Waiting')).toBeInTheDocument()
    fireEvent.click(signal)
    expect(screen.getByText('Back online. 1 change synced')).toBeInTheDocument()
  })

  it('keeps the House name from the closing sentence and goes to sign-up', async () => {
    renderLanding()
    fireEvent.change(screen.getByRole('textbox', { name: 'Your House’s name' }), {
      target: { value: '  The Flat  ' },
    })
    expect(screen.getByRole('textbox', { name: 'Your House’s name' })).toHaveAttribute(
      'placeholder',
      'Our Little Mansion',
    )
    fireEvent.click(screen.getByRole('button', { name: 'start.' }))
    expect(await screen.findByText('Register page')).toBeInTheDocument()
    expect(sessionStorage.getItem(PENDING_HOUSE_KEY)).toBe('The Flat')
  })

  it('keeps the headline readable while its word cycles', () => {
    renderLanding()
    const h1 = screen.getByRole('heading', { level: 1 })
    // The cycling word is decoration for sighted visitors; the heading's name stays put.
    expect(h1).toHaveAccessibleName('Manage your life together.')
    expect(within(h1).getByText('life', { selector: '[aria-hidden="true"]' })).toBeInTheDocument()
  })

  it('says which line of the plan each photo shows', () => {
    renderLanding()
    expect(screen.getByText(/The 11:00 stop on Saturday’s plan: Tram 28/)).toBeInTheDocument()
    expect(
      screen.getByText(/Santa Apolónia, where Sunday’s 09:09 to Porto leaves from/),
    ).toBeInTheDocument()
    expect(screen.getByText('Alfama, where Saturday ends: dinner at 20:00.')).toBeInTheDocument()
  })

  it('credits every found photo', () => {
    renderLanding()
    for (const who of ['Dale Cruse', 'Vernaccia', 'Metro Centric']) {
      expect(screen.getByRole('link', { name: who })).toHaveAttribute(
        'href',
        expect.stringContaining('wikimedia.org'),
      )
    }
  })
})

describe('Landing route', () => {
  it('shows the landing page at / to visitors who are not signed in', async () => {
    authed = false
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Manage your life together.' }),
    ).toBeInTheDocument()
  })

  it('sends signed-in members past it', async () => {
    authed = true
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/app" element={<p>House home</p>} />
          <Route path="*" element={<AppRoutes />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('House home')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Manage your life together.' })).toBeNull()
  })
})

describe('pending House name', () => {
  beforeEach(() => sessionStorage.clear())

  it('is read once', () => {
    sessionStorage.setItem(PENDING_HOUSE_KEY, 'The Flat')
    expect(takePendingHouse()).toBe('The Flat')
    expect(takePendingHouse()).toBe('')
  })

  it('fills the create-a-house name field', () => {
    sessionStorage.setItem(PENDING_HOUSE_KEY, 'The Flat')
    render(<CreateHouseModal open onClose={() => {}} onSubmit={() => {}} />)
    expect(screen.getByPlaceholderText('e.g., Our Little Mansion')).toHaveValue('The Flat')
  })
})
