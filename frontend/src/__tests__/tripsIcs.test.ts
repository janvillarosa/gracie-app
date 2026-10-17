import { describe, expect, it } from 'vitest'
import type { Booking, Trip } from '../api/tripTypes'
import { escapeText, foldLine, icsFileName, placeText, tripToIcs } from '../lib/trips/ics'
import { daysToNextTrip } from '../lib/trips/schedule'

const trip = (over: Partial<Trip> = {}): Trip => ({
  trip_id: 'trip_1',
  title: 'Lisbon & Porto',
  start_date: '2026-10-20',
  end_date: '2026-10-24',
  tz: 'Europe/Lisbon',
  todos: [],
  bookings: [],
  version: 1,
  ...over,
})

const booking = (over: Partial<Booking>): Booking => ({
  booking_id: 'tbk_1',
  kind: 'flight',
  title: 'TP1355',
  ...over,
})

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0)
const unfold = (s: string) => s.replace(/\r\n /g, '')
const events = (s: string) => unfold(s).split('BEGIN:VEVENT').slice(1)

describe('tripToIcs', () => {
  it('returns null for a trip without dates', () => {
    expect(tripToIcs(trip({ start_date: null }), NOW)).toBeNull()
  })

  it('makes one all-day event that spans the trip, end exclusive, with CRLF lines', () => {
    const ics = tripToIcs(trip(), NOW) as string
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/\n/)
    const [ev] = events(ics)
    expect(ev).toContain('UID:trip_1@bauhouse')
    expect(ev).toContain('DTSTAMP:20261017T120000Z')
    expect(ev).toContain('DTSTART;VALUE=DATE:20261020')
    expect(ev).toContain('DTEND;VALUE=DATE:20261025')
    expect(ev).toContain('SUMMARY:Lisbon & Porto')
  })

  it('turns a timed booking into a UTC event in its own zone', () => {
    const ics = tripToIcs(
      trip({
        bookings: [
          booking({
            starts_at: '2026-10-20T07:05',
            start_tz: 'America/New_York',
            ends_at: '2026-10-20T19:40',
            end_tz: 'Europe/Lisbon',
          }),
        ],
      }),
      NOW,
    ) as string
    const ev = events(ics)[1]
    expect(ev).toContain('DTSTART:20261020T110500Z') // 07:05 EDT
    expect(ev).toContain('DTEND:20261020T184000Z') // 19:40 WEST
    expect(ev).toContain('SUMMARY:TP1355')
  })

  it('gives a booking with no end an hour, and a date-only stay runs to check-out', () => {
    const ics = tripToIcs(
      trip({
        bookings: [
          booking({ booking_id: 'a', starts_at: '2026-10-21T09:00' }),
          booking({
            booking_id: 'b',
            kind: 'stay',
            title: '',
            starts_at: '2026-10-20',
            ends_at: '2026-10-24',
          }),
          booking({ booking_id: 'c', kind: 'ticket', title: 'Museum', starts_at: '2026-10-22' }),
          booking({ booking_id: 'd', title: 'No date yet' }),
        ],
      }),
      NOW,
    ) as string
    const evs = events(ics)
    expect(evs).toHaveLength(4) // trip + three dated bookings
    expect(evs[1]).toContain('DTSTART:20261021T080000Z')
    expect(evs[1]).toContain('DTEND:20261021T090000Z')
    expect(evs[2]).toContain('SUMMARY:Stay')
    expect(evs[2]).toContain('DTSTART;VALUE=DATE:20261020')
    expect(evs[2]).toContain('DTEND;VALUE=DATE:20261024')
    expect(evs[3]).toContain('DTEND;VALUE=DATE:20261023')
  })

  it('never writes confirmation codes, notes or Google place names', () => {
    const ics = tripToIcs(
      trip({
        destination: { source: 'google', place_id: 'g1', name: 'Lisboa', address: 'Portugal' },
        bookings: [
          booking({
            starts_at: '2026-10-20T07:05',
            confirmation_code: 'XK42LP',
            notes: 'seat 12A',
            place: { source: 'google', place_id: 'g2', name: 'JFK Airport', locality: 'New York' },
            end_place: { source: 'manual', name: 'Humberto Delgado', address: 'Lisbon' },
          }),
        ],
      }),
      NOW,
    ) as string
    expect(ics).not.toContain('XK42LP')
    expect(ics).not.toContain('seat 12A')
    expect(ics).not.toContain('JFK Airport')
    expect(ics).not.toContain('Lisboa')
    expect(unfold(ics)).toContain('LOCATION:New York → Humberto Delgado\\, Lisbon')
  })
})

describe('ics text helpers', () => {
  it('escapes TEXT values', () => {
    expect(escapeText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne')
  })

  it('folds at 75 octets without splitting a character', () => {
    const line = `SUMMARY:${'é'.repeat(80)}`
    const folded = foldLine(line)
    const enc = new TextEncoder()
    for (const part of folded.split('\r\n')) expect(enc.encode(part).length).toBeLessThanOrEqual(75)
    expect(unfold(folded)).toBe(line)
    expect(foldLine('SHORT:ok')).toBe('SHORT:ok')
  })

  it('keeps only user-typed place text', () => {
    expect(placeText({ source: 'google', place_id: 'g', name: 'Hidden' })).toBe('')
    expect(placeText({ source: 'pin', name: 'Our flat', lat: 1, lng: 2 })).toBe('Our flat')
  })

  it('names the file after the trip', () => {
    expect(icsFileName('Lisbon & Porto')).toBe('lisbon-porto.ics')
    expect(icsFileName('Café São João')).toBe('cafe-sao-joao.ics')
    expect(icsFileName('🏖️')).toBe('trip.ics')
  })
})

describe('daysToNextTrip', () => {
  const t = (id: string, start: string | null, end: string | null, over: Partial<Trip> = {}) =>
    trip({ trip_id: id, start_date: start, end_date: end, ...over })
  const today = '2026-10-17'
  it('is the nearest start within the window, ignoring drafts, deleted and live trips', () => {
    expect(
      daysToNextTrip(
        [
          t('a', '2026-10-22', '2026-10-24'),
          t('b', '2026-10-18', '2026-10-19', { deleted: { by: 'u' } }),
          t('c', null, null),
          t('d', '2026-10-16', '2026-10-20'),
          t('e', '2026-10-20', '2026-10-21'),
        ],
        today,
      ),
    ).toBe(3)
    expect(daysToNextTrip([t('a', '2026-10-18', '2026-10-19')], today)).toBe(1)
    expect(daysToNextTrip([t('a', '2026-10-24', '2026-10-25')], today)).toBe(7)
    expect(daysToNextTrip([t('a', '2026-10-25', '2026-10-26')], today)).toBeNull()
  })
})
