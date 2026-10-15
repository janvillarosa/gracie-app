// What the map shows, as plain data. The page builds a MapScene from the schedule; a map view
// (MapLibre today, the SVG preview when there are no tiles, any other provider later) draws it.
// Nothing here knows about a provider, React or the DOM.
import type { Booking, BookingKind, Trip, TripCategory, TripTodo } from '../../api/tripTypes'
import type { DayModel, Schedule } from './schedule'

export type LatLng = { lat: number; lng: number }

export type MapStop = {
  id: string
  lat: number
  lng: number
  // The place name, else the item's title. Views shorten it to fit.
  label: string
  category: TripCategory
  done: boolean
  // Label priority, lower first: selected 0, next stop 1, then the day's order (2+).
  priority: number
  // Which of the day colours (all-days mode colours pips by day).
  dayIndex: number
  // One muted line for a card: "12:30 · Sintra".
  meta: string
}

export type MapMode = 'day' | 'all' | 'ideas'

export type MapScene = {
  mode: MapMode
  stops: MapStop[]
  // The next stop (a yellow ring and "Next · " label) and the selected one (the same ring).
  nextId: string | null
  selectedId: string | null
  // The CSS custom property holding the route's colour (the day's).
  colourVar: string
  // Whether the day's stops are joined by a line.
  route: boolean
}

export type MapPreview = LatLng & { label?: string }

/** A click on the map, with where it landed in the pane and the place label under it, if any. */
export type MapClick = LatLng & { name?: string; x: number; y: number }

export const EMPTY_SCENE: MapScene = {
  mode: 'day',
  stops: [],
  nextId: null,
  selectedId: null,
  colourVar: '--trip-day-0',
  route: false,
}

const KIND_CATEGORY: Record<BookingKind, TripCategory> = {
  flight: 'transport',
  train: 'transport',
  car: 'transport',
  stay: 'stay',
  ticket: 'activity',
  other: 'other',
}

const pinnable = (p?: { source?: string } | null) => !!p && p.source !== 'manual'

const todoStop = (t: TripTodo, order: number, dayIndex: number): MapStop | null =>
  t.place && pinnable(t.place)
    ? {
        id: t.todo_id,
        lat: t.place.lat,
        lng: t.place.lng,
        label: t.place.name || t.title,
        category: t.category,
        done: t.done,
        priority: order + 2,
        dayIndex,
        meta: [t.start_time, t.place.locality].filter(Boolean).join(' · '),
      }
    : null

const bookingStop = (b: Booking, order: number, dayIndex: number): MapStop | null =>
  b.place && pinnable(b.place)
    ? {
        id: b.booking_id,
        lat: b.place.lat,
        lng: b.place.lng,
        label: b.place.name || b.title,
        category: KIND_CATEGORY[b.kind],
        done: false,
        priority: order + 2,
        dayIndex,
        meta: [b.starts_at?.split('T')[1], b.place.locality].filter(Boolean).join(' · '),
      }
    : null

// A booking that a todo points at is drawn by that todo: it never gets a pin of its own.
const dayStops = (d: DayModel, dayIndex: number, linked: ReadonlySet<string>): MapStop[] => {
  const out: MapStop[] = []
  d.entries.forEach((e, i) => {
    if (e.kind === 'booking' && linked.has(e.booking.booking_id)) return
    const s =
      e.kind === 'todo' ? todoStop(e.todo, i, dayIndex) : bookingStop(e.booking, i, dayIndex)
    if (s) out.push(s)
  })
  return out
}

/** One pip and one label per place per day: of the stops at the same spot, the one that matters
 *  most (selected, then next, then the day's order) stays. */
function onePerPlace(stops: MapStop[]): MapStop[] {
  const best = new Map<string, MapStop>()
  for (const s of stops) {
    const key = `${s.dayIndex}|${s.lat.toFixed(5)}|${s.lng.toFixed(5)}`
    const have = best.get(key)
    if (!have || s.priority < have.priority) best.set(key, s)
  }
  return stops.filter(
    (s) => best.get(`${s.dayIndex}|${s.lat.toFixed(5)}|${s.lng.toFixed(5)}`) === s,
  )
}

type Opts = {
  mode: MapMode
  schedule: Schedule
  // The day being shown (mode 'day').
  day?: string | null
  // Days to leave out of 'all' (finished days stay off the map unless opened).
  skipDays?: ReadonlySet<string>
  nextId?: string | null
  selectedId?: string | null
  colourIndex?: number
}

/** The stops and flags for one view of the map: a day, every day, or the ideas. */
export function buildScene({
  mode,
  schedule,
  day,
  skipDays,
  nextId = null,
  selectedId = null,
  colourIndex = 0,
}: Opts): MapScene {
  let stops: MapStop[] = []
  const linked = new Set<string>(
    [...schedule.days.flatMap((d) => d.entries), ...schedule.outside].flatMap((e) =>
      e.kind === 'todo' && e.todo.booking_id ? [e.todo.booking_id] : [],
    ),
  )
  if (mode === 'ideas') {
    stops = schedule.ideas.flatMap((t, i) => {
      const s = todoStop(t, i, 0)
      return s ? [s] : []
    })
  } else if (mode === 'all') {
    schedule.days.forEach((d, i) => {
      if (skipDays?.has(d.date)) return
      stops.push(...dayStops(d, i, linked))
    })
  } else {
    const i = schedule.days.findIndex((d) => d.date === day)
    if (i >= 0) stops = dayStops(schedule.days[i], i, linked)
  }
  // Selected and next outrank the day's order.
  stops = onePerPlace(
    stops.map((s) =>
      s.id === selectedId ? { ...s, priority: 0 } : s.id === nextId ? { ...s, priority: 1 } : s,
    ),
  )
  return {
    mode,
    stops,
    nextId: stops.some((s) => s.id === nextId) ? nextId : null,
    selectedId: stops.some((s) => s.id === selectedId) ? selectedId : null,
    colourVar: `--trip-day-${colourIndex % 6}`,
    route: mode === 'day',
  }
}

/** Whether the trip has anything to put on a map at all (idea or day place). */
export function hasMapPlaces(trip: Pick<Trip, 'todos' | 'bookings'>): boolean {
  return trip.todos.some((t) => pinnable(t.place)) || trip.bookings.some((b) => pinnable(b.place))
}

/** "Quinta da Regaleira, Sintra" → "Quinta da Regaleira, Si…": cut at a limit, with an ellipsis. */
export function shorten(text: string, limit: number): string {
  const t = text.trim()
  return t.length <= limit ? t : `${t.slice(0, Math.max(1, limit - 1)).trimEnd()}…`
}
