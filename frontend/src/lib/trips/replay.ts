// Pure state functions for the offline client: random ids, applying one op to a trip the
// way the server will (optimistic replay) and merging a server delta into a snapshot.
// No I/O and no clocks except the ISO timestamp passed in, so everything here is testable.
import type { Booking, Trip, TripDelta, TripOp, TripTodo } from '../../api/tripTypes'

export type IdPrefix = 'trip' | 'ttd' | 'tbk'

export function newId(prefix: IdPrefix): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return `${prefix}_${hex}`
}

export const newOpId = () => newId('trip').replace('trip_', 'op_')

type Patch = Record<string, unknown>

function placeTz(patch: Patch, fallback?: string): string | undefined {
  const p = patch.place as { tz?: string } | null | undefined
  return p?.tz || fallback
}

function patchTodo(td: TripTodo, patch: Patch, me: string, nowIso: string, tripTz?: string) {
  const next: TripTodo = { ...td, ...(patch as Partial<TripTodo>) }
  if ('done' in patch) {
    next.done_by = patch.done ? me : undefined
    next.done_at = patch.done ? nowIso : undefined
  }
  if ('place' in patch) next.tz = placeTz(patch, tripTz) || td.tz
  next.updated_by = me
  next.updated_at = nowIso
  return next
}

function mergeDays(cur: Record<string, string> | undefined, patch: Record<string, string>) {
  const out = { ...(cur ?? {}) }
  for (const [d, label] of Object.entries(patch)) {
    if (label === '') delete out[d]
    else out[d] = label
  }
  return out
}

function patchTrip(t: Trip, patch: Patch): Trip {
  const { days, ...rest } = patch
  const next = { ...t, ...(rest as Partial<Trip>) }
  if (days && typeof days === 'object')
    next.days = mergeDays(t.days, days as Record<string, string>)
  return next
}

/** Applies one op to a trip. `undefined` in, `undefined` out when the op can't apply. */
export function applyOpLocal(
  trip: Trip | undefined,
  op: TripOp,
  me: string,
  nowIso: string,
): Trip | undefined {
  const patch = (op.patch ?? {}) as Patch
  if (op.type === 'trip.create') {
    if (trip) return patchTrip(trip, patch)
    const t = patchTrip(
      { trip_id: op.trip_id, title: '', todos: [], bookings: [], version: 0, created_by: me },
      patch,
    )
    if (!t.tz && t.destination?.tz) t.tz = t.destination.tz
    return t
  }
  if (!trip) return undefined
  switch (op.type) {
    case 'trip.update':
      return patchTrip(trip, patch)
    case 'trip.delete':
      return { ...trip, deleted: { by: me } }
    case 'trip.restore':
      return { ...trip, deleted: null }
    case 'todo.create': {
      if (trip.todos.some((t) => t.todo_id === op.entity_id)) return trip
      const td: TripTodo = {
        todo_id: op.entity_id ?? '',
        title: '',
        done: false,
        order: 0,
        category: 'other',
        tz: placeTz(patch, trip.tz),
        ...(patch as Partial<TripTodo>),
        created_by: me,
        updated_by: me,
        updated_at: nowIso,
      }
      return { ...trip, todos: [...trip.todos, td] }
    }
    case 'todo.update':
      return {
        ...trip,
        todos: trip.todos.map((t) =>
          t.todo_id === op.entity_id ? patchTodo(t, patch, me, nowIso, trip.tz) : t,
        ),
      }
    case 'todo.delete':
      return { ...trip, todos: trip.todos.filter((t) => t.todo_id !== op.entity_id) }
    case 'booking.create': {
      if (trip.bookings.some((b) => b.booking_id === op.entity_id)) return trip
      const b: Booking = {
        booking_id: op.entity_id ?? '',
        kind: 'other',
        title: '',
        ...(patch as Partial<Booking>),
        created_by: me,
        updated_by: me,
        updated_at: nowIso,
      }
      return { ...trip, bookings: [...trip.bookings, b] }
    }
    case 'booking.update':
      return {
        ...trip,
        bookings: trip.bookings.map((b) =>
          b.booking_id === op.entity_id
            ? { ...b, ...(patch as Partial<Booking>), updated_by: me, updated_at: nowIso }
            : b,
        ),
      }
    case 'booking.delete':
      return { ...trip, bookings: trip.bookings.filter((b) => b.booking_id !== op.entity_id) }
    default:
      return trip
  }
}

/** Snapshot plus every pending op for that trip, in seq order. */
export function renderTrip(
  snapshot: Trip | undefined,
  pending: readonly TripOp[],
  me: string,
  nowIso: string,
): Trip | undefined {
  let t = snapshot
  for (const op of pending) t = applyOpLocal(t, op, me, nowIso)
  return t
}

function upsertBy<T>(list: T[], items: T[] | undefined, key: (x: T) => string): T[] {
  if (!items?.length) return list
  const byId = new Map(items.map((i) => [key(i), i]))
  const out = list.map((x) => byId.get(key(x)) ?? x)
  const have = new Set(list.map(key))
  for (const i of items) if (!have.has(key(i))) out.push(i)
  return out
}

/** Folds a server delta into the stored snapshot. */
export function mergeDelta(existing: Trip | undefined, d: TripDelta): Trip {
  const base: Trip =
    d.full || !existing
      ? { title: '', trip_id: d.trip_id, todos: [], bookings: [], version: 0 }
      : existing
  let t: Trip = { ...base, ...(d.trip ?? {}), trip_id: d.trip_id }
  t = {
    ...t,
    todos: upsertBy(d.full ? [] : base.todos, d.todos, (x) => x.todo_id),
    bookings: upsertBy(d.full ? [] : base.bookings, d.bookings, (x) => x.booking_id),
    version: d.version,
  }
  if (d.removed_ids?.length) {
    const gone = new Set(d.removed_ids)
    t.todos = t.todos.filter((x) => !gone.has(x.todo_id))
    t.bookings = t.bookings.filter((x) => !gone.has(x.booking_id))
  }
  t.deleted = d.deleted ? { by: d.deleted_by } : null
  return t
}
