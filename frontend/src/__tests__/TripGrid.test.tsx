import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MIA,
  lisbonTrip,
  rel,
  renderTrips,
  resetTripsWorld,
  seed,
  setViewport,
} from './trips.helpers'

const css = readFileSync(resolve(__dirname, '../trips.css'), 'utf8')

beforeEach(async () => {
  await resetTripsWorld()
  Element.prototype.scrollIntoView = vi.fn()
  setViewport('desktop')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await resetTripsWorld()
})

// jsdom does not lay anything out, so alignment is held in two places: the stylesheet defines
// the one grid, and every line type in the plan sheet is built from the elements that grid
// addresses. The pixel check is a measurement script run during review.
describe('One row grid for every line in the plan sheet', () => {
  it('defines the columns once, as custom properties on the sheet', () => {
    for (const v of ['--lead:', '--gap:', '--lead-col:', '--time-w:', '--time-col:', '--tcol:'])
      expect(css).toContain(v)
    expect(css).toMatch(/\.pill-nav-pane\s*\{[^}]*--lead:\s*24px/)
    expect(css).toMatch(/\.pill-nav-pane\s*\{[^}]*--time-w:\s*48px/)
    expect(css).toMatch(/\.trip-day\.has-time\s*\{[^}]*--time-col:/)
  })

  it('puts todo rows, booking stubs and booking rows on those columns', () => {
    expect(css).toMatch(
      /\.trip-row-line,\s*\.trip-stubline\s*\{[^}]*grid-template-columns:\s*var\(--lead-col\) var\(--tcol\) minmax\(0, 1fr\) auto/,
    )
    expect(css).toMatch(
      /\.trip-bcard-main\s*\{[^}]*grid-template-columns:\s*var\(--lead-col\) minmax\(0, 1fr\) auto/,
    )
    // Lines without a lead element start their text in the title column.
    expect(css).toMatch(/\.trip-empty-row\s*\{[^}]*padding:[^;]*var\(--lead-col\) \+ var\(--tcol\)/)
    expect(css).toMatch(
      /\.trip-clash\s*\{[^}]*padding-left:\s*calc\(var\(--lead-col\) \+ var\(--tcol\)\)/,
    )
    expect(css).toMatch(/\.trip-now\s*\{[^}]*padding-left:\s*var\(--lead-col\)/)
  })

  it('gives a day a time column only when something in it has a time', async () => {
    const t = lisbonTrip()
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    await screen.findByRole('heading', { name: 'Later today' })
    // Today and tomorrow have timed rows; the empty day after has none.
    expect(document.getElementById(`day-${rel(0)}`)).toHaveClass('has-time')
    expect(document.getElementById(`day-${rel(1)}`)).toHaveClass('has-time')
    expect(document.getElementById(`day-${rel(2)}`)).not.toHaveClass('has-time')
  })

  it('keeps times and the Tonight stub in the same element type and column as row times', async () => {
    const t = lisbonTrip()
    t.bookings.push({
      booking_id: `tbk_${'8'.padStart(32, '0')}`,
      kind: 'stay',
      title: 'Alfama flat',
      starts_at: `${rel(-1)}T15:00`,
      ends_at: `${rel(2)}T11:00`,
      created_by: MIA,
    })
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    await screen.findByRole('heading', { name: 'Later today' })
    const stub = (await screen.findByText('Alfama flat')).closest('.trip-stubline') as HTMLElement
    // icon in the lead, "Tonight" in the time column, title in the title column
    expect(stub.children[0]).toHaveClass('trip-stub-icon')
    const when = within(stub).getByText('Tonight')
    expect(when).toHaveClass('trip-time')
    expect(stub.lastElementChild).not.toBe(when)
    const row = screen.getByText('Lunch at Tascantiga').closest('.trip-row-line') as HTMLElement
    expect(within(row).getByText('12:30')).toHaveClass('trip-time')
    expect(row.querySelector('.trip-check')).not.toBeNull()
  })
})
