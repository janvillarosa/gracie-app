// In-memory model of the Go trips server, for tests and the opt-in dev worker. The source of
// truth is backend/internal/trips (apply.go, validate.go, patch.go, delta.go),
// services/trip_service.go and the trip, room, user and places handlers. Keep this file a
// line-for-line behavioural twin: the same result codes, caps, clocks and stamping, and only the
// JSON fields the real API sends (Go `omitempty`: missing means null). The table test in
// __tests__/tripsMockFidelity.test.ts pins the rules.
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

type Rec = Record<string, unknown>

type STrip = {
  room_id: string
  fields: TripFields
  todos: TripTodo[]
  bookings: Booking[]
  /** +1 per batch that changed data. */
  version: number
  /** Version when the trip's own fields last changed. */
  v: number
  acked: Record<string, number>
  tombstones: Array<{ id: string; v: number }>
  /** Trip-level field clocks (`title`, `days.<date>`, `deleted` ...). */
  field_at: Record<string, number>
  /** Todo and booking field clocks, by entity id. */
  child_at: Record<string, Record<string, number>>
  deleted_by?: string
  created_by: string
}

/** What the real handlers answer with a non-2xx status (`{"error": "..."}`). */
export class MockHttpError extends Error {
  constructor(
    public status: number,
    public body: { error: string },
  ) {
    super(body.error)
  }
}

// ---- limits and enums (validate.go) --------------------------------------------------------
export const LIMITS = {
  todos: 150,
  bookings: 50,
  stops: 12,
  days: 60,
  dayClocks: 4 * 60,
  ackedClients: 200,
  newClientsPerBatch: 3,
  opsPerBatch: 200,
  knownTrips: 500,
} as const
const MAX_TRIP_TITLE = 120
const MAX_ITEM_TITLE = 200
const MAX_TRIP_NOTES = 16384
const MAX_ITEM_NOTES = 2048
const MAX_CONFIRMATION = 64
const MAX_DAY_LABEL = 40
const MAX_LOCALITY = 120
const ORDER_STEP = 1000
const MIN_ORDER_GAP = 1e-7

export const TRIP_ICONS = new Set([
  'SUITCASE',
  'PLANE',
  'BEACH',
  'MOUNTAIN',
  'CITY',
  'TRAIN',
  'ROAD_TRIP',
  'CAMPING',
  'MAP',
  'LANDMARK',
  'WINE',
  'SKI',
])
const CATEGORIES = new Set(['food', 'sight', 'activity', 'transport', 'stay', 'shopping', 'other'])
const KINDS = new Set(['flight', 'stay', 'train', 'car', 'ticket', 'other'])
const PLACE_SOURCES = new Set(['photon', 'pin', 'manual'])

const RE_TRIP = /^trip_[0-9a-f]{32}$/
const RE_TODO = /^ttd_[0-9a-f]{32}$/
const RE_BOOKING = /^tbk_[0-9a-f]{32}$/
const RE_TOKEN = /^[A-Za-z0-9_-]{1,64}$/

const KNOWN_TYPES = new Set([
  'trip.create',
  'trip.update',
  'trip.delete',
  'trip.restore',
  'todo.create',
  'todo.update',
  'todo.delete',
  'booking.create',
  'booking.update',
  'booking.delete',
])

// ---- decoding (patch.go): strict, unknown field = "unsupported", wrong type = "invalid" ------
type Kind = 'str' | 'bool' | 'num' | 'int' | 'place' | 'places' | 'days'
/** opt: the Go `Opt[T]`: an explicit null is a value (clears). Otherwise null means "absent". */
type Spec = Record<string, { kind: Kind; opt?: boolean }>

const TRIP_SPEC: Spec = {
  title: { kind: 'str' },
  destination: { kind: 'place', opt: true },
  notes: { kind: 'str' },
  start_date: { kind: 'str', opt: true },
  end_date: { kind: 'str', opt: true },
  tz: { kind: 'str' },
  icon: { kind: 'str' },
  stops: { kind: 'places', opt: true },
  days: { kind: 'days' },
}
const TODO_SPEC: Spec = {
  title: { kind: 'str' },
  done: { kind: 'bool' },
  day: { kind: 'str', opt: true },
  start_time: { kind: 'str', opt: true },
  duration_min: { kind: 'int', opt: true },
  order: { kind: 'num' },
  category: { kind: 'str' },
  notes: { kind: 'str' },
  place: { kind: 'place', opt: true },
  booking_id: { kind: 'str', opt: true },
}
const BOOKING_SPEC: Spec = {
  kind: { kind: 'str' },
  title: { kind: 'str' },
  confirmation_code: { kind: 'str' },
  starts_at: { kind: 'str', opt: true },
  ends_at: { kind: 'str', opt: true },
  start_tz: { kind: 'str', opt: true },
  end_tz: { kind: 'str', opt: true },
  place: { kind: 'place', opt: true },
  end_place: { kind: 'place', opt: true },
  notes: { kind: 'str' },
}
const PLACE_SPEC: Record<string, 'str' | 'num'> = {
  name: 'str',
  address: 'str',
  locality: 'str',
  lat: 'num',
  lng: 'num',
  tz: 'str',
  osm_ref: 'str',
  source: 'str',
}

const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

type Code = 'unsupported' | 'invalid'

/** Strict place decode (Opt.UnmarshalJSON uses DisallowUnknownFields). null is a zero value. */
function checkPlace(v: unknown): Code | null {
  if (v === null) return null
  if (!isObj(v)) return 'invalid'
  for (const [k, val] of Object.entries(v)) {
    const want = PLACE_SPEC[k]
    if (!want) return 'unsupported'
    if (val === null) continue
    if (want === 'str' ? typeof val !== 'string' : typeof val !== 'number') return 'invalid'
  }
  return null
}

function checkKind(kind: Kind, v: unknown): Code | null {
  switch (kind) {
    case 'str':
      return typeof v === 'string' ? null : 'invalid'
    case 'bool':
      return typeof v === 'boolean' ? null : 'invalid'
    case 'num':
      return typeof v === 'number' ? null : 'invalid'
    case 'int':
      return typeof v === 'number' && Number.isInteger(v) ? null : 'invalid'
    case 'place':
      return checkPlace(v)
    case 'places': {
      if (!Array.isArray(v)) return 'invalid'
      for (const p of v) {
        const c = checkPlace(p)
        if (c) return c
      }
      return null
    }
    case 'days':
      if (!isObj(v)) return 'invalid'
      return Object.values(v).every((x) => x === null || typeof x === 'string') ? null : 'invalid'
  }
}

type Patch = Record<string, unknown>
/** Present keys only: a non-Opt field sent as null is dropped (Go leaves the pointer nil). */
function decodePatch(raw: unknown, spec: Spec): { patch: Patch } | { code: Code } {
  if (raw === undefined || raw === null) return { patch: {} }
  if (!isObj(raw)) return { code: 'invalid' }
  const patch: Patch = {}
  for (const [k, v] of Object.entries(raw)) {
    const s = spec[k]
    if (!s) return { code: 'unsupported' }
    if (v === null) {
      if (s.opt) patch[k] = null
      else if (s.kind === 'days') patch[k] = {}
      continue
    }
    const bad = checkKind(s.kind, v)
    if (bad) return { code: bad }
    patch[k] = v
  }
  return { patch }
}

// ---- validation (validate.go) ---------------------------------------------------------------
const runes = (s: string) => [...s].length
const okTitle = (s: string, max: number) => runes(s.trim()) > 0 && runes(s) <= max
const okBytes = (s: string, max: number) => new TextEncoder().encode(s).length <= max

function validDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}
function validClock(s: string): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  return !!m && +m[1] < 24 && +m[2] < 60
}
function validDateTime(s: string): boolean {
  const i = s.indexOf('T')
  return i > 0 && validDate(s.slice(0, i)) && validClock(s.slice(i + 1))
}
function validTZ(s: string): boolean {
  if (s === '' || s === 'Local') return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: s })
    return true
  } catch {
    return false
  }
}

function validPlace(p: Place | null | undefined): boolean {
  if (p === null || p === undefined) return true
  const name = p.name ?? ''
  const lat = p.lat ?? 0
  const lng = p.lng ?? 0
  return (
    okTitle(name, 200) &&
    runes(p.address ?? '') <= 300 &&
    runes(p.locality ?? '') <= MAX_LOCALITY &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    (p.osm_ref ?? '').length <= 64 &&
    PLACE_SOURCES.has(p.source ?? '') &&
    (!p.tz || validTZ(p.tz))
  )
}

/** An Opt string that carries a value must pass fn; an explicit null always passes. */
const optOK = (p: Patch, k: string, fn: (s: string) => boolean) =>
  !(k in p) || p[k] === null || fn(p[k] as string)

function validTripPatch(p: Patch, create: boolean): boolean {
  if (create && !('title' in p)) return false
  if ('title' in p && !okTitle(p.title as string, MAX_TRIP_TITLE)) return false
  if ('destination' in p && !validPlace(p.destination as Place | null)) return false
  if ('notes' in p && !okBytes(p.notes as string, MAX_TRIP_NOTES)) return false
  if (!optOK(p, 'start_date', validDate) || !optOK(p, 'end_date', validDate)) return false
  if ('stops' in p && p.stops !== null) {
    for (const pl of p.stops as Place[]) if (!pl || pl.name === '' || !validPlace(pl)) return false
  }
  const days = (p.days ?? {}) as Record<string, string | null>
  if (Object.keys(days).length > LIMITS.days) return false
  for (const [date, label] of Object.entries(days))
    if (!validDate(date) || runes(label ?? '') > MAX_DAY_LABEL) return false
  if ('icon' in p && p.icon !== '' && !TRIP_ICONS.has(p.icon as string)) return false
  return !('tz' in p) || validTZ(p.tz as string)
}

function validTodoPatch(p: Patch, create: boolean): boolean {
  if (create && !('title' in p)) return false
  if ('title' in p && !okTitle(p.title as string, MAX_ITEM_TITLE)) return false
  if (
    !optOK(p, 'day', validDate) ||
    !optOK(p, 'start_time', validClock) ||
    !optOK(p, 'booking_id', (s) => RE_BOOKING.test(s))
  )
    return false
  const dur = p.duration_min
  if (typeof dur === 'number' && (dur < 1 || dur > 1440)) return false
  if ('order' in p) {
    const o = p.order as number
    if (!Number.isFinite(o) || Math.abs(o) > 1e12) return false
  }
  if ('category' in p && !CATEGORIES.has(p.category as string)) return false
  if ('notes' in p && !okBytes(p.notes as string, MAX_ITEM_NOTES)) return false
  return !('place' in p) || validPlace(p.place as Place | null)
}

function validBookingPatch(p: Patch, create: boolean): boolean {
  if (create && (!('kind' in p) || !('title' in p))) return false
  if ('kind' in p && !KINDS.has(p.kind as string)) return false
  if ('title' in p && !okTitle(p.title as string, MAX_ITEM_TITLE)) return false
  if ('confirmation_code' in p && runes(p.confirmation_code as string) > MAX_CONFIRMATION)
    return false
  if (
    !optOK(p, 'starts_at', validDateTime) ||
    !optOK(p, 'ends_at', validDateTime) ||
    !optOK(p, 'start_tz', validTZ) ||
    !optOK(p, 'end_tz', validTZ)
  )
    return false
  if ('notes' in p && !okBytes(p.notes as string, MAX_ITEM_NOTES)) return false
  return (
    (!('place' in p) || validPlace(p.place as Place | null)) &&
    (!('end_place' in p) || validPlace(p.end_place as Place | null))
  )
}

// ---- the op envelope (DecodeOp + ValidateEnvelope) ------------------------------------------
type Op = {
  v: number
  op_id: string
  client_id: string
  seq: number
  at: number
  type: string
  trip_id: string
  entity_id: string
  patch: unknown
}
const OP_KEYS = new Set([
  'v',
  'op_id',
  'client_id',
  'seq',
  'at',
  'type',
  'trip_id',
  'entity_id',
  'patch',
])

function decodeOp(raw: unknown): { op: Op } | { res: OpResult } {
  const opId = isObj(raw) && typeof raw.op_id === 'string' ? raw.op_id : ''
  const rejected = (code: Code | 'forbidden_or_unknown'): { res: OpResult } => ({
    res: { op_id: opId, status: 'rejected', code },
  })
  if (!isObj(raw)) return rejected('invalid')
  for (const k of Object.keys(raw)) if (!OP_KEYS.has(k)) return rejected('unsupported')
  const intOk = (x: unknown) => x === undefined || (typeof x === 'number' && Number.isInteger(x))
  const strOk = (x: unknown) => x === undefined || typeof x === 'string'
  if (
    !intOk(raw.v) ||
    !intOk(raw.seq) ||
    !intOk(raw.at) ||
    !strOk(raw.op_id) ||
    !strOk(raw.client_id) ||
    !strOk(raw.type) ||
    !strOk(raw.trip_id) ||
    !strOk(raw.entity_id)
  )
    return rejected('invalid')
  const op: Op = {
    v: (raw.v as number) ?? 0,
    op_id: (raw.op_id as string) ?? '',
    client_id: (raw.client_id as string) ?? '',
    seq: (raw.seq as number) ?? 0,
    at: (raw.at as number) ?? 0,
    type: (raw.type as string) ?? '',
    trip_id: (raw.trip_id as string) ?? '',
    entity_id: (raw.entity_id as string) ?? '',
    patch: raw.patch,
  }
  const bad = validateEnvelope(op)
  return bad ? { res: { op_id: op.op_id, status: 'rejected', code: bad } } : { op }
}

function validateEnvelope(op: Op): 'unsupported' | 'invalid' | '' {
  if (op.v !== 1 || !KNOWN_TYPES.has(op.type)) return 'unsupported'
  if (
    !RE_TOKEN.test(op.op_id) ||
    !RE_TOKEN.test(op.client_id) ||
    op.seq < 1 ||
    op.at < 1 ||
    !RE_TRIP.test(op.trip_id)
  )
    return 'invalid'
  if (op.type.startsWith('todo.')) return RE_TODO.test(op.entity_id) ? '' : 'invalid'
  if (op.type.startsWith('booking.')) return RE_BOOKING.test(op.entity_id) ? '' : 'invalid'
  return op.entity_id === '' ? '' : 'invalid'
}

// ---- output: Go `omitempty` ------------------------------------------------------------------
/** Drops what Go would omit: null, '', empty arrays and empty maps. false and 0 stay. */
function omitEmpty<T>(v: T): T {
  if (Array.isArray(v)) return v.map(omitEmpty) as unknown as T
  if (!isObj(v)) return v
  const out: Rec = {}
  for (const [k, x] of Object.entries(v)) {
    if (x === null || x === undefined || x === '') continue
    if (Array.isArray(x) && x.length === 0) continue
    const y = omitEmpty(x)
    if (isObj(y) && Object.keys(y).length === 0) continue
    out[k] = y
  }
  return out as T
}

const iso = (ms: number) => new Date(ms).toISOString()

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

type Change = { name: string; apply: () => void }
type Ctx = { actor: string; now: number; newV: number }
type Outcome = { res: OpResult; dirty: boolean; bump: boolean }

export class MockTripServer {
  trips = new Map<string, STrip>()
  degradedPlaces = false
  nowMs = () => Date.now()
  /** Ids of members, for `updated_by`. */
  me = 'user_me'
  listId = 'list_packing'
  /** The caller's own room. When set, any other room id is a whole-request 403. */
  memberOf: string | null = null
  /** The house's members, as `GET /rooms/me` lists them in `members_meta`. */
  members: Array<{ user_id: string; name: string; avatar_key: string }> = []
  profile = { name: 'Jan', preferences: { trips_show_next_stop: true } }

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

  private room(roomId: string) {
    if (this.memberOf !== null && roomId !== this.memberOf)
      throw new MockHttpError(403, { error: 'forbidden' })
  }

  /** DeltaSince: what a client at `known` needs. present=false means it has no copy. */
  private delta(t: STrip, id: string, known: number, present: boolean): TripDelta {
    const full = !present
    const k = full ? 0 : known
    const d: TripDelta = {
      trip_id: id,
      full,
      base_version: full ? 0 : known,
      version: t.version,
    }
    if (t.deleted_by) {
      d.deleted = true
      d.deleted_by = t.deleted_by
    }
    if (full || t.v > k) d.trip = omitEmpty({ ...t.fields })
    const todos = t.todos.filter((x) => full || (x.v ?? 0) > k).map(omitEmpty)
    const bookings = t.bookings.filter((x) => full || (x.v ?? 0) > k).map(omitEmpty)
    if (todos.length) d.todos = todos
    if (bookings.length) d.bookings = bookings
    if (!full) {
      const removed = t.tombstones.filter((x) => x.v > k).map((x) => x.id)
      if (removed.length) d.removed_ids = removed
    }
    return d
  }

  sync(roomId: string, known: Record<string, number>): SyncResponse {
    this.room(roomId)
    if (Object.keys(known).length > LIMITS.knownTrips)
      throw new MockHttpError(400, { error: 'bad request' })
    const trips: TripDelta[] = []
    const removed: Array<{ trip_id: string; deleted_by?: string; purged?: boolean }> = []
    for (const [id, t] of this.trips) {
      if (t.room_id !== roomId) continue
      const has = known[id] !== undefined
      if (t.deleted_by) {
        if (has) removed.push({ trip_id: id, deleted_by: t.deleted_by })
        continue
      }
      if (has && known[id] === t.version) continue
      trips.push(this.delta(t, id, known[id] ?? 0, has))
    }
    for (const id of Object.keys(known).filter((x) => !this.trips.has(x)))
      removed.push({ trip_id: id, purged: true })
    trips.sort((a, b) => (a.trip_id < b.trip_id ? -1 : 1))
    removed.sort((a, b) => (a.trip_id < b.trip_id ? -1 : 1))
    return { server_time: this.nowMs(), trips, removed }
  }

  /** ApplyOps: per trip, in seq order per client_id; one version bump per trip per batch. */
  ops(roomId: string, rawOps: unknown[], as = this.me): OpsResponse {
    this.room(roomId)
    if (!Array.isArray(rawOps) || rawOps.length === 0 || rawOps.length > LIMITS.opsPerBatch)
      throw new MockHttpError(400, { error: 'bad request' })
    const now = this.nowMs()
    const results: OpResult[] = new Array(rawOps.length)
    const ops: Op[] = new Array(rawOps.length)
    const groups = new Map<string, number[]>()
    rawOps.forEach((raw, i) => {
      const d = decodeOp(raw)
      if ('res' in d) {
        results[i] = d.res
        return
      }
      ops[i] = d.op
      groups.set(d.op.trip_id, [...(groups.get(d.op.trip_id) ?? []), i])
    })
    const deltas: TripDelta[] = []
    for (const [tripId, idx] of groups) {
      const d = this.applyGroup(tripId, roomId, as, now, ops, this.bySeq(ops, idx), results)
      if (d) deltas.push(d)
    }
    return { server_time: now, results, trips: deltas }
  }

  /** Stable sort by seq within a client; clients keep their first-seen order. */
  private bySeq(ops: Op[], idx: number[]): number[] {
    const rank = new Map<string, number>()
    for (const i of idx) if (!rank.has(ops[i].client_id)) rank.set(ops[i].client_id, rank.size)
    return idx
      .map((i, n) => ({ i, n }))
      .sort((a, b) => {
        const x = ops[a.i]
        const y = ops[b.i]
        const r = (rank.get(x.client_id) ?? 0) - (rank.get(y.client_id) ?? 0)
        return r || x.seq - y.seq || a.n - b.n
      })
      .map((e) => e.i)
  }

  private applyGroup(
    tripId: string,
    roomId: string,
    actor: string,
    now: number,
    ops: Op[],
    idx: number[],
    results: OpResult[],
  ): TripDelta | null {
    const existing = this.trips.get(tripId)
    if (existing && existing.room_id !== roomId) {
      // Same answer as an unknown trip: existence in other houses is not revealed.
      for (const i of idx)
        results[i] = { op_id: ops[i].op_id, status: 'rejected', code: 'forbidden_or_unknown' }
      return null
    }
    const isNew = !existing
    const t: STrip = existing ?? {
      room_id: roomId,
      fields: { title: '' },
      todos: [],
      bookings: [],
      version: 0,
      v: 0,
      acked: {},
      tombstones: [],
      field_at: {},
      child_at: {},
      created_by: actor,
    }
    const base = t.version
    const c: Ctx = { actor, now, newV: base + 1 }
    let dirty = false
    let bump = false
    const newClients = new Set<string>()
    for (const i of idx) {
      const cid = ops[i].client_id
      if (!newClients.has(cid) && !(cid in t.acked)) {
        if (newClients.size >= LIMITS.newClientsPerBatch) {
          results[i] = { op_id: ops[i].op_id, status: 'rejected', code: 'cap' }
          continue
        }
        newClients.add(cid)
      }
      const o = this.applyOp(t, ops[i], c)
      results[i] = o.res
      dirty ||= o.dirty
      bump ||= o.bump
    }
    if (!dirty || (isNew && !bump)) return null
    if (isNew) this.trips.set(tripId, t)
    if (!bump) return null
    return isNew ? this.delta(t, tripId, 0, false) : this.delta(t, tripId, base, true)
  }

  private applyOp(t: STrip, op: Op, c: Ctx): Outcome {
    const res: OpResult = { op_id: op.op_id, status: 'applied' }
    const reject = (code: NonNullable<OpResult['code']>) => {
      res.status = 'rejected'
      res.code = code
      return false
    }
    if (op.seq <= (t.acked[op.client_id] ?? 0)) {
      res.status = 'duplicate'
      return { res, dirty: false, bump: false }
    }
    if (t.version === 0 && op.type !== 'trip.create') {
      reject('forbidden_or_unknown')
      return { res, dirty: false, bump: false }
    }
    if (!(op.client_id in t.acked) && Object.keys(t.acked).length >= LIMITS.ackedClients) {
      reject('cap') // bounded document; the seq is not consumed
      return { res, dirty: false, bump: false }
    }
    const at = Math.min(op.at, c.now)
    const bump = this.dispatch(t, op, at, c, res, reject)
    t.acked[op.client_id] = op.seq // every non-duplicate outcome consumes the seq
    if (bump) t.version = c.newV
    return { res, dirty: true, bump }
  }

  private dispatch(
    t: STrip,
    op: Op,
    at: number,
    c: Ctx,
    res: OpResult,
    reject: (code: NonNullable<OpResult['code']>) => boolean,
  ): boolean {
    if (t.deleted_by && op.type !== 'trip.restore') return reject('gone')
    switch (op.type) {
      case 'trip.create':
        return this.tripCreate(t, op, at, c, res, reject)
      case 'trip.update':
        return this.tripUpdate(t, op, at, c, res, reject)
      case 'trip.delete':
        return this.commit(
          t.field_at,
          at,
          [
            {
              name: 'deleted',
              apply: () => {
                t.deleted_by = c.actor
              },
            },
          ],
          res,
        )
      case 'trip.restore':
        if (!t.deleted_by) return false // already live: idempotent no-op
        return this.commit(
          t.field_at,
          at,
          [
            {
              name: 'deleted',
              apply: () => {
                delete t.deleted_by
              },
            },
          ],
          res,
        )
      case 'todo.create':
        return this.todoCreate(t, op, at, c, res, reject)
      case 'todo.update':
        return this.todoUpdate(t, op, at, c, res, reject)
      case 'todo.delete':
        return this.removeChild(t, op, c, 'todo')
      case 'booking.create':
        return this.bookingCreate(t, op, at, c, res, reject)
      case 'booking.update':
        return this.bookingUpdate(t, op, at, c, res, reject)
      case 'booking.delete':
        return this.removeChild(t, op, c, 'booking')
    }
    return reject('unsupported')
  }

  /** Applies each change whose clock is not newer than `at`; skipped ones make it conflicted. */
  private commit(
    clock: Record<string, number>,
    at: number,
    changes: Change[],
    res: OpResult,
  ): boolean {
    let applied = false
    for (const ch of changes) {
      if (at < (clock[ch.name] ?? 0)) {
        res.skipped_fields = [...(res.skipped_fields ?? []), ch.name]
        continue
      }
      ch.apply()
      clock[ch.name] = at
      applied = true
    }
    if (res.skipped_fields?.length) res.status = 'conflicted'
    return applied
  }

  // ---- trip ---------------------------------------------------------------------------------
  private tripChanges(t: STrip, p: Patch): Change[] {
    const f = t.fields as unknown as Rec
    const ch: Change[] = []
    const set = (k: string, val: unknown, drop = val === null) =>
      ch.push({
        name: k,
        apply: () => {
          if (drop) delete f[k]
          else f[k] = val
        },
      })
    for (const k of ['title', 'destination', 'notes', 'start_date', 'end_date', 'tz', 'icon'])
      if (k in p) set(k, p[k], p[k] === null || p[k] === '')
    if ('stops' in p) set('stops', p.stops === null ? [] : [...(p.stops as Place[])])
    const days = (p.days ?? {}) as Record<string, string | null>
    for (const date of Object.keys(days).sort()) {
      const label = days[date] ?? ''
      ch.push({
        name: `days.${date}`,
        apply: () => {
          const cur = { ...(t.fields.days ?? {}) }
          if (label === '') delete cur[date]
          else cur[date] = label
          if (Object.keys(cur).length === 0) delete t.fields.days
          else t.fields.days = cur
        },
      })
    }
    return ch
  }

  private tripCapExceeded(t: STrip, p: Patch): boolean {
    if ('stops' in p && p.stops !== null && (p.stops as Place[]).length > LIMITS.stops) return true
    let labels = Object.keys(t.fields.days ?? {}).length
    let clocks = Object.keys(t.field_at).filter((k) => k.startsWith('days.')).length
    for (const [d, label] of Object.entries((p.days ?? {}) as Record<string, string | null>)) {
      const exists = d in (t.fields.days ?? {})
      if ((label ?? '') !== '' && !exists) labels++
      else if ((label ?? '') === '' && exists) labels--
      if (!(`days.${d}` in t.field_at)) clocks++
    }
    return labels > LIMITS.days || clocks > LIMITS.dayClocks
  }

  private datesOrdered(start: unknown, end: unknown) {
    return typeof start !== 'string' || typeof end !== 'string' || end >= start
  }

  private tripCreate(
    t: STrip,
    op: Op,
    at: number,
    c: Ctx,
    res: OpResult,
    reject: (code: NonNullable<OpResult['code']>) => boolean,
  ) {
    if (t.version !== 0) return reject('forbidden_or_unknown')
    const d = decodePatch(op.patch, TRIP_SPEC)
    if ('code' in d) return reject(d.code)
    const p = d.patch
    if (!validTripPatch(p, true) || !this.datesOrdered(p.start_date, p.end_date))
      return reject('invalid')
    if (this.tripCapExceeded(t, p)) return reject('cap')
    this.commit(t.field_at, at, this.tripChanges(t, p), res)
    if (!t.fields.tz && t.fields.destination?.tz) t.fields.tz = t.fields.destination.tz
    t.v = c.newV
    return true
  }

  private tripUpdate(
    t: STrip,
    op: Op,
    at: number,
    c: Ctx,
    res: OpResult,
    reject: (code: NonNullable<OpResult['code']>) => boolean,
  ) {
    const d = decodePatch(op.patch, TRIP_SPEC)
    if ('code' in d) return reject(d.code)
    const p = d.patch
    const start = 'start_date' in p ? p.start_date : t.fields.start_date
    const end = 'end_date' in p ? p.end_date : t.fields.end_date
    if (!validTripPatch(p, false) || !this.datesOrdered(start, end)) return reject('invalid')
    if (this.tripCapExceeded(t, p)) return reject('cap')
    if (!this.commit(t.field_at, at, this.tripChanges(t, p), res)) return false
    t.v = c.newV
    return true
  }

  // ---- todos --------------------------------------------------------------------------------
  private dayKey = (d: unknown) => (typeof d === 'string' ? d : '')

  private nextOrder(t: STrip, day: unknown) {
    let max = 0
    let any = false
    for (const x of t.todos)
      if (this.dayKey(x.day) === this.dayKey(day) && (!any || x.order > max)) {
        max = x.order
        any = true
      }
    return any ? max + ORDER_STEP : ORDER_STEP
  }

  /** Re-spaces a day group (or Ideas) whose neighbours are closer than the minimum gap. */
  private renumberIfCramped(t: STrip, newV: number) {
    const groups = new Map<string, TripTodo[]>()
    for (const x of t.todos) {
      const k = this.dayKey(x.day)
      groups.set(k, [...(groups.get(k) ?? []), x])
    }
    for (const g of groups.values()) {
      g.sort((a, b) => a.order - b.order || (a.todo_id < b.todo_id ? -1 : 1))
      if (!g.some((x, k) => k > 0 && x.order - g[k - 1].order < MIN_ORDER_GAP)) continue
      g.forEach((x, k) => {
        x.order = (k + 1) * ORDER_STEP
        x.v = newV
      })
    }
  }

  private todoChanges(td: TripTodo, p: Patch, c: Ctx): Change[] {
    const o = td as unknown as Rec
    const ch: Change[] = []
    const plain = ['title', 'day', 'start_time', 'duration_min', 'order', 'category', 'notes']
    for (const k of plain)
      if (k in p)
        ch.push({
          name: k,
          apply: () => {
            if (p[k] === null || p[k] === '') delete o[k]
            else o[k] = p[k]
          },
        })
    if ('done' in p)
      ch.push({
        name: 'done',
        apply: () => {
          td.done = p.done as boolean
          if (td.done) {
            td.done_by = c.actor
            td.done_at = iso(c.now)
          } else {
            delete td.done_by
            delete td.done_at
          }
        },
      })
    for (const k of ['place', 'booking_id'])
      if (k in p)
        ch.push({
          name: k,
          apply: () => {
            if (p[k] === null) delete o[k]
            else o[k] = p[k]
          },
        })
    return ch
  }

  private resolveTodoTZ(t: STrip, td: TripTodo) {
    const tz = td.place?.tz || t.fields.tz
    if (tz) td.tz = tz
    else delete td.tz
  }

  /** booking_id must name a live booking of this trip (deleted ones are gone from the list). */
  private bookingLinkOK(t: STrip, p: Patch) {
    return (
      !('booking_id' in p) ||
      p.booking_id === null ||
      this.findBooking(t, p.booking_id as string) >= 0
    )
  }
  private findBooking = (t: STrip, id: string) => t.bookings.findIndex((b) => b.booking_id === id)
  private findTodo = (t: STrip, id: string) => t.todos.findIndex((x) => x.todo_id === id)
  private tombstoned = (t: STrip, id: string) => t.tombstones.some((x) => x.id === id)

  private todoCreate(
    t: STrip,
    op: Op,
    at: number,
    c: Ctx,
    res: OpResult,
    reject: (code: NonNullable<OpResult['code']>) => boolean,
  ) {
    if (this.tombstoned(t, op.entity_id)) return reject('gone')
    if (t.todos.length >= LIMITS.todos) return reject('cap')
    if (this.findTodo(t, op.entity_id) >= 0) return reject('invalid') // never "duplicate"
    const d = decodePatch(op.patch, TODO_SPEC)
    if ('code' in d) return reject(d.code)
    const p = d.patch
    if (!validTodoPatch(p, true) || !this.bookingLinkOK(t, p)) return reject('invalid')
    const td: TripTodo = {
      todo_id: op.entity_id,
      title: '',
      done: false,
      order: 0,
      category: 'other',
      created_by: c.actor,
      updated_by: c.actor,
      updated_at: iso(c.now),
    }
    const clocks: Record<string, number> = {}
    this.commit(clocks, at, this.todoChanges(td, p, c), res)
    if (!('order' in p)) td.order = this.nextOrder(t, td.day)
    td.v = c.newV
    this.resolveTodoTZ(t, td)
    t.todos.push(td)
    t.child_at[op.entity_id] = clocks
    this.renumberIfCramped(t, c.newV)
    return true
  }

  private todoUpdate(
    t: STrip,
    op: Op,
    at: number,
    c: Ctx,
    res: OpResult,
    reject: (code: NonNullable<OpResult['code']>) => boolean,
  ) {
    const i = this.findTodo(t, op.entity_id)
    if (i < 0) return reject('gone')
    const d = decodePatch(op.patch, TODO_SPEC)
    if ('code' in d) return reject(d.code)
    const p = d.patch
    if (!validTodoPatch(p, false) || !this.bookingLinkOK(t, p)) return reject('invalid')
    const td = t.todos[i]
    t.child_at[op.entity_id] ??= {}
    if (!this.commit(t.child_at[op.entity_id], at, this.todoChanges(td, p, c), res)) return false
    td.v = c.newV
    td.updated_by = c.actor
    td.updated_at = iso(c.now)
    if ('place' in p) this.resolveTodoTZ(t, td) // a title-only edit must not shift the time
    if ('order' in p || 'day' in p) this.renumberIfCramped(t, c.newV)
    return true
  }

  // ---- bookings -----------------------------------------------------------------------------
  private bookingChanges(b: Booking, p: Patch): Change[] {
    const o = b as unknown as Rec
    const ch: Change[] = []
    const put = (k: string) =>
      ch.push({
        name: k,
        apply: () => {
          if (p[k] === null || p[k] === '') delete o[k]
          else o[k] = p[k]
        },
      })
    for (const k of [
      'kind',
      'title',
      'confirmation_code',
      'starts_at',
      'ends_at',
      'start_tz',
      'end_tz',
      'place',
    ])
      if (k in p) put(k)
    if ('end_place' in p) {
      put('end_place')
      // end_tz follows the arrival place unless the patch names it (start_tz is not derived).
      const tz = (p.end_place as Place | null)?.tz
      if (!('end_tz' in p) && tz)
        ch.push({
          name: 'end_tz',
          apply: () => {
            o.end_tz = tz
          },
        })
    }
    if ('notes' in p) put('notes')
    return ch
  }

  private bookingCreate(
    t: STrip,
    op: Op,
    at: number,
    c: Ctx,
    res: OpResult,
    reject: (code: NonNullable<OpResult['code']>) => boolean,
  ) {
    if (this.tombstoned(t, op.entity_id)) return reject('gone')
    if (t.bookings.length >= LIMITS.bookings) return reject('cap')
    if (this.findBooking(t, op.entity_id) >= 0) return reject('invalid')
    const d = decodePatch(op.patch, BOOKING_SPEC)
    if ('code' in d) return reject(d.code)
    const p = d.patch
    if (!validBookingPatch(p, true)) return reject('invalid')
    const b: Booking = {
      booking_id: op.entity_id,
      kind: 'other',
      title: '',
      created_by: c.actor,
      updated_by: c.actor,
      updated_at: iso(c.now),
    }
    const clocks: Record<string, number> = {}
    this.commit(clocks, at, this.bookingChanges(b, p), res)
    b.v = c.newV
    t.bookings.push(b)
    t.child_at[op.entity_id] = clocks
    return true
  }

  private bookingUpdate(
    t: STrip,
    op: Op,
    at: number,
    c: Ctx,
    res: OpResult,
    reject: (code: NonNullable<OpResult['code']>) => boolean,
  ) {
    const i = this.findBooking(t, op.entity_id)
    if (i < 0) return reject('gone')
    const d = decodePatch(op.patch, BOOKING_SPEC)
    if ('code' in d) return reject(d.code)
    const p = d.patch
    if (!validBookingPatch(p, false)) return reject('invalid')
    const b = t.bookings[i]
    t.child_at[op.entity_id] ??= {}
    if (!this.commit(t.child_at[op.entity_id], at, this.bookingChanges(b, p), res)) return false
    b.v = c.newV
    b.updated_by = c.actor
    b.updated_at = iso(c.now)
    return true
  }

  /** todo.delete / booking.delete: a missing entity is an idempotent no-op; a tombstone is left. */
  private removeChild(t: STrip, op: Op, c: Ctx, kind: 'todo' | 'booking') {
    if (kind === 'todo') {
      const i = this.findTodo(t, op.entity_id)
      if (i < 0) return false
      t.todos.splice(i, 1)
    } else {
      const i = this.findBooking(t, op.entity_id)
      if (i < 0) return false
      t.bookings.splice(i, 1)
    }
    delete t.child_at[op.entity_id]
    t.tombstones.push({ id: op.entity_id, v: c.newV })
    if (kind === 'booking')
      for (const td of t.todos) // cascade: no todo may point at a deleted booking
        if (td.booking_id === op.entity_id) {
          delete td.booking_id
          td.v = c.newV
          td.updated_by = c.actor
          td.updated_at = iso(c.now)
        }
    return true
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
    this.ops(
      t.room_id,
      [
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
        } satisfies TripOp,
      ],
      by,
    )
  }

  // ---- places (services/places) ---------------------------------------------------------------
  searchPlaces(q: string, limit?: number): PlacesResponse {
    const needle = q.trim().toLowerCase()
    if (runes(needle) < 3 || runes(needle) > 100)
      throw new MockHttpError(400, { error: 'bad request' })
    if (this.degradedPlaces) return { results: [], degraded: true }
    const n = limit && limit >= 1 && limit <= 10 ? limit : 5
    return { results: PLACE_BOOK.filter((p) => p.name.toLowerCase().includes(needle)).slice(0, n) }
  }

  reverse(lat: number, lng: number): PlacesResponse {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      throw new MockHttpError(400, { error: 'bad request' })
    if (this.degradedPlaces) return { results: [], degraded: true }
    return {
      results: [{ name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng, source: 'pin' }],
    }
  }

  packingList(roomId: string, tripId: string) {
    const t = this.trips.get(tripId)
    if (!t || t.room_id !== roomId || t.deleted_by) return null
    if (!t.fields.packing_list_id) {
      t.fields.packing_list_id = this.listId
      t.version++
      t.v = t.version
    }
    return {
      list_id: t.fields.packing_list_id,
      room_id: roomId,
      name: `Packing · ${t.fields.title}`,
      is_deleted: false,
      created_at: iso(this.nowMs()),
      updated_at: iso(this.nowMs()),
    }
  }

  // ---- /me and /rooms/me (handlers/user.go, room.go) ------------------------------------------
  /** GET /me: `preferences.trips_show_next_stop` is always a concrete bool. */
  getMe() {
    return {
      user_id: this.me,
      name: this.profile.name,
      preferences: { ...this.profile.preferences },
    }
  }

  /** PUT /me: 204 with no body. Unknown keys at any level, an empty name, or a body with
   *  nothing to change are 400; the client re-reads /me. */
  putMe(body: unknown): { status: 204 } | { status: 400; body: { error: string } } {
    const bad = { status: 400 as const, body: { error: 'invalid request' } }
    if (!isObj(body)) return bad
    for (const k of Object.keys(body)) if (k !== 'name' && k !== 'preferences') return bad
    const name = body.name
    if (name !== undefined && name !== null && typeof name !== 'string') return bad
    if (name === '') return bad
    let next: boolean | undefined
    const prefs = body.preferences
    if (prefs !== undefined && prefs !== null) {
      if (!isObj(prefs)) return bad
      for (const k of Object.keys(prefs)) if (k !== 'trips_show_next_stop') return bad
      const v = prefs.trips_show_next_stop
      if (v !== undefined && v !== null && typeof v !== 'boolean') return bad
      if (typeof v === 'boolean') next = v
    }
    if (typeof name !== 'string' && next === undefined) return bad
    if (typeof name === 'string') this.profile.name = name
    if (next !== undefined) this.profile.preferences.trips_show_next_stop = next
    return { status: 204 }
  }

  /** GET /rooms/me `members_meta`: every entry carries the member's `user_id`. */
  membersMeta() {
    return this.members.map((m) => ({ user_id: m.user_id, name: m.name, avatar_key: m.avatar_key }))
  }
}
