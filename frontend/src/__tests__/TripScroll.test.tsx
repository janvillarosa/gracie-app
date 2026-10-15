import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lisbonTrip, renderTrips, resetTripsWorld, seed, setViewport } from './trips.helpers'

const trip = lisbonTrip()
const days = () => document.querySelector('.trip-days-col') as HTMLElement
const ideas = () => document.querySelector('.trip-ideas-col .trip-ideas') as HTMLElement
const open = () => renderTrips(`/app/trips/${trip.trip_id}`)

beforeEach(async () => {
  await resetTripsWorld()
  setViewport('desktop')
  Element.prototype.scrollIntoView = vi.fn()
  sessionStorage.clear()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await resetTripsWorld()
})

describe('the desk is an app shell', () => {
  it('has a Days container that scrolls and an Ideas list that scrolls, and the window does not', async () => {
    seed(trip)
    open()
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    expect(document.documentElement).toHaveClass('trip-desk-shell')
    expect(document.querySelector('.trip-page')).toHaveClass('is-desk-shell')
    expect(days()).not.toBeNull()
    expect(ideas()).not.toBeNull()
    // The Days container holds the header sheet, the pills and the plan.
    expect(days().querySelector('.paper-meta')).not.toBeNull()
    expect(days().querySelector('[role="tablist"]')).not.toBeNull()
    expect(days().querySelector('.trip-day')).not.toBeNull()
    // Ideas is its own pane, outside the Days one.
    expect(days().contains(ideas())).toBe(false)
  })

  it('leaves the window scrolling alone on a phone', async () => {
    setViewport('phone')
    seed(trip)
    open()
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    expect(document.documentElement).not.toHaveClass('trip-desk-shell')
    expect(document.querySelector('.trip-page')).not.toHaveClass('is-desk-shell')
  })

  it('reads the day in view from the Days container, not the window', async () => {
    const roots: Array<Element | null | undefined> = []
    class FakeIO {
      constructor(_cb: unknown, opts?: IntersectionObserverInit) {
        roots.push(opts?.root as Element | null | undefined)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeIO)
    seed(trip)
    open()
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    await waitFor(() => expect(roots.length).toBeGreaterThan(0))
    expect(roots[roots.length - 1]).toBe(days())
    vi.unstubAllGlobals()
  })
})

describe('opening, switching and closing an item never moves the Days pane', () => {
  const rowButton = (title: string) => screen.findByRole('button', { name: title })

  it('keeps the Days scroll position through open, switch and close', async () => {
    seed(trip)
    open()
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    days().scrollTop = 420
    fireEvent.scroll(days())
    await userEvent.click(await rowButton('Lunch at Tascantiga'))
    await screen.findByRole('dialog', { name: 'Lunch at Tascantiga' })
    expect(days().scrollTop).toBe(420)
    // Another visible row: the panel swaps and the pane stays.
    await userEvent.click(await rowButton('Buy souvenirs'))
    await screen.findByRole('dialog', { name: 'Buy souvenirs' })
    expect(days().scrollTop).toBe(420)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(days().scrollTop).toBe(420)
  })

  it('opens a booking and an idea the same way', async () => {
    seed(trip)
    open()
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    days().scrollTop = 300
    const idea = await screen.findByRole('button', { name: 'Ginjinha tasting' })
    await userEvent.click(idea)
    await screen.findByRole('dialog', { name: 'Ginjinha tasting' })
    expect(days().scrollTop).toBe(300)
    await userEvent.keyboard('{Escape}')
    expect(days().scrollTop).toBe(300)
  })

  it('moves focus into the panel without scrolling anything', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    seed(trip)
    open()
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    focus.mockClear()
    await userEvent.click(await rowButton('Lunch at Tascantiga'))
    const panel = await screen.findByRole('dialog', { name: 'Lunch at Tascantiga' })
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true))
    // Every focus the panel itself asked for says "do not scroll".
    const inside = focus.mock.calls.filter((_c, i) =>
      panel.contains(focus.mock.instances[i] as unknown as Node),
    )
    expect(inside.length).toBeGreaterThan(0)
    for (const [opts] of inside) expect(opts).toMatchObject({ preventScroll: true })
  })
})

describe('each pane remembers where it was', () => {
  it('puts the Days and Ideas panes back where they were left for this trip', async () => {
    sessionStorage.setItem(
      `bauhouse_trips_scroll_${trip.trip_id}`,
      JSON.stringify({ days: 333, ideas: 77 }),
    )
    seed(trip)
    open()
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    await waitFor(() => expect(days().scrollTop).toBe(333))
    expect(ideas().scrollTop).toBe(77)
  })

  it('does not, when the link names a day', async () => {
    sessionStorage.setItem(`bauhouse_trips_scroll_${trip.trip_id}`, JSON.stringify({ days: 333 }))
    seed(trip)
    renderTrips(`/app/trips/${trip.trip_id}?day=${trip.start_date}`)
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    expect(days().scrollTop).not.toBe(333)
  })

  it('saves them as they scroll, and survives storage being off', async () => {
    seed(trip)
    open()
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    days().scrollTop = 250
    fireEvent.scroll(days())
    await waitFor(() =>
      expect(
        JSON.parse(sessionStorage.getItem(`bauhouse_trips_scroll_${trip.trip_id}`) ?? '{}').days,
      ).toBe(250),
    )
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('off')
    })
    expect(() => fireEvent.scroll(days())).not.toThrow()
  })
})
