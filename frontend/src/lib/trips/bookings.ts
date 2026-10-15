// Booking helpers: guessing a kind from what was typed, time pieces, and the list's order.
import type { Booking, BookingKind } from '../../api/tripTypes'
import { shortDay, wallToUtc } from './schedule'

/** A kind guessed from typed text ("TP1355", "hotel", "train to Porto"), or nothing. */
export function inferKind(text: string): BookingKind | undefined {
  const t = text.trim()
  if (!t) return undefined
  if (/✈|\b(flight|fly|airline|airport)\b|\b[A-Za-z]{2}\s?\d{2,4}\b/i.test(t)) return 'flight'
  if (/\b(hotel|airbnb|flat|hostel|apartment|b&b|bnb|stay|lodge|guesthouse)\b/i.test(t))
    return 'stay'
  if (/🚆|\b(train|rail|eurostar|intercity|metro)\b/i.test(t)) return 'train'
  if (/\b(car|rental|rent|hire|taxi|transfer)\b/i.test(t)) return 'car'
  if (/\b(ticket|entry|admission|tour|museum|concert|show)\b/i.test(t)) return 'ticket'
  return undefined
}

export const splitDt = (dt?: string | null) => {
  const [d = '', t = ''] = (dt ?? '').split('T')
  return { d, t }
}
export const joinDt = (d: string, t: string) => `${d}T${t}`

export const bookingStartMs = (b: Booking, tripTz?: string): number | null => {
  if (!b.starts_at) return null
  const { d, t } = splitDt(b.starts_at)
  return wallToUtc(d, t || '00:00', b.start_tz || tripTz)
}
export const bookingEndMs = (b: Booking, tripTz?: string): number | null => {
  if (!b.ends_at) return null
  const { d, t } = splitDt(b.ends_at)
  return wallToUtc(d, t || '00:00', b.end_tz || b.end_place?.tz || b.start_tz || tripTz)
}

export type BookingGroups = {
  // In progress: the stay you are in, a flight or train under way.
  now: Booking[]
  // The next one to start (only when there is one).
  next: Booking | null
  upcoming: Booking[]
  used: Booking[]
}

const FAR = Number.MAX_SAFE_INTEGER

/** Chronological: Now, then Next, then what is coming, then what is over. */
export function groupBookings(bookings: Booking[], nowMs: number, tripTz?: string): BookingGroups {
  const start = (b: Booking) => bookingStartMs(b, tripTz) ?? FAR
  const end = (b: Booking) => bookingEndMs(b, tripTz) ?? bookingStartMs(b, tripTz) ?? FAR
  const sorted = [...bookings].sort((a, c) => start(a) - start(c))
  const used = sorted.filter((b) => end(b) < nowMs)
  const live = sorted.filter((b) => end(b) >= nowMs)
  const now = live.filter((b) => start(b) <= nowMs)
  const ahead = live.filter((b) => start(b) > nowMs)
  return { now, next: ahead[0] ?? null, upcoming: ahead.slice(1), used }
}

const clock = (dt?: string | null) => splitDt(dt).t

/** "Now · until Sun 18 11:00" for what is under way. */
export function nowMeta(b: Booking): string {
  const { d, t } = splitDt(b.ends_at)
  return d ? `Now · until ${shortDay(d)}${t ? ` ${t}` : ''}` : 'Now'
}

/** "Next · Sun 18 09:15" for what starts next. */
export function nextMeta(b: Booking): string {
  const { d, t } = splitDt(b.starts_at)
  return d ? `Next · ${shortDay(d)}${t ? ` ${t}` : ''}` : 'Next'
}

const placeShort = (p?: { name: string; locality?: string } | null) =>
  p ? p.locality || p.name : ''

/** "Lisbon → Porto" for a booking that has both a start and an end place, else "". */
export function bookingRoute(b: Booking): string {
  return b.place && b.end_place ? `${placeShort(b.place)} → ${placeShort(b.end_place)}` : ''
}

/** "Tue 13 · 07:05 → 09:40" (a stay across days: "Tue 13 → Fri 16"). */
export function bookingSub(b: Booking): string {
  if (!b.starts_at) return ''
  const { d: sd, t: st } = splitDt(b.starts_at)
  const { d: ed } = splitDt(b.ends_at)
  const et = clock(b.ends_at)
  if (ed && ed !== sd) return `${shortDay(sd)} → ${shortDay(ed)}`
  return [shortDay(sd), [st, et].filter(Boolean).join(' → ')].filter(Boolean).join(' · ')
}

/** One line for a row: "London → Lisbon" for "London to Lisbon" (flights and trains). */
export function bookingHeadline(b: Booking): string {
  const m = /^(.+?) to (.+)$/.exec(b.title)
  return m && (b.kind === 'flight' || b.kind === 'train') ? `${m[1]} → ${m[2]}` : b.title
}

/** A typed time zone as the canonical IANA name ("europe/lisbon" → "Europe/Lisbon"), or null when
 *  it is not a zone. Where the engine lists its zones, the name must be one of them. */
export function normalizeZone(input: string): string | null {
  const z = input.trim()
  if (!z) return null
  let name: string
  try {
    name = new Intl.DateTimeFormat('en', { timeZone: z }).resolvedOptions().timeZone
  } catch {
    return null
  }
  const list = (
    Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  ).supportedValuesOf?.('timeZone')
  // The engines leave UTC out of that list; it is still a zone.
  if (list?.length && name !== 'UTC' && !list.includes(name)) return null
  return name
}
