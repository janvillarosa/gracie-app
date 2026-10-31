// The trip as a document: a summary, the transport and stays as tables, then the plan day by day.
// Pure (no I/O, no React) so the print layout stays a thin renderer. Everything here is what the
// screen already shows; confirmation codes and notes are never read.
import type { Booking, Place, Trip } from '../../api/tripTypes'
import { bookingRoute, KIND_LABEL, splitDt } from './bookings'
import type { Entry } from './schedule'
import { buildSchedule, dateWithYear, diffDays, endClock, fullDay, routeText } from './schedule'

export type Fact = { label: string; value: string }
export type TransportRow = {
  id: string
  departs: string
  arrives: string
  name: string
  kind: string
  route: string
}
export type StayRow = {
  id: string
  name: string
  where: string
  checkIn: string
  checkOut: string
  nights: string
}
export type OtherRow = { id: string; when: string; name: string; kind: string; where: string }
export type DayRow = { id: string; time: string; what: string; where: string }
export type ItineraryDay = { n: number; date: string; label: string; rows: DayRow[] }

export type Itinerary = {
  facts: Fact[]
  transport: TransportRow[]
  stays: StayRow[]
  other: OtherRow[]
  days: ItineraryDay[]
}

export { KIND_LABEL }

const NO_DATE = 'Date not set'

// What the screen shows for a place (a Google place's name comes from the session cache, display only).
const placeLine = (p?: Place | null) =>
  p ? [p.name, p.address || p.locality].filter(Boolean).join(', ') : ''

/** "Thu 22 Oct, 07:05" (the clock only when there is one), or "" for no date. */
const stamp = (dt?: string | null) => {
  const { d, t } = splitDt(dt)
  return d ? [fullDay(d), t].filter(Boolean).join(', ') : ''
}

const byStart = (a: Booking, b: Booking) => {
  if (!a.starts_at) return b.starts_at ? 1 : 0
  if (!b.starts_at) return -1
  return a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : 0
}

function dayRow(e: Entry): DayRow {
  if (e.kind === 'booking') {
    const b = e.booking
    return {
      id: e.id,
      time: splitDt(b.starts_at).t,
      what: b.title || KIND_LABEL[b.kind],
      where: bookingRoute(b) || placeLine(b.place),
    }
  }
  const t = e.todo
  const time = t.start_time
    ? t.duration_min
      ? `${t.start_time}–${endClock(t.start_time, t.duration_min)}`
      : t.start_time
    : ''
  return {
    id: e.id,
    time,
    what: t.title || t.place?.name || 'Saved place',
    where: placeLine(t.place),
  }
}

type Opts = {
  // The local date the document is made on (2006-01-02).
  today: string
  preparedBy?: string
  house?: string
}

export function buildItinerary(trip: Trip, { today, preparedBy, house }: Opts): Itinerary {
  const { start_date: start, end_date: end } = trip
  const facts: Fact[] = []
  const destination = placeLine(trip.destination)
  if (destination) facts.push({ label: 'Destination', value: destination })
  const route = routeText(trip)
  if (route && route !== destination) facts.push({ label: 'Route', value: route })
  if (start && end) {
    const nights = diffDays(end, start)
    facts.push({ label: 'Travel dates', value: `${dateWithYear(start)} to ${dateWithYear(end)}` })
    facts.push({
      label: 'Duration',
      value: `${nights + 1} ${nights + 1 === 1 ? 'day' : 'days'}${nights ? `, ${nights} ${nights === 1 ? 'night' : 'nights'}` : ''}`,
    })
  }
  const by = [preparedBy, house].filter(Boolean).join(', ')
  if (by) facts.push({ label: 'Prepared by', value: by })
  facts.push({ label: 'Prepared on', value: dateWithYear(today) })

  const bookings = [...trip.bookings].sort(byStart)
  const transport: TransportRow[] = bookings
    .filter((b) => b.kind === 'flight' || b.kind === 'train' || b.kind === 'car')
    .map((b) => ({
      id: b.booking_id,
      departs: stamp(b.starts_at) || NO_DATE,
      arrives: stamp(b.ends_at) || '–',
      name: b.title || KIND_LABEL[b.kind],
      kind: KIND_LABEL[b.kind],
      route: bookingRoute(b) || placeLine(b.place),
    }))
  const stays: StayRow[] = bookings
    .filter((b) => b.kind === 'stay')
    .map((b) => {
      const a = splitDt(b.starts_at).d
      const z = splitDt(b.ends_at).d
      return {
        id: b.booking_id,
        name: b.title || KIND_LABEL.stay,
        where: placeLine(b.place),
        checkIn: stamp(b.starts_at) || NO_DATE,
        checkOut: stamp(b.ends_at) || '–',
        nights: a && z && z > a ? String(diffDays(z, a)) : '–',
      }
    })
  const other: OtherRow[] = bookings
    .filter((b) => b.kind === 'ticket' || b.kind === 'other')
    .map((b) => ({
      id: b.booking_id,
      when: stamp(b.starts_at) || NO_DATE,
      name: b.title || KIND_LABEL[b.kind],
      kind: KIND_LABEL[b.kind],
      where: bookingRoute(b) || placeLine(b.place),
    }))

  const days = buildSchedule(trip).days.map((d, i) => ({
    n: i + 1,
    date: d.date,
    label: d.label,
    rows: d.entries.map(dayRow),
  }))
  return { facts, transport, stays, other, days }
}
