import React from 'react'
import { CreateHouseSheet } from '@components/CreateHouseSheet'
import { isAppleTouch, listenForInstallPrompt, resetInstallPrompt } from '@lib/installPrompt'
import { PENDING_HOUSE_KEY, takePendingHouse } from '@lib/pendingHouse'
import { HeroSheet } from '@components/landing/HeroSheet'
import { PlanDesk } from '@components/landing/PlanDesk'
import { useScrollProgress } from '@components/landing/useScrollProgress'
import { Landing } from '@pages/Landing'
import { AppRoutes } from '@routes/AppRoutes'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('leads with a short, real list and the sign-up key', () => {
    renderLanding()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Manage your life together.' }),
    ).toBeInTheDocument()
    const demo = screen.getByRole('list', { name: 'The House’s list' })
    expect(
      within(demo)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['LemonsProduce', 'Bin bagsHousehold', 'Porto train ticketsTrips'])
    expect(screen.getAllByRole('link', { name: 'Get started free' })[0]).toHaveAttribute(
      'href',
      '/register',
    )
  })

  it('never says “try”, which reads as a trial with a paywall after it', () => {
    renderLanding()
    expect(screen.queryAllByRole('link', { name: /try/i })).toHaveLength(0)
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
    ).toHaveLength(3)
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

  it('introduces Butler before the lists, and names what it never does', () => {
    renderLanding()
    const butler = screen.getByRole('heading', { level: 2, name: 'Meet Butler.' })
    const lists = screen.getByRole('heading', { level: 2, name: 'Lists that sort themselves.' })
    expect(butler.closest('section')).toHaveAttribute('id', 'butler')
    expect(butler.compareDocumentPosition(lists) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Butler' })).toHaveAttribute('href', '#butler')
    expect(screen.getByText(/It never buys or books anything for you/)).toBeInTheDocument()
  })

  it('walks a week with Butler as three moments the visitor can pick', () => {
    renderLanding()
    const tabs = within(screen.getByRole('tablist', { name: 'A week with Butler' })).getAllByRole(
      'tab',
    )
    expect(tabs.map((t) => t.querySelector('.ld-moment-title')?.textContent)).toEqual([
      'Before you run out',
      'Before the shop',
      'In the shop',
    ])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    const panel = screen.getByRole('tabpanel', { name: /Before you run out/ })
    expect(within(panel).getByText('You add it weekly')).toBeInTheDocument()
    // The drawn sheet is decoration; the panel says what it shows in words.
    expect(within(panel).getByText(/Butler suggests oat milk/)).toBeInTheDocument()

    fireEvent.click(tabs[1])
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(within(panel).getByText('Added 3 for Saturday')).toBeInTheDocument()
    expect(within(panel).getByText('Added by Butler. You buy it about every 9 days')).toBeVisible()

    // Arrow keys move between moments, as in the app's tabs.
    fireEvent.keyDown(tabs[1], { key: 'ArrowDown' })
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[2]).toHaveFocus()
    expect(within(panel).getByText('Usually next · then Butter')).toBeInTheDocument()
    fireEvent.keyDown(tabs[2], { key: 'Home' })
    expect(tabs[0]).toHaveFocus()
    fireEvent.keyDown(tabs[0], { key: 'End' })
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true')
  })

  it('splits the page plainly into the House’s lists and trip planning', () => {
    renderLanding()
    const lists = screen.getByRole('heading', { level: 2, name: 'Lists that sort themselves.' })
    const trips = screen.getByRole('heading', { level: 2, name: 'Plan the trip together.' })
    expect(lists.compareDocumentPosition(trips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(lists.closest('section')).toHaveAttribute('id', 'lists')
    expect(trips.closest('section')).toHaveAttribute('id', 'trips')
    // Working with no signal is a trip promise (trips keep a copy on the phone; lists don't yet).
    fireEvent.click(screen.getByRole('tab', { name: 'On the trip' }))
    const offline = screen.getByRole('heading', {
      level: 3,
      name: 'On the trip, even with no signal.',
    })
    expect(offline.closest('section')).toHaveAttribute('id', 'trips')
  })

  it('shows the trip two ways: planning at home, and on the trip', () => {
    renderLanding()
    const plan = screen.getByRole('tab', { name: 'Planning at home' })
    const trip = screen.getByRole('tab', { name: 'On the trip' })
    expect(plan).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Planning at home' })).toBeVisible()
    expect(screen.queryByRole('tabpanel', { name: 'On the trip' })).toBeNull()
    fireEvent.click(trip)
    expect(trip).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'On the trip' })).toBeVisible()
    expect(screen.queryByRole('tabpanel', { name: 'Planning at home' })).toBeNull()
    // Arrow keys move between the two, as in the app's tabs.
    fireEvent.keyDown(trip, { key: 'ArrowLeft' })
    expect(plan).toHaveAttribute('aria-selected', 'true')
    expect(plan).toHaveFocus()
  })

  it('lets a visitor put ideas on their days until the trip is ready to go', async () => {
    renderLanding()
    const desk = screen.getByRole('region', { name: 'Ready to go?' })
    expect(within(desk).getByText('Sun 26 has nothing planned yet')).toBeInTheDocument()
    expect(screen.getByText('Nothing planned yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Put Livraria Lello on Sunday at 10:30/ }))
    expect(screen.queryByText('Nothing planned yet')).toBeNull()
    const days = document.querySelector('.ld-plan-days') as HTMLElement
    expect(within(days).getByText('Livraria Lello')).toBeInTheDocument()
    expect(screen.getByText('Ready to go')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Put Francesinha on Saturday at 13:00/ }))
    // Saturday's new stop lands between the others, in time order.
    const sat = within(document.querySelector('.ld-plan-days') as HTMLElement).getAllByText(
      /^(São Bento station|Francesinha|Dinner in Ribeira)$/,
    )
    expect(sat.map((e) => e.textContent)).toEqual([
      'São Bento station',
      'Francesinha',
      'Dinner in Ribeira',
    ])
  })

  it('shows the next stop on the phone, with the booking code a counter asks for', () => {
    renderLanding()
    fireEvent.click(screen.getByRole('tab', { name: 'On the trip' }))
    const next = screen.getByRole('region', { name: 'Next stop' })
    expect(within(next).getByRole('heading', { name: 'Santa Apolónia' })).toBeInTheDocument()
    const code = within(next).getByRole('button', { name: 'Show code' })
    fireEvent.click(code)
    expect(code).toHaveAttribute('aria-expanded', 'true')
    expect(within(next).getByText('7HQ2KD')).toBeInTheDocument()
    // Ticking it off brings the next stop up.
    fireEvent.click(within(next).getByRole('button', { name: 'Tick off Train to Porto' }))
    expect(
      within(screen.getByRole('region', { name: 'Next stop' })).getByRole('heading', {
        name: 'São Bento station',
      }),
    ).toBeInTheDocument()
  })

  it('leads with home and trips together, and introduces the House', () => {
    renderLanding()
    const lede = screen.getByText(/one notebook for everyone you live with/)
    expect(lede).toHaveTextContent(/The weekly shop goes in it, and so does the next trip/)
    expect(lede).toHaveTextContent(/Butler, who learns your House’s routine/)
    expect(screen.queryByText(/Notion/)).toBeNull()
    expect(screen.queryByText(/aisle/i)).toBeNull()
    // The typing list is decoration for sighted visitors.
    expect(screen.getByText('Basmati rice').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('says plainly how bookings get in', () => {
    renderLanding()
    fireEvent.click(screen.getByRole('tab', { name: 'On the trip' }))
    expect(screen.getByText(/types it in once, code included/)).toBeInTheDocument()
  })

  it('rings the whole House up at nothing', () => {
    renderLanding()
    expect(screen.getByRole('heading', { level: 2, name: 'It costs nothing.' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Total 0\.00, nothing due/ })).toBeInTheDocument()
    expect(screen.getByText(/no ads and no paid plan waiting/)).toBeInTheDocument()
  })

  it('holds itinerary changes while there is no signal', () => {
    renderLanding()
    fireEvent.click(screen.getByRole('tab', { name: 'On the trip' }))
    const signal = screen.getByRole('switch', { name: 'No signal' })
    fireEvent.click(signal)
    expect(signal).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('checkbox', { name: /São Bento station/ }))
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
    expect(
      screen.getByText('São Bento station, the 11:00 stop on Saturday’s plan.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Santa Apolónia, where Saturday’s 09:09 to Porto leaves from.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Ribeira, where Saturday ends: dinner at 20:00.')).toBeInTheDocument()
    // Each photo's line carries the highlighter where it appears on screen.
    expect(document.querySelector('.ld-dayrow.is-marked')).toHaveTextContent('São Bento station')
    expect(document.querySelector('.ld-next-title.ld-mark')).toHaveTextContent('Santa Apolónia')
    expect(document.querySelector('.ld-slip .ld-mark')).toHaveTextContent('Dinner in Ribeira')
  })

  it('credits every found photo', () => {
    renderLanding()
    for (const who of ['Michael Gaylard', 'Jakub Hałun', 'Metro Centric']) {
      expect(screen.getByRole('link', { name: who })).toHaveAttribute(
        'href',
        expect.stringContaining('wikimedia.org'),
      )
    }
  })
})

describe('kinetic type', () => {
  it('keeps every set heading readable as one sentence', () => {
    renderLanding()
    for (const name of [
      'Meet Butler.',
      'Lists that sort themselves.',
      'Plan the trip together.',
      'It costs nothing.',
    ]) {
      const h = screen.getByRole('heading', { level: 2, name })
      // Without an observer (as without JavaScript) a heading is simply set.
      expect(h).toHaveAttribute('data-set')
    }
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(
      'Manage your life together.',
    )
  })

  it('colours one word of each heading', () => {
    renderLanding()
    expect(screen.getByText('themselves.')).toHaveClass('is-red')
    expect(screen.getByText('Butler.', { selector: '.ld-w-in' })).toHaveClass('is-mark')
    expect(screen.getByText('together.', { selector: '.ld-w-in' })).toHaveClass('is-blue')
    expect(screen.getByText('nothing.')).toHaveClass('is-mark')
  })

  it('keeps the decorative type away from screen readers', () => {
    renderLanding()
    expect(document.querySelector('.ld-margin-word')).toHaveAttribute('aria-hidden', 'true')
    expect(document.querySelector('.ld-band')).toHaveAttribute('aria-hidden', 'true')
    expect(document.querySelector('.ld-band')).toHaveTextContent(
      /Groceries.*Chores.*Trips.*Notices.*Suggests.*Adds/,
    )
  })
})

describe('scroll progress', () => {
  type Seen = (entries: Array<{ isIntersecting: boolean }>) => void
  let seen: Seen | null = null
  beforeEach(() => {
    seen = null
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: Seen) {
          seen = cb
        }
        observe() {}
        disconnect() {}
      },
    )
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const Probe: React.FC<{ mode: 'leave' | 'through' }> = ({ mode }) => {
    const ref = React.useRef<HTMLDivElement>(null)
    useScrollProgress(ref, mode)
    return <div ref={ref} data-testid="probe" />
  }

  it('writes how far an element has scrolled past the top', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: -250,
      height: 1000,
    } as DOMRect)
    render(<Probe mode="leave" />)
    act(() => seen?.([{ isIntersecting: true }]))
    expect(screen.getByTestId('probe').style.getPropertyValue('--p')).toBe('0.250')
  })

  it('does nothing with reduced motion, so the page rests in its final state', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    render(<Probe mode="through" />)
    expect(seen).toBeNull()
    expect(screen.getByTestId('probe').style.getPropertyValue('--p')).toBe('')
  })
})

describe('putting it on the home screen', () => {
  beforeAll(() => listenForInstallPrompt())
  afterEach(() => {
    act(() => resetInstallPrompt())
    vi.restoreAllMocks()
  })

  it('offers an install button where the browser can install it', async () => {
    renderLanding()
    expect(screen.queryByRole('button', { name: 'Install Bauhouse' })).toBeNull()
    const prompt = vi.fn().mockResolvedValue(undefined)
    const e = Object.assign(new Event('beforeinstallprompt'), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    })
    act(() => void window.dispatchEvent(e))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Install Bauhouse' })))
    expect(prompt).toHaveBeenCalledOnce()
    // Installed: the button goes and doesn't come back.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Install Bauhouse' })).toBeNull(),
    )
  })

  it('drops the button once the browser says it is installed', () => {
    renderLanding()
    const e = Object.assign(new Event('beforeinstallprompt'), {
      prompt: vi.fn(),
      userChoice: new Promise(() => {}),
    })
    act(() => void window.dispatchEvent(e))
    expect(screen.getByRole('button', { name: 'Install Bauhouse' })).toBeInTheDocument()
    act(() => void window.dispatchEvent(new Event('appinstalled')))
    expect(screen.queryByRole('button', { name: 'Install Bauhouse' })).toBeNull()
  })

  it('gives Safari’s one step on iPhone, where no button can install it', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
    )
    renderLanding()
    expect(screen.getByText(/tap Share, then/)).toHaveTextContent('Add to Home Screen')
    expect(screen.queryByRole('button', { name: 'Install Bauhouse' })).toBeNull()
  })

  it('just says where it runs anywhere else', () => {
    renderLanding()
    expect(
      screen.getByText(/works in the browser on iPhones, Android phones and laptops/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Add to Home Screen/)).toBeNull()
  })

  it('knows an iPad that reports itself as a Mac', () => {
    expect(isAppleTouch('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true)
    expect(isAppleTouch('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false)
    expect(isAppleTouch('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 5)).toBe(false)
  })
})

describe('housemates adding to the first list', () => {
  type Seen = (entries: Array<{ isIntersecting: boolean }>) => void
  const watchers = new Map<Element, Seen>()
  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private cb: Seen) {}
        observe(el: Element) {
          watchers.set(el, this.cb)
        }
        unobserve() {}
        disconnect() {}
      },
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  // Real timers, sped up: a housemate adds a line every 70ms.
  const renderList = () => {
    render(<HeroSheet mateEveryMs={70} />)
    const stack = document.querySelector('.ld-hero-device') as Element
    act(() => watchers.get(stack)?.([{ isIntersecting: true }]))
  }
  const list = () => screen.getByRole('list', { name: 'The House’s list' })

  it('adds lines while it is on screen and says who added the last one', async () => {
    renderList()
    expect(await within(list()).findByText('Yogurt')).toBeInTheDocument()
    expect(await screen.findByText(/^(Mia|Sam|Jo) added /)).toBeInTheDocument()
    expect(await within(list()).findByText('Passports')).toBeInTheDocument()
    // The oldest line is ticked off so the list stays short.
    await waitFor(() => expect(within(list()).queryByText('Porto train tickets')).toBeNull())
  })

  it('waits while the visitor is typing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      renderList()
      fireEvent.focus(screen.getByRole('textbox', { name: 'Add an item' }))
      await act(() => vi.advanceTimersByTimeAsync(700))
      expect(within(list()).getAllByRole('listitem')).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('planning desk playing itself', () => {
  type Seen = (entries: Array<{ isIntersecting: boolean }>) => void
  const watchers = new Map<Element, Seen>()
  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private cb: Seen) {}
        observe(el: Element) {
          watchers.set(el, this.cb)
        }
        unobserve() {}
        disconnect() {}
      },
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  const show = () => {
    render(<PlanDesk autoplayMs={60} />)
    const desk = document.querySelector('.device-macbook-pro') as Element
    act(() => watchers.get(desk)?.([{ isIntersecting: true }]))
  }

  it('lands the first two ideas by itself and leaves the rest to the visitor', async () => {
    show()
    expect(await screen.findByText('Ready to go')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Put Port cellars/ })).toBeNull(),
    )
    expect(screen.queryByRole('button', { name: /Put Livraria Lello/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Put Francesinha/ })).toBeInTheDocument()
  })

  it('stops as soon as the visitor taps an idea', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: /Put Francesinha/ }))
    await new Promise((r) => setTimeout(r, 250))
    // Their tap ended the show: the first two ideas are still waiting.
    expect(screen.getByRole('button', { name: /Put Port cellars/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Put Livraria Lello/ })).toBeInTheDocument()
  })
})

describe('typing list', () => {
  type Seen = (entries: Array<{ isIntersecting: boolean }>) => void
  const watchers = new Map<Element, Seen>()
  const seen = (isIntersecting: boolean) => act(() => watchers.get(card())?.([{ isIntersecting }]))
  beforeEach(() => {
    // Only the demo's own sleeps. Faking every timer API here broke focus timing in later test
    // files that share this worker (HouseTrips, TripScroll).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private cb: Seen) {}
        observe(el: Element) {
          watchers.set(el, this.cb)
        }
        unobserve() {}
        disconnect() {}
      },
    )
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const card = () => document.querySelector('.ld-plate-card') as HTMLElement
  const lines = () =>
    Array.from(card().querySelectorAll('.ld-row-title')).map((e) => e.firstChild?.textContent)

  it('suggests the word as it is typed, lands it once, and keeps the list full', async () => {
    renderLanding()
    seen(true)
    await act(() => vi.advanceTimersByTimeAsync(200))
    expect(card().querySelector('.ld-slips')).toHaveTextContent('Oat milk')
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(lines()).toEqual(['Oat milk', 'Basmati rice', 'Lemons', 'Sourdough'])
    // Leaving and coming back never types the same line again.
    seen(false)
    seen(true)
    await act(() => vi.advanceTimersByTimeAsync(6000))
    expect(lines().filter((l) => l === 'Oat milk')).toHaveLength(1)
    expect(lines()).toHaveLength(4)
  })
})

describe('build-time copy', () => {
  it('renders the whole page to HTML for visitors without JavaScript', async () => {
    // Layout effects warn when rendered to a string; the real build has no window and skips them.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { renderLanding: renderStatic } = await import('../landing.server')
    const html = renderStatic()
    expect(html).toContain('Manage your')
    expect(html).toContain('The weekly shop goes in it, and so does the next trip')
    expect(html).toContain('Meet')
    expect(html).toContain('Get started free')
    vi.restoreAllMocks()
  })

  it('is removed once the live page is on screen', () => {
    const copy = document.createElement('div')
    copy.id = 'prerender'
    document.body.appendChild(copy)
    renderLanding()
    expect(document.getElementById('prerender')).toBeNull()
  })
})

describe('sticky key (phones)', () => {
  const rects = new Map<string, Partial<DOMRect>>()
  const place = (selector: string, r: Partial<DOMRect>) => rects.set(selector, r)
  const sticky = () => document.querySelector('.ld-sticky') as HTMLElement

  beforeEach(() => {
    rects.clear()
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      for (const [sel, r] of rects)
        if (this.matches(sel)) return { top: 0, bottom: 0, ...r } as DOMRect
      // Everything else is far below the screen.
      return { top: 5000, bottom: 5100 } as DOMRect
    })
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
  })
  afterEach(() => vi.restoreAllMocks())

  const scroll = () => act(() => void window.dispatchEvent(new Event('scroll')))

  it('waits until the first key has scrolled away', () => {
    place('.ld-hero-cta', { top: 300, bottom: 360 })
    renderLanding()
    expect(sticky()).not.toHaveClass('is-on')
    place('.ld-hero-cta', { top: -200, bottom: -140 })
    scroll()
    expect(sticky()).toHaveClass('is-on')
  })

  it('steps aside while another key is on screen, so two never stack', () => {
    place('.ld-hero-cta', { top: -200, bottom: -140 })
    place('.ld-free .ld-key', { top: 600, bottom: 660 })
    renderLanding()
    expect(sticky()).not.toHaveClass('is-on')
  })

  it('steps aside rather than cover a row of a demo', () => {
    place('.ld-hero-cta', { top: -200, bottom: -140 })
    place('.ld-slip-body', { top: 200, bottom: 780 })
    renderLanding()
    expect(sticky()).not.toHaveClass('is-on')
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
    render(<CreateHouseSheet open onClose={() => {}} onSubmit={() => {}} />)
    expect(screen.getByRole('textbox', { name: 'House name' })).toHaveValue('The Flat')
  })
})
