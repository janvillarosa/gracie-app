// Where a place search should lean. A day knows where it is from what is already placed on it, so
// a Lisbon-to-Porto day leans on both cities. The lean is only ever a bias (never a restriction),
// so any other city is still one typed name away.
import type { Trip } from '@api/tripTypes'
import { hasPin, type LatLng } from './places'

type Source = Pick<Trip, 'todos' | 'bookings' | 'destination' | 'stops'>

/** A placed thing on a day, with a sortable time so "the last place of the day" is known. */
type Spot = LatLng & { at: string }

const dateOf = (iso?: string | null) => (iso ? iso.slice(0, 10) : null)
const timeOf = (iso?: string | null) => (iso && iso.length > 10 ? iso.slice(11, 16) : '')

/** Every pin on one day (todos on it, bookings starting or ending on it), in no set order. */
function spotsOn(trip: Source, day: string): Spot[] {
  const out: Spot[] = []
  for (const t of trip.todos)
    if (t.day === day && hasPin(t.place))
      out.push({ lat: t.place.lat, lng: t.place.lng, at: t.start_time ?? '' })
  for (const b of trip.bookings) {
    if (dateOf(b.starts_at) === day && hasPin(b.place))
      out.push({ lat: b.place.lat, lng: b.place.lng, at: timeOf(b.starts_at) })
    if (dateOf(b.ends_at) === day && hasPin(b.end_place))
      out.push({ lat: b.end_place.lat, lng: b.end_place.lng, at: timeOf(b.ends_at) })
  }
  return out
}

const dayKeys = (trip: Source): string[] => {
  const keys = new Set<string>()
  for (const t of trip.todos) if (t.day) keys.add(t.day)
  for (const b of trip.bookings) {
    const s = dateOf(b.starts_at)
    const e = dateOf(b.ends_at)
    if (s) keys.add(s)
    if (e) keys.add(e)
  }
  return [...keys].sort()
}

/** The points a search for `day` (null: Ideas) should lean on, first match wins:
 *  1. the day's own placed items (all of them: two cities means two points);
 *  2. the last place of the closest earlier day that has any (a day starts where the last ended);
 *  3. the trip's destination, else its first stop. */
export function dayBias(trip: Source, day: string | null): LatLng[] {
  if (day) {
    const own = spotsOn(trip, day)
    // Time order, so the last point is where the day ends up.
    if (own.length)
      return own.sort((a, b) => a.at.localeCompare(b.at)).map(({ lat, lng }) => ({ lat, lng }))
    for (const key of dayKeys(trip)
      .filter((k) => k < day)
      .reverse()) {
      const spots = spotsOn(trip, key)
      if (!spots.length) continue
      // Stable max by time, so ties keep the later-listed one.
      const last = spots.reduce((a, b) => (b.at >= a.at ? b : a))
      return [{ lat: last.lat, lng: last.lng }]
    }
  }
  const home = trip.destination ?? trip.stops?.[0]
  return hasPin(home) ? [{ lat: home.lat, lng: home.lng }] : []
}
