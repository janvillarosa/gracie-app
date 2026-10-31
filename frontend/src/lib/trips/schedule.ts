// Pure scheduling helpers: day lists, absolute-time sorting, gaps, fullness, countdown.
import type { Booking, Trip, TripTodo } from '../../api/tripTypes'
import { bookingName } from './kinds'

const DAY_MS = 86400000
export const MAX_DAYS = 400

// ---- dates ----------------------------------------------------------------------------
export function localDateKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

const toUtc = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function addDays(key: string, n: number): string {
  return fromUtc(toUtc(key) + n * DAY_MS)
}
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(a) - toUtc(b)) / DAY_MS)
}
export function eachDay(start?: string | null, end?: string | null): string[] {
  if (!start || !end || end < start) return []
  const n = Math.min(diffDays(end, start), MAX_DAYS - 1)
  return Array.from({ length: n + 1 }, (_, i) => addDays(start, i))
}

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' })
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' })
/** "Sat 24" */
export function shortDay(key: string): string {
  const d = new Date(toUtc(key))
  return `${WEEKDAY.format(d)} ${d.getUTCDate()}`
}
const WEEKDAY_LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' })
/** "Tuesday 13" */
export function longDay(key: string): string {
  const d = new Date(toUtc(key))
  return `${WEEKDAY_LONG.format(d)} ${d.getUTCDate()}`
}
/** "Thu 22 Oct" */
export function fullDay(key: string): string {
  const d = new Date(toUtc(key))
  return `${shortDay(key)} ${MONTH.format(d)}`
}
/** "Thu 22 Oct 2026": a date that stands on its own, for a document. */
export function dateWithYear(key: string): string {
  return `${fullDay(key)} ${new Date(toUtc(key)).getUTCFullYear()}`
}
/** "22–30 Oct" or "30 Oct – 2 Nov": the short form for a header line. */
export function shortRange(start?: string | null, end?: string | null): string {
  if (!start || !end) return ''
  const a = new Date(toUtc(start))
  const b = new Date(toUtc(end))
  const sd = a.getUTCDate()
  const ed = b.getUTCDate()
  if (start === end) return `${sd} ${MONTH.format(a)}`
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${sd}–${ed} ${MONTH.format(b)}`
    : `${sd} ${MONTH.format(a)} – ${ed} ${MONTH.format(b)}`
}

export function dateRange(start?: string | null, end?: string | null): string {
  if (!start || !end) return ''
  if (start === end) return fullDay(start)
  const a = new Date(toUtc(start))
  const b = new Date(toUtc(end))
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${shortDay(start)} – ${fullDay(end)}`
    : `${fullDay(start)} – ${fullDay(end)}`
}

// ---- time zones -----------------------------------------------------------------------
const fmtCache = new Map<string, Intl.DateTimeFormat>()
function zoneFormat(tz: string) {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    fmtCache.set(tz, f)
  }
  return f
}

function offsetAt(utcMs: number, tz: string): number {
  const parts: Record<string, number> = {}
  for (const p of zoneFormat(tz).formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour % 24,
    parts.minute,
    parts.second,
  )
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

/** Wall-clock date + time in an IANA zone to an absolute instant (ms). Zone-less = UTC. */
export function wallToUtc(date: string, time: string, tz?: string | null): number {
  const [h, m] = time.split(':').map(Number)
  const wall = toUtc(date) + (h * 60 + m) * 60000
  if (!tz) return wall
  try {
    let guess = wall - offsetAt(wall, tz)
    guess = wall - offsetAt(guess, tz)
    return guess
  } catch {
    return wall
  }
}

export function zoneLabel(tz?: string | null): string {
  if (!tz) return ''
  const city = tz.split('/').pop() ?? tz
  return city.replace(/_/g, ' ')
}

// ---- schedule model -------------------------------------------------------------------
export type Entry =
  | {
      kind: 'todo'
      id: string
      day: string
      startMs: number | null
      endMs: number | null
      todo: TripTodo
    }
  | {
      kind: 'booking'
      id: string
      day: string
      startMs: number | null
      endMs: number | null
      booking: Booking
    }

export type DayModel = {
  date: string
  label: string
  suggested: string
  entries: Entry[]
  clash?: Clash
}

/** Two things in one day that run into each other: named once, under the day's header. */
export type Clash = { ids: [string, string]; laterId: string; text: string }

export type Schedule = {
  days: DayModel[]
  ideas: TripTodo[]
  outside: Entry[]
}

function todoEntry(t: TripTodo, tripTz?: string): Entry {
  const day = t.day as string
  const startMs = t.start_time ? wallToUtc(day, t.start_time, t.tz || tripTz) : null
  const endMs = startMs !== null ? startMs + (t.duration_min ?? 0) * 60000 : null
  return { kind: 'todo', id: t.todo_id, day, startMs, endMs, todo: t }
}

function bookingEntry(b: Booking, tripTz?: string): Entry | null {
  if (!b.starts_at) return null
  const [day, time] = b.starts_at.split('T')
  const startMs = wallToUtc(day, time || '00:00', b.start_tz || tripTz)
  let endMs: number | null = null
  if (b.ends_at) {
    const [ed, et] = b.ends_at.split('T')
    endMs = wallToUtc(ed, et || '00:00', b.end_tz || b.end_place?.tz || b.start_tz || tripTz)
  }
  return { kind: 'booking', id: b.booking_id, day, startMs, endMs, booking: b }
}

/** By absolute time, then id. Used for the timed check and for slotting bookings. */
export function compareEntries(a: Entry, b: Entry): number {
  if (a.startMs !== null && b.startMs !== null && a.startMs !== b.startMs)
    return a.startMs - b.startMs
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

const byOrder = (a: TripTodo, b: TripTodo) =>
  a.order - b.order || (a.todo_id < b.todo_id ? -1 : a.todo_id > b.todo_id ? 1 : 0)

/**
 * A day's order is the manual `order` of its todos, always: untimed todos stay where they
 * were put. Bookings have no order, so each one sits at its time, after the last timed todo
 * that starts before it.
 */
export function orderDay(entries: Entry[]): Entry[] {
  const out: Entry[] = entries
    .filter((e) => e.kind === 'todo')
    .sort((a, b) => (a.kind === 'todo' && b.kind === 'todo' ? byOrder(a.todo, b.todo) : 0))
  const bookings = entries.filter((e) => e.kind === 'booking').sort(compareEntries)
  for (const b of bookings) {
    let at = 0
    out.forEach((e, i) => {
      if (e.kind === 'todo' && e.startMs !== null && b.startMs !== null && e.startMs <= b.startMs)
        at = i + 1
    })
    while (
      at < out.length &&
      out[at].kind === 'booking' &&
      (out[at].startMs ?? 0) <= (b.startMs ?? 0)
    )
      at++
    out.splice(at, 0, b)
  }
  return out
}

/**
 * The `order` that places a todo by its time: between the nearest timed neighbours before and
 * after it in time. `list` is the day's other todos in their manual order. Returns undefined
 * when no neighbour is timed (nothing to place it against).
 */
export function orderForTime(
  list: TripTodo[],
  day: string,
  time: string,
  tz: string | undefined,
  tripTz?: string,
): number | undefined {
  const at = wallToUtc(day, time, tz || tripTz)
  let prev = -1
  let next = -1
  let prevMs = Number.NEGATIVE_INFINITY
  let nextMs = Number.POSITIVE_INFINITY
  list.forEach((t, i) => {
    if (!t.start_time) return
    const ms = wallToUtc(day, t.start_time, t.tz || tripTz)
    if (ms <= at && ms >= prevMs) {
      prev = i
      prevMs = ms
    } else if (ms > at && ms < nextMs) {
      next = i
      nextMs = ms
    }
  })
  if (prev < 0 && next < 0) return undefined
  if (prev >= 0 && next >= 0 && list[prev].order < list[next].order)
    return (list[prev].order + list[next].order) / 2
  if (prev >= 0) return orderBetween(list[prev].order, list[prev + 1]?.order)
  return orderBetween(list[next - 1]?.order, list[next].order)
}

/** The `order` for dropping a todo before or after another in the same list. */
export function orderForDrop(
  list: TripTodo[],
  overId: string,
  before: boolean,
): number | undefined {
  const i = list.findIndex((t) => t.todo_id === overId)
  if (i < 0) return undefined
  return before
    ? orderBetween(list[i - 1]?.order, list[i].order)
    : orderBetween(list[i].order, list[i + 1]?.order)
}

export function compareIdeas(a: TripTodo, b: TripTodo): number {
  return a.order - b.order || (a.todo_id < b.todo_id ? -1 : 1)
}

export function suggestLabel(todos: TripTodo[]): string {
  const counts = new Map<string, number>()
  for (const t of todos) {
    const loc = t.place?.locality
    if (loc) counts.set(loc, (counts.get(loc) ?? 0) + 1)
  }
  let best = ''
  let n = 0
  for (const [k, v] of counts) {
    if (v > n) {
      best = k
      n = v
    }
  }
  return best
}

const entryTitle = (e: Entry) => {
  // Titles can be missing altogether (the server leaves empty fields out); a booking goes by its kind.
  const t = e.kind === 'todo' ? (e.todo.title ?? '').trim() || 'Untitled' : bookingName(e.booking)
  // A warning names both sides in one line: long names are cut, not wrapped into a paragraph.
  return t.length > 24 ? `${t.slice(0, 22).trimEnd()}…` : t
}
const clockOf = (dt?: string | null) => (dt ? (dt.split('T')[1] ?? '') : '')

/** The first pair of timed entries that run into each other (back-to-back is fine). Finished
 *  things do not clash: a todo that is done, a booking that has passed (when `nowMs` is given).
 *  So ticking either of two clashing todos clears the warning, and unticking brings it back.
 *  A todo and a booking that are one plan (linked, or starting the same minute: the visit and
 *  its ticket) do not clash either; the todo stands for both. */
export function findClash(entries: Entry[], nowMs?: number): Clash | undefined {
  const live = (e: Entry) =>
    e.kind === 'todo'
      ? !e.todo.done
      : nowMs === undefined || (e.endMs ?? e.startMs ?? Number.POSITIVE_INFINITY) >= nowMs
  const todos = entries.filter((e) => e.kind === 'todo')
  const samePlan = (e: Entry) =>
    e.kind === 'booking' &&
    todos.some(
      (t) =>
        t.kind === 'todo' &&
        (t.todo.booking_id === e.booking.booking_id ||
          (t.startMs !== null && t.startMs === e.startMs)),
    )
  const timed = entries
    .filter((e) => e.startMs !== null && live(e) && !samePlan(e))
    .sort(compareEntries)
  let end = -Infinity
  let reach: Entry | undefined
  let last: Entry | undefined
  for (const e of timed) {
    const s = e.startMs as number
    const hit = s < end ? reach : last && last.startMs === s ? last : undefined
    if (hit) {
      const time = e.kind === 'todo' ? (e.todo.start_time ?? '') : clockOf(e.booking.starts_at)
      const text =
        hit.kind === 'booking' && hit.booking.ends_at
          ? `${entryTitle(e)} starts before ${entryTitle(hit)} ends (${clockOf(hit.booking.ends_at)})`
          : `${entryTitle(hit)} and ${entryTitle(e)} overlap at ${time}`
      return { ids: [hit.id, e.id], laterId: e.id, text }
    }
    last = e
    if ((e.endMs ?? s) >= end) {
      end = e.endMs ?? s
      reach = e
    }
  }
  return undefined
}

export function buildSchedule(trip: Trip, nowMs?: number): Schedule {
  const dates = eachDay(trip.start_date, trip.end_date)
  const inRange = new Set(dates)
  const byDay = new Map<string, Entry[]>()
  const ideas: TripTodo[] = []
  const outside: Entry[] = []
  const place = (e: Entry) => {
    if (inRange.has(e.day)) {
      const list = byDay.get(e.day)
      if (list) list.push(e)
      else byDay.set(e.day, [e])
    } else outside.push(e)
  }
  for (const t of trip.todos) {
    if (!t.day) ideas.push(t)
    else place(todoEntry(t, trip.tz))
  }
  for (const b of trip.bookings) {
    const e = bookingEntry(b, trip.tz)
    if (e) place(e)
  }
  ideas.sort(compareIdeas)
  const outByDay = new Map<string, Entry[]>()
  for (const e of outside) outByDay.set(e.day, [...(outByDay.get(e.day) ?? []), e])
  const outsideOrdered = [...outByDay.keys()].sort().flatMap((d) => orderDay(outByDay.get(d) ?? []))

  const days: DayModel[] = dates.map((date) => {
    const entries = orderDay(byDay.get(date) ?? [])
    const todos = entries.flatMap((e) => (e.kind === 'todo' ? [e.todo] : []))
    return {
      date,
      label: trip.days?.[date] ?? '',
      suggested: trip.days?.[date] ? '' : suggestLabel(todos),
      entries,
      clash: findClash(entries, nowMs),
    }
  })

  return { days, ideas, outside: outsideOrdered }
}

export type Phase = 'draft' | 'before' | 'during' | 'after'
export function tripPhase(trip: Trip, today: string): Phase {
  if (!trip.start_date || !trip.end_date) return 'draft'
  if (today < trip.start_date) return 'before'
  if (today > trip.end_date) return 'after'
  return 'during'
}

export function countdown(trip: Trip, today: string): string {
  const phase = tripPhase(trip, today)
  if (phase === 'draft' || !trip.start_date || !trip.end_date) return ''
  if (phase === 'during') {
    const total = diffDays(trip.end_date, trip.start_date) + 1
    return `Day ${diffDays(today, trip.start_date) + 1} of ${total}`
  }
  if (phase === 'before') {
    const n = diffDays(trip.start_date, today)
    return n === 1 ? 'Tomorrow' : `In ${n} days`
  }
  const n = diffDays(today, trip.end_date)
  return n === 1 ? 'Ended yesterday' : `Ended ${n} days ago`
}

/** Days until the next trip starts, when one starts within `within` days (1 = tomorrow), else
 *  null. Deleted trips, drafts and trips under way don't count. */
export function daysToNextTrip(trips: Trip[], today: string, within = 7): number | null {
  let best: number | null = null
  for (const t of trips) {
    if (t.deleted || tripPhase(t, today) !== 'before' || !t.start_date) continue
    const n = diffDays(t.start_date, today)
    if (n <= within && (best === null || n < best)) best = n
  }
  return best
}

/** Stay bookings that cover tonight (check-in on or before today, check-out after it). */
/** The day a stay is checked out of: its own end, else the trip's last day (a stay with no
 *  check-out yet runs to the end of the trip, not one night). '' when neither is known. */
export function stayEndDay(b: Booking, tripEnd?: string | null): string {
  return b.ends_at?.slice(0, 10) || tripEnd || ''
}

export function tonightsStay(trip: Trip, today: string): Booking | undefined {
  return trip.bookings.find(
    (b) =>
      b.kind === 'stay' &&
      b.starts_at &&
      b.starts_at.slice(0, 10) <= today &&
      stayEndDay(b, trip.end_date) > today,
  )
}

export function routeText(trip: Trip): string {
  const names = (trip.stops ?? []).map((s) => s.locality || s.name || '')
  if (names.length) return names.join(' → ')
  return trip.destination ? trip.destination.locality || trip.destination.name || '' : ''
}

// ---- quick add parsing ----------------------------------------------------------------
/** "14:00 Pena Palace" or "2pm Pena Palace" -> time + title. */
export function parseQuickAdd(text: string): { title: string; start_time?: string } {
  const t = text.trim()
  const m24 = /^([01]?\d|2[0-3])[:.]([0-5]\d)\s+(.+)$/.exec(t)
  if (m24) return { start_time: `${m24[1].padStart(2, '0')}:${m24[2]}`, title: m24[3].trim() }
  const m12 = /^(1[0-2]|0?[1-9])(?:[:.]([0-5]\d))?\s*(am|pm)\s+(.+)$/i.exec(t)
  if (m12) {
    let h = Number(m12[1]) % 12
    if (m12[3].toLowerCase() === 'pm') h += 12
    return { start_time: `${String(h).padStart(2, '0')}:${m12[2] ?? '00'}`, title: m12[4].trim() }
  }
  return { title: t }
}

/** Midpoint order for inserting between two neighbours; end of list when `next` is missing. */
export function orderBetween(prev?: number, next?: number): number {
  if (prev === undefined && next === undefined) return 1
  if (prev === undefined) return (next as number) - 1
  if (next === undefined) return prev + 1
  return (prev + next) / 2
}

/** "14:00" plus 120 minutes is "16:00" (wall clock; past midnight wraps to the next day's clock). */
export function endClock(start: string, minutes?: number | null): string {
  if (!minutes) return ''
  const [h, m] = start.split(':').map(Number)
  const total = (h * 60 + m + minutes) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** "Open Maps" (brief 6t): Apple Maps on iOS and iPadOS (including the installed PWA), so it opens
 *  the Maps app; Google Maps elsewhere (a universal link on Android, a new tab on desktop). A
 *  Google place opens by `query_place_id`, which is exact. */
export function mapsUrl(lat: number, lng: number, placeId?: string | null): string {
  if (isApple()) return `https://maps.apple.com/?ll=${lat},${lng}&q=${lat},${lng}`
  return googleMapsUrl(lat, lng, placeId)
}

/** Always Google Maps (the link says so), exact by `query_place_id` for a Google place. */
export function googleMapsUrl(lat: number, lng: number, placeId?: string | null): string {
  const id = placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : ''
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}${id}`
}

function isApple(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS reports a Mac with touch points.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export type TripGroups = { now: Trip[]; upcoming: Trip[]; drafts: Trip[]; past: Trip[] }

/** Index groups. Deleted trips are left out. */
export function groupTrips(trips: Trip[], today: string): TripGroups {
  const g: TripGroups = { now: [], upcoming: [], drafts: [], past: [] }
  for (const t of trips) {
    if (t.deleted) continue
    const p = tripPhase(t, today)
    if (p === 'during') g.now.push(t)
    else if (p === 'before') g.upcoming.push(t)
    else if (p === 'after') g.past.push(t)
    else g.drafts.push(t)
  }
  const start = (t: Trip) => t.start_date ?? ''
  g.upcoming.sort((a, b) => (start(a) < start(b) ? -1 : 1))
  g.now.sort((a, b) => (start(a) < start(b) ? -1 : 1))
  g.past.sort((a, b) => (start(a) < start(b) ? 1 : -1))
  g.drafts.sort((a, b) => a.title.localeCompare(b.title))
  return g
}
