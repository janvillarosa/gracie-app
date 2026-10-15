// In-memory implementation of the trips contract (sync, ops, packing list, places) for tests
// and the opt-in dev worker. It follows the spec's result table closely enough to exercise
// the client: sequence idempotency, per-field clocks, tombstones, caps, unsupported patches.
import type {
  Booking,
  OpResult,
  OpsResponse,
  Place,
  PlacesResponse,
  SyncResponse,
  Trip,
  TripDelta,
  TripFields,
  TripOp,
  TripTodo,
} from '../api/tripTypes'

type STrip = {
  room_id: string
  fields: TripFields
  todos: TripTodo[]
  bookings: Booking[]
  version: number
  v: number
  acked: Record<string, number>
  tombstones: Array<{ id: string; v: number }>
  field_at: Record<string, number>
  child_at: Record<string, Record<string, number>>
  deleted_by?: string
  created_by: string
}

const TRIP_KEYS = new Set([
  'title',
  'destination',
  'notes',
  'start_date',
  'end_date',
  'tz',
  'stops',
  'days',
  'icon',
])
const TODO_KEYS = new Set([
  'title',
  'done',
  'day',
  'start_time',
  'duration_min',
  'order',
  'category',
  'notes',
  'place',
  'booking_id',
])
const BOOKING_KEYS = new Set([
  'kind',
  'title',
  'confirmation_code',
  'starts_at',
  'ends_at',
  'start_tz',
  'end_tz',
  'place',
  'notes',
])
const CATEGORIES = new Set(['food', 'sight', 'activity', 'transport', 'stay', 'shopping', 'other'])
const KINDS = new Set(['flight', 'stay', 'train', 'car', 'ticket', 'other'])
const DATE = /^\d{4}-\d{2}-\d{2}$/
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

export const PLACE_BOOK: Place[] = [
  {
    name: 'Lisbon',
    locality: 'Lisbon',
    lat: 38.7223,
    lng: -9.1393,
    tz: 'Europe/Lisbon',
    source: 'photon',
  },
  {
    name: 'Porto',
    locality: 'Porto',
    lat: 41.1579,
    lng: -8.6291,
    tz: 'Europe/Lisbon',
    source: 'photon',
  },
  {
    name: 'Sintra',
    locality: 'Sintra',
    lat: 38.8029,
    lng: -9.3817,
    tz: 'Europe/Lisbon',
    source: 'photon',
  },
  {
    name: 'Pena Palace',
    address: 'Estrada da Pena, Sintra',
    locality: 'Sintra',
    lat: 38.7876,
    lng: -9.3906,
    tz: 'Europe/Lisbon',
    source: 'photon',
  },
  {
    name: 'Heathrow Airport',
    locality: 'London',
    lat: 51.47,
    lng: -0.4543,
    tz: 'Europe/London',
    source: 'photon',
  },
  {
    name: 'Livraria Lello',
    address: 'Rua das Carmelitas, Porto',
    locality: 'Porto',
    lat: 41.1469,
    lng: -8.6149,
    tz: 'Europe/Lisbon',
    source: 'photon',
  },
]

const now = () => new Date().toISOString()

export class MockTripServer {
  trips = new Map<string, STrip>()
  degradedPlaces = false
  nowMs = () => Date.now()
  /** Ids of members, for `updated_by`. */
  me = 'user_me'
  listId = 'list_packing'

  /** Seeds a trip directly (as if created long ago by `by`). */
  seed(roomId: string, trip: Trip, by = 'user_mia') {
    const clock = 1
    this.trips.set(trip.trip_id, {
      room_id: roomId,
      fields: {
        title: trip.title,
        destination: trip.destination,
        notes: trip.notes,
        start_date: trip.start_date,
        end_date: trip.end_date,
        tz: trip.tz,
        stops: trip.stops,
        days: trip.days,
        packing_list_id: trip.packing_list_id,
      },
      todos: trip.todos.map((t) => ({ ...t, v: 1, created_by: t.created_by ?? by })),
      bookings: trip.bookings.map((b) => ({ ...b, v: 1, created_by: b.created_by ?? by })),
      version: 1,
      v: 1,
      acked: {},
      tombstones: [],
      field_at: {},
      child_at: {},
      created_by: by,
    })
    return clock
  }

  private delta(t: STrip, id: string, known: number | undefined): TripDelta {
    const full = known === undefined
    const d: TripDelta = {
      trip_id: id,
      full,
      base_version: full ? 0 : (known as number),
      version: t.version,
      deleted: !!t.deleted_by,
      deleted_by: t.deleted_by,
    }
    const k = known ?? 0
    if (full || t.v > k) d.trip = { ...t.fields }
    d.todos = t.todos.filter((x) => full || (x.v ?? 0) > k)
    d.bookings = t.bookings.filter((x) => full || (x.v ?? 0) > k)
    if (!full) d.removed_ids = t.tombstones.filter((x) => x.v > k).map((x) => x.id)
    return d
  }

  sync(roomId: string, known: Record<string, number>): SyncResponse {
    const trips: TripDelta[] = []
    const removed: SyncResponse['removed'] = []
    for (const [id, t] of this.trips) {
      if (t.room_id !== roomId) continue
      if (t.deleted_by) {
        if (known[id] !== undefined) removed.push({ trip_id: id, deleted_by: t.deleted_by })
        continue
      }
      if (known[id] === undefined || known[id] < t.version) trips.push(this.delta(t, id, known[id]))
    }
    for (const id of Object.keys(known))
      if (!this.trips.has(id)) removed.push({ trip_id: id, purged: true })
    return { server_time: this.nowMs(), trips, removed }
  }

  ops(roomId: string, ops: TripOp[], as = this.me): OpsResponse {
    const results: OpResult[] = []
    const touched = new Set<string>()
    for (const op of ops) {
      const r = this.apply(roomId, op, as)
      results.push(r)
      if (this.trips.has(op.trip_id) && this.trips.get(op.trip_id)?.room_id === roomId)
        touched.add(op.trip_id)
    }
    const trips = [...touched].map((id) => {
      const t = this.trips.get(id) as STrip
      return this.delta(t, id, undefined)
    })
    return { server_time: this.nowMs(), results, trips }
  }

  private bump(t: STrip, trip = false) {
    t.version++
    if (trip) t.v = t.version
    return t.version
  }

  private apply(roomId: string, op: TripOp, as: string): OpResult {
    const res = (
      status: OpResult['status'],
      code?: OpResult['code'],
      skipped?: string[],
    ): OpResult => ({
      op_id: op.op_id,
      status,
      ...(code ? { code } : {}),
      ...(skipped?.length ? { skipped_fields: skipped } : {}),
    })
    if (op.v !== 1) return res('rejected', 'unsupported')
    const at = Math.min(op.at, this.nowMs())
    const patch = (op.patch ?? {}) as Record<string, unknown>
    let t = this.trips.get(op.trip_id)

    if (op.type === 'trip.create') {
      if (t) {
        return t.room_id === roomId && (t.acked[op.client_id] ?? 0) >= op.seq
          ? res('duplicate')
          : res('rejected', 'forbidden_or_unknown')
      }
      const bad = this.checkPatch(patch, TRIP_KEYS)
      if (bad) return res('rejected', bad)
      if (typeof patch.title !== 'string' || !patch.title.trim() || patch.title.length > 120)
        return res('rejected', 'invalid')
      t = {
        room_id: roomId,
        fields: { title: '' },
        todos: [],
        bookings: [],
        version: 1,
        v: 1,
        acked: { [op.client_id]: op.seq },
        tombstones: [],
        field_at: {},
        child_at: {},
        created_by: as,
      }
      this.trips.set(op.trip_id, t)
      this.writeTrip(t, patch, at)
      t.version = 1
      t.v = 1
      if (!t.fields.tz && t.fields.destination?.tz) t.fields.tz = t.fields.destination.tz
      return res('applied')
    }

    if (!t || t.room_id !== roomId) return res('rejected', 'forbidden_or_unknown')
    if ((t.acked[op.client_id] ?? 0) >= op.seq) return res('duplicate')
    const ack = () => {
      t.acked[op.client_id] = op.seq
    }

    if (t.deleted_by && op.type !== 'trip.restore') {
      ack()
      return res('rejected', 'gone')
    }

    switch (op.type) {
      case 'trip.update': {
        const bad = this.checkPatch(patch, TRIP_KEYS)
        if (bad) return res('rejected', bad)
        ack()
        const skipped = this.writeTrip(t, patch, at)
        return skipped.length ? res('conflicted', undefined, skipped) : res('applied')
      }
      case 'trip.delete':
        ack()
        t.deleted_by = as
        this.bump(t)
        return res('applied')
      case 'trip.restore':
        ack()
        delete t.deleted_by
        this.bump(t)
        return res('applied')
      case 'todo.create': {
        const id = op.entity_id ?? ''
        if (t.tombstones.some((x) => x.id === id)) return ack(), res('rejected', 'gone')
        if (t.todos.some((x) => x.todo_id === id)) return ack(), res('duplicate')
        if (t.todos.length >= 150) return ack(), res('rejected', 'cap')
        const bad = this.checkTodo(patch, true) ?? this.checkLink(t, patch)
        if (bad) return ack(), res('rejected', bad)
        ack()
        const v = this.bump(t)
        const td: TripTodo = {
          todo_id: id,
          title: '',
          done: false,
          order: 1,
          category: 'other',
          created_by: as,
          updated_by: as,
          updated_at: now(),
          ...(patch as Partial<TripTodo>),
          v,
        }
        td.tz = (patch.place as Place | undefined)?.tz || t.fields.tz
        t.todos.push(td)
        return res('applied')
      }
      case 'todo.update': {
        const td = t.todos.find((x) => x.todo_id === op.entity_id)
        if (!td) return ack(), res('rejected', 'gone')
        const bad = this.checkTodo(patch, false) ?? this.checkLink(t, patch)
        if (bad) return ack(), res('rejected', bad)
        ack()
        t.child_at[td.todo_id] ??= {}
        const clocks = t.child_at[td.todo_id]
        const skipped: string[] = []
        let changed = false
        for (const [k, val] of Object.entries(patch)) {
          if ((clocks[k] ?? 0) > at) {
            skipped.push(k)
            continue
          }
          clocks[k] = at
          ;(td as unknown as Record<string, unknown>)[k] = val
          changed = true
        }
        if (changed) {
          td.v = this.bump(t)
          td.updated_by = as
          td.updated_at = now()
          if ('done' in patch) {
            td.done_by = td.done ? as : undefined
            td.done_at = td.done ? now() : undefined
          }
          if ('place' in patch) td.tz = (patch.place as Place | null)?.tz || t.fields.tz
        }
        return skipped.length ? res('conflicted', undefined, skipped) : res('applied')
      }
      case 'todo.delete': {
        ack()
        const before = t.todos.length
        t.todos = t.todos.filter((x) => x.todo_id !== op.entity_id)
        if (t.todos.length === before) return res('rejected', 'gone')
        t.tombstones.push({ id: op.entity_id ?? '', v: this.bump(t) })
        return res('applied')
      }
      case 'booking.create': {
        const id = op.entity_id ?? ''
        if (t.tombstones.some((x) => x.id === id)) return ack(), res('rejected', 'gone')
        if (t.bookings.some((x) => x.booking_id === id)) return ack(), res('duplicate')
        if (t.bookings.length >= 50) return ack(), res('rejected', 'cap')
        const bad = this.checkBooking(patch, true)
        if (bad) return ack(), res('rejected', bad)
        ack()
        t.bookings.push({
          booking_id: id,
          kind: 'other',
          title: '',
          created_by: as,
          updated_by: as,
          updated_at: now(),
          ...(patch as Partial<Booking>),
          v: this.bump(t),
        })
        return res('applied')
      }
      case 'booking.update': {
        const b = t.bookings.find((x) => x.booking_id === op.entity_id)
        if (!b) return ack(), res('rejected', 'gone')
        const bad = this.checkBooking(patch, false)
        if (bad) return ack(), res('rejected', bad)
        ack()
        Object.assign(b, patch, { updated_by: as, updated_at: now(), v: this.bump(t) })
        return res('applied')
      }
      case 'booking.delete': {
        ack()
        const before = t.bookings.length
        t.bookings = t.bookings.filter((x) => x.booking_id !== op.entity_id)
        if (t.bookings.length === before) return res('rejected', 'gone')
        t.tombstones.push({ id: op.entity_id ?? '', v: this.bump(t) })
        // Todos linked to it lose the link.
        for (const td of t.todos)
          if (td.booking_id === op.entity_id) {
            td.booking_id = null
            td.v = this.bump(t)
          }
        return res('applied')
      }
      default:
        return res('rejected', 'unsupported')
    }
  }

  private checkPatch(patch: Record<string, unknown>, allowed: Set<string>): 'unsupported' | null {
    return Object.keys(patch).every((k) => allowed.has(k)) ? null : 'unsupported'
  }

  private checkTodo(p: Record<string, unknown>, create: boolean): 'invalid' | 'unsupported' | null {
    if (this.checkPatch(p, TODO_KEYS)) return 'unsupported'
    if (create && (typeof p.title !== 'string' || !p.title.trim())) return 'invalid'
    if (typeof p.title === 'string' && (!p.title.trim() || p.title.length > 200)) return 'invalid'
    if (typeof p.day === 'string' && !DATE.test(p.day)) return 'invalid'
    if (typeof p.start_time === 'string' && !CLOCK.test(p.start_time)) return 'invalid'
    if (typeof p.category === 'string' && !CATEGORIES.has(p.category)) return 'invalid'
    return null
  }

  /** A link must point at a booking in the same trip. */
  private checkLink(t: STrip, p: Record<string, unknown>): 'invalid' | null {
    const id = p.booking_id
    return typeof id === 'string' && !t.bookings.some((b) => b.booking_id === id) ? 'invalid' : null
  }

  private checkBooking(
    p: Record<string, unknown>,
    create: boolean,
  ): 'invalid' | 'unsupported' | null {
    if (this.checkPatch(p, BOOKING_KEYS)) return 'unsupported'
    if (create && (typeof p.title !== 'string' || !p.title.trim() || typeof p.kind !== 'string'))
      return 'invalid'
    if (typeof p.kind === 'string' && !KINDS.has(p.kind)) return 'invalid'
    return null
  }

  /** Writes trip fields by clock; returns the fields skipped because a newer edit exists. */
  private writeTrip(t: STrip, patch: Record<string, unknown>, at: number): string[] {
    const skipped: string[] = []
    let changed = false
    for (const [k, val] of Object.entries(patch)) {
      if (k === 'days') {
        for (const [d, label] of Object.entries(val as Record<string, string>)) {
          const key = `days.${d}`
          if ((t.field_at[key] ?? 0) > at) {
            skipped.push(key)
            continue
          }
          t.field_at[key] = at
          t.fields.days = { ...(t.fields.days ?? {}) }
          if (label === '') delete t.fields.days[d]
          else t.fields.days[d] = label
          changed = true
        }
        continue
      }
      if ((t.field_at[k] ?? 0) > at) {
        skipped.push(k)
        continue
      }
      t.field_at[k] = at
      ;(t.fields as unknown as Record<string, unknown>)[k] = val
      changed = true
    }
    if (changed) this.bump(t, true)
    return skipped
  }

  /** Test helper: a housemate edits a todo as if online, at the server's current clock. */
  housemateUpdateTodo(
    tripId: string,
    todoId: string,
    patch: Record<string, unknown>,
    by = 'user_mia',
  ) {
    const t = this.trips.get(tripId) as STrip
    const at = this.nowMs()
    const seq = 1_000_000 + t.version
    this.apply(
      t.room_id,
      {
        v: 1,
        op_id: `op_mia_${seq}`,
        client_id: 'dev_mia',
        seq,
        at,
        type: 'todo.update',
        trip_id: tripId,
        entity_id: todoId,
        patch,
      },
      by,
    )
  }

  searchPlaces(q: string): PlacesResponse {
    if (this.degradedPlaces) return { results: [], degraded: true }
    const needle = q.trim().toLowerCase()
    return {
      results: PLACE_BOOK.filter((p) => p.name.toLowerCase().includes(needle)).slice(0, 5),
    }
  }

  reverse(lat: number, lng: number): PlacesResponse {
    if (this.degradedPlaces) return { results: [], degraded: true }
    return {
      results: [{ name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng, source: 'pin' }],
    }
  }

  packingList(roomId: string, tripId: string) {
    const t = this.trips.get(tripId)
    if (!t || t.room_id !== roomId) return null
    if (!t.fields.packing_list_id) {
      t.fields.packing_list_id = this.listId
      this.bump(t, true)
    }
    return {
      list_id: t.fields.packing_list_id,
      room_id: roomId,
      name: `Packing · ${t.fields.title}`,
      is_deleted: false,
      created_at: now(),
      updated_at: now(),
    }
  }
}
