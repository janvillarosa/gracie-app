import { describe, expect, it } from 'vitest'
import type { Booking, Trip } from '../api/tripTypes'
import { cssString, pageFooter } from '../components/ui/PrintSheet'
import { buildItinerary } from '../lib/trips/itinerary'
import { dateWithYear } from '../lib/trips/schedule'

const trip = (over: Partial<Trip> = {}): Trip => ({
  trip_id: 'trip_1',
  title: 'Lisbon & Porto',
  start_date: '2026-10-22',
  end_date: '2026-10-24',
  tz: 'Europe/Lisbon',
  todos: [],
  bookings: [],
  version: 1,
  ...over,
})
const booking = (over: Partial<Booking>): Booking => ({
  booking_id: 'b1',
  kind: 'flight',
  title: 'TP1355',
  confirmation_code: 'XK42LP',
  notes: 'seat 12A',
  ...over,
})
const OPTS = { today: '2026-10-17', preparedBy: 'Jan', house: 'The Villarosa House' }

describe('buildItinerary', () => {
  it('summarises the trip, in the order a form would', () => {
    const doc = buildItinerary(
      trip({ destination: { source: 'manual', name: 'Lisbon', lat: 1, lng: 2 } }),
      OPTS,
    )
    expect(doc.facts).toEqual([
      { label: 'Destination', value: 'Lisbon' },
      { label: 'Travel dates', value: 'Thu 22 Oct 2026 to Sat 24 Oct 2026' },
      { label: 'Duration', value: '3 days, 2 nights' },
      { label: 'Prepared by', value: 'Jan, The Villarosa House' },
      { label: 'Prepared on', value: 'Sat 17 Oct 2026' },
    ])
  })

  it('leaves out what it does not know: no dates, no preparer', () => {
    const doc = buildItinerary(trip({ start_date: null, end_date: null }), { today: '2026-10-17' })
    expect(doc.facts).toEqual([{ label: 'Prepared on', value: 'Sat 17 Oct 2026' }])
    expect(doc.days).toEqual([])
  })

  it('says "1 day" for a day trip and "Route" only when it adds something', () => {
    const doc = buildItinerary(
      trip({
        end_date: '2026-10-22',
        stops: [
          { source: 'manual', name: 'Lisbon', lat: 1, lng: 2 },
          { source: 'manual', name: 'Sintra', lat: 1, lng: 2 },
        ],
      }),
      OPTS,
    )
    expect(doc.facts.find((f) => f.label === 'Route')?.value).toBe('Lisbon → Sintra')
    expect(doc.facts.find((f) => f.label === 'Duration')?.value).toBe('1 day')
  })

  it('sorts bookings into transport, stays and other, by start, undated last', () => {
    const doc = buildItinerary(
      trip({
        bookings: [
          booking({
            booking_id: 'late',
            kind: 'train',
            title: 'Alfa',
            starts_at: '2026-10-24T09:15',
          }),
          booking({
            booking_id: 'fl',
            starts_at: '2026-10-22T07:05',
            ends_at: '2026-10-22T09:40',
            place: { source: 'manual', name: 'London', lat: 1, lng: 2 },
            end_place: { source: 'manual', name: 'Lisbon', lat: 1, lng: 2 },
          }),
          booking({ booking_id: 'undated', kind: 'car', title: 'Rental' }),
          booking({
            booking_id: 'st',
            kind: 'stay',
            title: 'Flat',
            starts_at: '2026-10-22T15:00',
            ends_at: '2026-10-24T11:00',
          }),
          booking({ booking_id: 'tk', kind: 'ticket', title: 'Museum', starts_at: '2026-10-23' }),
        ],
      }),
      OPTS,
    )
    expect(doc.transport.map((r) => r.id)).toEqual(['fl', 'late', 'undated'])
    expect(doc.transport[0]).toMatchObject({
      departs: 'Thu 22 Oct, 07:05',
      arrives: 'Thu 22 Oct, 09:40',
      kind: 'Flight',
      route: 'London → Lisbon',
    })
    expect(doc.transport[2].departs).toBe('Date not set')
    expect(doc.stays).toEqual([
      {
        id: 'st',
        name: 'Flat',
        where: '',
        checkIn: 'Thu 22 Oct, 15:00',
        checkOut: 'Sat 24 Oct, 11:00',
        nights: '2',
      },
    ])
    expect(doc.other).toEqual([
      { id: 'tk', when: 'Fri 23 Oct', name: 'Museum', kind: 'Ticket', where: '' },
    ])
  })

  it('numbers the days and never reads codes or notes', () => {
    const doc = buildItinerary(
      trip({
        days: { '2026-10-22': 'Arrival' },
        bookings: [booking({ starts_at: '2026-10-22T07:05' })],
      }),
      OPTS,
    )
    expect(doc.days.map((d) => [d.n, d.date, d.label])).toEqual([
      [1, '2026-10-22', 'Arrival'],
      [2, '2026-10-23', ''],
      [3, '2026-10-24', ''],
    ])
    expect(doc.days[0].rows).toEqual([{ id: 'b1', time: '07:05', what: 'TP1355', where: '' }])
    expect(JSON.stringify(doc)).not.toMatch(/XK42LP|seat 12A/)
  })
})

describe('print helpers', () => {
  it('writes a date with its year', () => {
    expect(dateWithYear('2026-10-17')).toBe('Sat 17 Oct 2026')
  })
  it('puts the title, the site and the page count in the page footer', () => {
    expect(pageFooter('Lisbon & Porto', 'bauhouse.app')).toBe(
      '@page { @bottom-left { content: "Lisbon & Porto"; } @bottom-right { content: "bauhouse.app  ·  Page " counter(page) " of " counter(pages); } }',
    )
    expect(pageFooter('a"b', 'x')).toContain('content: "a\\"b"')
  })
  it('makes a title safe inside a CSS string', () => {
    expect(cssString('Mia\'s "big" trip\\n')).toBe('Mia\'s \\"big\\" trip\\\\n')
    expect(cssString('two\nlines')).toBe('two lines')
    expect(cssString('x'.repeat(200))).toHaveLength(90)
  })
})
