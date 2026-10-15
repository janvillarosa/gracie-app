// Places: the rules for Google places (Google Maps Platform terms) in one place.
//
//  - Only `place_id` is stored indefinitely; lat/lng for at most 30 days (`coords_fetched_at`).
//    Google's name and address are never stored or sent in an op.
//  - Names and addresses for display come from a SESSION-MEMORY cache (place_id -> info) that is
//    filled while online. It is never written to IndexedDB, localStorage or a service worker.
//  - Offline, or before the fetch lands, a row shows the user's title, and for an untitled
//    google place "Saved place".
import type { Booking, Place, Trip, TripTodo } from '@api/tripTypes'

export const SAVED_PLACE = 'Saved place'
/** Refresh Google coordinates older than this (the server rejects 30 days). */
export const REFRESH_AFTER_MS = 25 * 24 * 60 * 60 * 1000

export type LatLng = { lat: number; lng: number }

// ---- what a place can say -----------------------------------------------------------------

export const isGoogle = (p?: Place | null): p is Place & { place_id: string } =>
  !!p && p.source === 'google' && !!p.place_id

/** A place with coordinates that can be drawn on the map (not address-only, not purged). */
export const hasPin = (p?: Place | null): p is Place & LatLng =>
  !!p && p.source !== 'manual' && typeof p.lat === 'number' && typeof p.lng === 'number'

/** Display info for a Google place, held in memory only. */
export type PlaceInfo = { name?: string; address?: string; locality?: string }

// ---- the session cache ---------------------------------------------------------------------

const info = new Map<string, PlaceInfo>()
const listeners = new Set<() => void>()
let version = 0

export const placeInfo = (id?: string | null): PlaceInfo | undefined =>
  id ? info.get(id) : undefined
export function setPlaceInfo(id: string, next: PlaceInfo) {
  const prev = info.get(id)
  if (
    prev &&
    prev.name === next.name &&
    prev.address === next.address &&
    prev.locality === next.locality
  )
    return
  info.set(id, next)
  version++
  for (const l of listeners) l()
}
export const subscribePlaceInfo = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
export const placeInfoVersion = () => version
/** What the maintenance pass has already asked Google, and where previews were found. Held with
 *  the cache so a test reset (which must not load Google) clears all of it. */
export const asked = new Set<string>()
export const located = new Map<string, LatLng | null>()

/** Test hook: the cache is per session, so tests start empty. */
export function resetPlaceInfo() {
  asked.clear()
  located.clear()
  info.clear()
  version++
  for (const l of listeners) l()
}

// ---- display ------------------------------------------------------------------------------

/** The place with a Google place's name, address and locality filled in from the cache, for
 *  display only. Returns the same object when there is nothing to add. */
export function resolvePlace<P extends Place | null | undefined>(p: P): P {
  if (!p || !isGoogle(p)) return p
  const i = info.get(p.place_id)
  if (!i) return p
  const name = p.name ?? i.name
  const address = p.address ?? i.address
  const locality = p.locality ?? i.locality
  if (name === p.name && address === p.address && locality === p.locality) return p
  return { ...p, name, address, locality }
}

/** A todo's title for display: what the user typed, else the Google name, else "Saved place". */
export function todoTitle(t: Pick<TripTodo, 'title' | 'place'>): string {
  if ((t.title ?? '').trim()) return t.title
  const p = resolvePlace(t.place)
  return p?.name?.trim() || (p ? SAVED_PLACE : '')
}

/** Fill every Google place of a rendered trip from the cache. The same trip comes back when
 *  there is nothing to add, so memoised consumers do not re-render. */
export function enrichTrip(trip: Trip): Trip {
  let changed = false
  const one = <P extends Place | null | undefined>(p: P): P => {
    const r = resolvePlace(p)
    if (r !== p) changed = true
    return r
  }
  const destination = one(trip.destination)
  const stops = trip.stops?.map((s) => one(s))
  const todos = trip.todos.map((t) => {
    const place = one(t.place)
    return place === t.place ? t : { ...t, place }
  })
  const bookings = trip.bookings.map((b) => {
    const place = one(b.place)
    const end_place = one(b.end_place)
    return place === b.place && end_place === b.end_place ? b : { ...b, place, end_place }
  })
  if (!changed) return trip
  return { ...trip, destination, stops, todos, bookings }
}

/** One line for a place: its name (Google's from the cache, or the user's) and what is under it. */
export function placeText(p?: Place | null): { name: string; sub: string } {
  const r = resolvePlace(p)
  if (!r) return { name: '', sub: '' }
  const name = r.name?.trim() || (isGoogle(r) ? SAVED_PLACE : '')
  const sub = r.address?.trim() || r.locality?.trim() || ''
  return { name, sub: sub === name ? '' : sub }
}

// ---- what is stored ---------------------------------------------------------------------------

/** A place as it may be sent: a Google place keeps only its allowed fields. Name and address
 *  are dropped, and so is a locality that is exactly what the cache supplied (it was never the
 *  user's). Other sources are user content and pass through. */
export function sanitizePlace<P extends Place | null | undefined>(p: P): P {
  if (!p || p.source !== 'google') return p
  const i = p.place_id ? info.get(p.place_id) : undefined
  const { name: _n, address: _a, ...rest } = p
  if (i && rest.locality !== undefined && rest.locality === i.locality) {
    const { locality: _l, ...noLocality } = rest
    return noLocality as P
  }
  return rest as P
}

const PLACE_KEYS = ['place', 'end_place', 'destination'] as const

/** Strip Google content from a patch on its way to the outbox. Every write goes through this,
 *  so a sheet that edits an enriched trip cannot store a Google name. */
export function sanitizePatch(patch: Record<string, unknown>): Record<string, unknown> {
  let out = patch
  for (const k of PLACE_KEYS) {
    if (patch[k] && typeof patch[k] === 'object') {
      const clean = sanitizePlace(patch[k] as Place)
      if (clean !== patch[k]) out = { ...out, [k]: clean }
    }
  }
  if (Array.isArray(patch.stops)) {
    const stops = (patch.stops as Place[]).map((s) => sanitizePlace(s))
    out = { ...out, stops }
  }
  return out
}

/** What to store for a place the person picked from Google: ids, coordinates and the fetch time.
 *  No name, no address. `tz` only when Google gave an offset we can name (we do not ask). */
export function googlePlace(
  placeId: string,
  at: LatLng | null,
  now = new Date(),
  tz?: string,
): Place {
  return {
    source: 'google',
    place_id: placeId,
    ...(at ? { lat: at.lat, lng: at.lng, coords_fetched_at: now.toISOString() } : {}),
    ...(tz ? { tz } : {}),
  }
}

// ---- coordinate refresh (pure) -------------------------------------------------------------------

export type Slot =
  | { kind: 'todo'; id: string; field: 'place' }
  | { kind: 'booking'; id: string; field: 'place' | 'end_place' }
  | { kind: 'trip'; field: 'destination' }
  | { kind: 'trip'; field: 'stops'; index: number }

export type RefreshTarget = { slot: Slot; place: Place & { place_id: string } }

/** Google coordinates that are missing or older than 25 days. */
export function needsRefresh(
  p: Place | null | undefined,
  nowMs: number,
): p is Place & { place_id: string } {
  if (!isGoogle(p)) return false
  if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || !p.coords_fetched_at) return true
  const at = Date.parse(p.coords_fetched_at)
  return Number.isNaN(at) || nowMs - at > REFRESH_AFTER_MS
}

/** Every place of a trip whose coordinates should be refreshed, in a stable order. */
export function selectRefresh(trip: Trip, nowMs: number): RefreshTarget[] {
  const out: RefreshTarget[] = []
  const see = (slot: Slot, p: Place | null | undefined) => {
    if (needsRefresh(p, nowMs)) out.push({ slot, place: p })
  }
  see({ kind: 'trip', field: 'destination' }, trip.destination)
  for (const [index, s] of (trip.stops ?? []).entries())
    see({ kind: 'trip', field: 'stops', index }, s)
  for (const t of trip.todos) see({ kind: 'todo', id: t.todo_id, field: 'place' }, t.place)
  for (const b of trip.bookings) {
    see({ kind: 'booking', id: b.booking_id, field: 'place' }, b.place)
    see({ kind: 'booking', id: b.booking_id, field: 'end_place' }, b.end_place)
  }
  return out
}

/** Whether a trip is worth refreshing: current or upcoming (not past, not deleted). */
export function worthRefreshing(trip: Trip, today: string): boolean {
  if (trip.deleted) return false
  return !trip.end_date || trip.end_date >= today
}

/** The patch that writes fresh coordinates onto the slot's place. */
export function refreshPatch(
  trip: Trip,
  target: RefreshTarget,
  at: LatLng,
  now: Date,
): Record<string, unknown> {
  const fresh = (p: Place): Place =>
    sanitizePlace({ ...p, lat: at.lat, lng: at.lng, coords_fetched_at: now.toISOString() })
  const { slot } = target
  if (slot.kind === 'trip' && slot.field === 'stops')
    return {
      stops: (trip.stops ?? []).map((s, i) => (i === slot.index ? fresh(s) : sanitizePlace(s))),
    }
  if (slot.kind === 'trip') return { destination: fresh(target.place) }
  return { [slot.field]: fresh(target.place) }
}

export type { Booking }
