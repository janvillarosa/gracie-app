// Calendar export: a trip as an iCalendar (.ics) file, built on the device (works offline).
// One all-day event spans the trip; each booking with a date becomes its own event. Planned
// todos stay out so the calendar stays quiet. A one-time snapshot, not a live feed.
//
// Left out on purpose: confirmation codes (they stay behind the reveal in the app) and any
// Google place name or address (we may not store Google content; a rendered trip may carry
// them from the session cache). Places the user typed or pinned are theirs and go in.
import type { Booking, Place, Trip } from '../../api/tripTypes'
import { splitDt } from './bookings'
import { addDays, wallToUtc } from './schedule'

const KIND_WORD: Record<Booking['kind'], string> = {
  flight: 'Flight',
  stay: 'Stay',
  train: 'Train',
  car: 'Car',
  ticket: 'Ticket',
  other: 'Booking',
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma and line breaks. */
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

const encoder = new TextEncoder()

/** Folds a content line to at most 75 octets per line (continuations start with a space),
 *  never splitting a UTF-8 character. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line
  const out: string[] = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const n = encoder.encode(ch).length
    const limit = out.length === 0 ? 75 : 74 // continuation lines lose one octet to the space
    if (bytes + n > limit) {
      out.push(cur)
      cur = ''
      bytes = 0
    }
    cur += ch
    bytes += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

/** Only what the user typed: pin/manual names and addresses, and any typed locality. */
export function placeText(p?: Place | null): string {
  if (!p) return ''
  if (p.source === 'google') return p.locality ?? ''
  return [p.name, p.address || p.locality].filter(Boolean).join(', ')
}

const dateValue = (key: string) => key.replace(/-/g, '')
const utcStamp = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')

type Ev = { uid: string; summary: string; start: string; end: string; location?: string }

function bookingEvent(b: Booking, tripTz?: string): Ev | null {
  const s = splitDt(b.starts_at)
  if (!s.d) return null
  const e = splitDt(b.ends_at)
  const summary = b.title ? b.title : KIND_WORD[b.kind]
  const route = [placeText(b.place), placeText(b.end_place)].filter(Boolean)
  const location = route.length === 2 ? `${route[0]} → ${route[1]}` : route[0]
  const uid = `${b.booking_id}@bauhouse`
  if (!s.t) {
    // A date with no time: all day. A stay runs to its check-out date (DTEND is exclusive).
    const endKey = e.d && e.d > s.d ? (b.kind === 'stay' ? e.d : addDays(e.d, 1)) : addDays(s.d, 1)
    return {
      uid,
      summary,
      start: `;VALUE=DATE:${dateValue(s.d)}`,
      end: `;VALUE=DATE:${dateValue(endKey)}`,
      location,
    }
  }
  const startMs = wallToUtc(s.d, s.t, b.start_tz || tripTz)
  const endTz = b.end_tz || b.end_place?.tz || b.start_tz || tripTz
  const endMs = e.d ? wallToUtc(e.d, e.t || '00:00', endTz) : startMs + 3600000
  return {
    uid,
    summary,
    start: `:${utcStamp(startMs)}`,
    end: `:${utcStamp(Math.max(endMs, startMs))}`,
    location,
  }
}

/** The trip as an iCalendar document (CRLF line endings), or null when it has no dates. */
export function tripToIcs(trip: Trip, nowMs: number = Date.now()): string | null {
  if (!trip.start_date || !trip.end_date) return null
  const events: Ev[] = [
    {
      uid: `${trip.trip_id}@bauhouse`,
      summary: trip.title || 'Trip',
      start: `;VALUE=DATE:${dateValue(trip.start_date)}`,
      end: `;VALUE=DATE:${dateValue(addDays(trip.end_date, 1))}`,
      location: placeText(trip.destination),
    },
  ]
  for (const b of trip.bookings) {
    const ev = bookingEvent(b, trip.tz)
    if (ev) events.push(ev)
  }
  const stamp = utcStamp(nowMs)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bauhouse//Trips//EN',
    'CALSCALE:GREGORIAN',
  ]
  for (const ev of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART${ev.start}`,
      `DTEND${ev.end}`,
      `SUMMARY:${escapeText(ev.summary)}`,
    )
    if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(foldLine).join('\r\n')}\r\n`
}

/** "Lisbon & Porto" -> "lisbon-porto.ics" */
export function icsFileName(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'trip'}.ics`
}

/** Hands the file to the browser: iOS Safari offers "Add to Calendar", desktops download it. */
export function downloadIcs(trip: Trip): boolean {
  const text = tripToIcs(trip)
  if (!text) return false
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = icsFileName(trip.title)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
