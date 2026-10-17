// Pins the mock to the Go server. Each case mirrors one in backend/internal/trips/*_test.go or
// the service/handler rules (trip_service.go, handlers/{trip,room,user}.go). If a rule changes
// there, change mocks/tripsServer.ts and this file together.
import { beforeEach, describe, expect, it } from 'vitest'
import type { OpResult, TripOp, TripOpType } from '../api/tripTypes'
import { MockHttpError, MockTripServer } from '../mocks/tripsServer'

const ROOM = 'room_1'
const NOW = 1_800_000_000_000
const hex = (n: number) => (n % 16).toString(16).repeat(32)
const TRIP = `trip_${hex(1)}`
const todoId = (n: number) => `ttd_${hex(n)}`
const bookingId = (n: number) => `tbk_${hex(n)}`
const place = (name: string, tz = '') => ({
  name,
  lat: 35,
  lng: 135,
  source: 'pin',
  locality: name,
  ...(tz ? { tz } : {}),
})

let srv: MockTripServer
const seqs: Record<string, number> = {}

function op(
  client: string,
  type: TripOpType,
  entity: string | undefined,
  patch: unknown,
  at = NOW - 10_000,
  tripId = TRIP,
): TripOp {
  seqs[client] = (seqs[client] ?? 0) + 1
  return {
    v: 1,
    op_id: `op-${client}-${seqs[client]}`,
    client_id: client,
    seq: seqs[client],
    at,
    type,
    trip_id: tripId,
    ...(entity ? { entity_id: entity } : {}),
    ...(patch === undefined ? {} : { patch: patch as Record<string, unknown> }),
  }
}

/** One op per batch, like the Go harness. */
function run(...args: Parameters<typeof op>): OpResult {
  return srv.ops(ROOM, [op(...args)]).results[0]
}
const mk = () => run('dev-a', 'trip.create', undefined, { title: 'Trip' })
const state = () => srv.trips.get(TRIP)
const stateRec = (r: OpResult) => `${r.status}/${r.code ?? ''}`

beforeEach(() => {
  srv = new MockTripServer()
  srv.nowMs = () => NOW
  for (const k of Object.keys(seqs)) delete seqs[k]
})

describe('envelope', () => {
  it.each([
    ['unknown version', { v: 2 }, 'rejected/unsupported'],
    ['unknown type', { type: 'trip.explode' }, 'rejected/unsupported'],
    ['unknown top-level key', { colour: 'red' }, 'rejected/unsupported'],
    ['bad op_id', { op_id: 'has space' }, 'rejected/invalid'],
    ['seq below 1', { seq: 0 }, 'rejected/invalid'],
    ['at below 1', { at: 0 }, 'rejected/invalid'],
    ['bad trip id', { trip_id: 'trip_xyz' }, 'rejected/invalid'],
    ['entity id on a trip op', { entity_id: todoId(1) }, 'rejected/invalid'],
    [
      'wrong entity prefix on a todo op',
      { type: 'todo.create', entity_id: bookingId(1) },
      'rejected/invalid',
    ],
    ['wrong json type', { seq: 'one' }, 'rejected/invalid'],
  ])('%s', (_name, over, want) => {
    const raw = { ...op('dev-a', 'trip.create', undefined, { title: 'T' }), ...over }
    const { results, trips } = srv.ops(ROOM, [raw])
    expect(stateRec(results[0])).toBe(want)
    expect(trips).toEqual([])
    expect(srv.trips.size).toBe(0)
  })

  it('an envelope rejection does not consume the seq', () => {
    srv.ops(ROOM, [{ ...op('dev-a', 'trip.create', undefined, { title: 'T' }), v: 2 }])
    seqs['dev-a'] = 0
    expect(run('dev-a', 'trip.create', undefined, { title: 'T' }).status).toBe('applied')
  })
})

describe('trip lifecycle and idempotency', () => {
  it('a non-create op on an unknown trip is forbidden_or_unknown and creates nothing', () => {
    expect(stateRec(run('dev-a', 'trip.update', undefined, { notes: 'x' }))).toBe(
      'rejected/forbidden_or_unknown',
    )
    expect(srv.trips.size).toBe(0)
  })

  it('trip.create on an existing trip with a new seq is forbidden_or_unknown', () => {
    mk()
    expect(stateRec(run('dev-b', 'trip.create', undefined, { title: 'Again' }))).toBe(
      'rejected/forbidden_or_unknown',
    )
    expect(state()?.fields.title).toBe('Trip')
  })

  it('replaying a seq (or any lower one) is duplicate and changes nothing', () => {
    const first = op('dev-a', 'trip.create', undefined, { title: 'Trip' })
    expect(srv.ops(ROOM, [first]).results[0].status).toBe('applied')
    const again = srv.ops(ROOM, [first])
    expect(again.results[0].status).toBe('duplicate')
    expect(again.trips).toEqual([])
    expect(state()?.version).toBe(1)
  })

  it('a rejected op still consumes its seq (the replay is a duplicate)', () => {
    mk()
    const bad = op('dev-a', 'trip.update', undefined, { colour: 'red' })
    expect(srv.ops(ROOM, [bad]).results[0].code).toBe('unsupported')
    expect(srv.ops(ROOM, [bad]).results[0].status).toBe('duplicate')
  })

  it('a deleted trip answers gone to everything but restore', () => {
    mk()
    expect(run('dev-a', 'trip.delete', undefined, undefined).status).toBe('applied')
    expect(stateRec(run('dev-a', 'trip.update', undefined, { notes: 'x' }))).toBe('rejected/gone')
    expect(stateRec(run('dev-a', 'todo.create', todoId(1), { title: 'x' }))).toBe('rejected/gone')
    expect(run('dev-a', 'trip.restore', undefined, undefined).status).toBe('applied')
    expect(state()?.deleted_by).toBeUndefined()
    // restoring a live trip is an idempotent no-op: applied, no version bump
    const v = state()?.version
    expect(run('dev-a', 'trip.restore', undefined, undefined).status).toBe('applied')
    expect(state()?.version).toBe(v)
  })

  it('one version bump per trip per batch, and every op in it carries that version', () => {
    mk()
    const r = srv.ops(ROOM, [
      op('dev-a', 'todo.create', todoId(1), { title: 'a' }),
      op('dev-a', 'todo.create', todoId(2), { title: 'b' }),
      op('dev-a', 'trip.update', undefined, { notes: 'n' }),
    ])
    expect(r.results.map((x) => x.status)).toEqual(['applied', 'applied', 'applied'])
    expect(state()?.version).toBe(2)
    expect(state()?.todos.map((t) => t.v)).toEqual([2, 2])
    expect(state()?.v).toBe(2)
    expect(r.trips).toHaveLength(1)
    expect(r.trips[0]).toMatchObject({ full: false, base_version: 1, version: 2 })
  })

  it('a batch that changes nothing returns no delta', () => {
    mk()
    const r = srv.ops(ROOM, [op('dev-a', 'trip.update', undefined, { colour: 'x' })])
    expect(r.trips).toEqual([])
    expect(state()?.version).toBe(1)
  })

  it('sorts a trip batch by seq per client rather than calling a late seq a duplicate', () => {
    const a = op('dev-a', 'trip.create', undefined, { title: 'T' })
    const b = op('dev-a', 'trip.update', undefined, { notes: 'n' })
    const r = srv.ops(ROOM, [b, a])
    expect(r.results.map((x) => x.status)).toEqual(['applied', 'applied'])
  })
})

describe('rooms', () => {
  it('a trip of another house answers like an unknown trip, to every op, consuming nothing', () => {
    mk()
    const r = srv.ops('room_2', [
      op('dev-x', 'trip.update', undefined, { notes: 'x' }),
      op('dev-x', 'todo.create', todoId(1), { title: 'x' }),
    ])
    expect(r.results.map(stateRec)).toEqual([
      'rejected/forbidden_or_unknown',
      'rejected/forbidden_or_unknown',
    ])
    expect(r.trips).toEqual([])
    expect(state()?.acked['dev-x']).toBeUndefined()
    expect(state()?.fields.notes).toBeUndefined()
  })

  it('asking as a non-member is a whole-request 403 (ops and sync)', () => {
    srv.memberOf = ROOM
    const send = () => srv.ops('room_2', [op('dev-a', 'trip.create', undefined, { title: 'T' })])
    expect(send).toThrow(MockHttpError)
    try {
      send()
    } catch (e) {
      expect((e as MockHttpError).status).toBe(403)
    }
    expect(() => srv.sync('room_2', {})).toThrow(MockHttpError)
    expect(srv.trips.size).toBe(0)
  })

  it('empty and oversized batches are a 400', () => {
    expect(() => srv.ops(ROOM, [])).toThrow(MockHttpError)
    const many = Array.from({ length: 201 }, () => op('dev-a', 'trip.update', undefined, {}))
    expect(() => srv.ops(ROOM, many)).toThrow(MockHttpError)
    expect(() =>
      srv.sync(ROOM, Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`t${i}`, 1]))),
    ).toThrow(MockHttpError)
  })
})

describe('children', () => {
  beforeEach(mk)

  it('creating an entity that already exists (another device) is invalid, not duplicate', () => {
    run('dev-a', 'todo.create', todoId(1), { title: 'a' })
    expect(stateRec(run('dev-b', 'todo.create', todoId(1), { title: 'b' }))).toBe(
      'rejected/invalid',
    )
    run('dev-a', 'booking.create', bookingId(1), { kind: 'train', title: 'x' })
    expect(
      stateRec(run('dev-b', 'booking.create', bookingId(1), { kind: 'train', title: 'x' })),
    ).toBe('rejected/invalid')
  })

  it('a deleted entity cannot be recreated (tombstone) and deleting twice is a no-op', () => {
    run('dev-a', 'todo.create', todoId(1), { title: 'a' })
    expect(run('dev-a', 'todo.delete', todoId(1), undefined).status).toBe('applied')
    expect(stateRec(run('dev-b', 'todo.create', todoId(1), { title: 'a' }))).toBe('rejected/gone')
    const v = state()?.version
    expect(run('dev-a', 'todo.delete', todoId(1), undefined).status).toBe('applied')
    expect(state()?.version).toBe(v)
    expect(stateRec(run('dev-a', 'todo.update', todoId(1), { title: 'z' }))).toBe('rejected/gone')
  })

  it('caps: 150 todos and 50 bookings', () => {
    const batch = (n: number, type: TripOpType, id: (i: number) => string, patch: unknown) =>
      srv.ops(
        ROOM,
        Array.from({ length: n }, (_, i) => op('dev-a', type, id(i), patch)),
      )
    const ids = (i: number) => `ttd_${i.toString(16).padStart(32, '0')}`
    const bids = (i: number) => `tbk_${i.toString(16).padStart(32, '0')}`
    for (let b = 0; b < 150; b += 100) {
      const r = batch(Math.min(100, 150 - b), 'todo.create', (i) => ids(b + i), { title: 'x' })
      expect(r.results.every((x) => x.status === 'applied')).toBe(true)
    }
    expect(stateRec(run('dev-a', 'todo.create', ids(999), { title: 'x' }))).toBe('rejected/cap')
    batch(50, 'booking.create', bids, { kind: 'other', title: 'x' })
    expect(stateRec(run('dev-a', 'booking.create', bids(999), { kind: 'other', title: 'x' }))).toBe(
      'rejected/cap',
    )
  })

  it('booking_id must name a live booking of the trip', () => {
    run('dev-a', 'booking.create', bookingId(1), { kind: 'train', title: 'x' })
    let linkN = 0
    const link = (id: unknown) =>
      stateRec(run('dev-a', 'todo.create', todoId(++linkN + 2), { title: 't', booking_id: id }))
    expect(link(bookingId(9))).toBe('rejected/invalid') // unknown booking
    expect(link('not-an-id')).toBe('rejected/invalid')
    run('dev-a', 'todo.create', todoId(1), { title: 'a', booking_id: bookingId(1) })
    expect(state()?.todos.find((t) => t.todo_id === todoId(1))?.booking_id).toBe(bookingId(1))
    expect(run('dev-a', 'todo.update', todoId(1), { booking_id: null }).status).toBe('applied')
    expect(state()?.todos[0].booking_id).toBeUndefined()
  })

  it('deleting a booking clears the link on its todos, bumps and stamps them', () => {
    run('dev-a', 'booking.create', bookingId(1), { kind: 'train', title: 'x' })
    run('dev-a', 'todo.create', todoId(1), { title: 'a', booking_id: bookingId(1) })
    const stamped = srv.ops(
      ROOM,
      [op('dev-a', 'booking.delete', bookingId(1), undefined)],
      'user_other',
    )
    expect(stamped.results[0].status).toBe('applied')
    const td = state()?.todos[0]
    expect(td?.booking_id).toBeUndefined()
    expect(td?.updated_by).toBe('user_other')
    expect(td?.v).toBe(state()?.version)
    // the todo travels in the delta, the booking as a removed id
    expect(stamped.trips[0].todos?.[0].todo_id).toBe(todoId(1))
    expect(stamped.trips[0].removed_ids).toEqual([bookingId(1)])
    // and a later link to the dead booking is invalid
    expect(stateRec(run('dev-a', 'todo.update', todoId(1), { booking_id: bookingId(1) }))).toBe(
      'rejected/invalid',
    )
  })

  it('validates todo and booking fields', () => {
    const t = (patch: unknown) => stateRec(run('dev-a', 'todo.create', todoId(5), patch))
    expect(t({})).toBe('rejected/invalid') // title required
    expect(t({ title: '   ' })).toBe('rejected/invalid')
    expect(t({ title: 'x', day: '2026-13-01' })).toBe('rejected/invalid')
    expect(t({ title: 'x', start_time: '25:00' })).toBe('rejected/invalid')
    expect(t({ title: 'x', duration_min: 0 })).toBe('rejected/invalid')
    expect(t({ title: 'x', category: 'fun' })).toBe('rejected/invalid')
    expect(t({ title: 'x', order: 1e13 })).toBe('rejected/invalid')
    expect(t({ title: 'x', duration_min: 1.5 })).toBe('rejected/invalid') // not an integer
    expect(t({ title: 'x', title2: 1 })).toBe('rejected/unsupported')
    const b = (patch: unknown) => stateRec(run('dev-a', 'booking.create', bookingId(5), patch))
    expect(b({ title: 'x' })).toBe('rejected/invalid') // kind required
    expect(b({ kind: 'boat', title: 'x' })).toBe('rejected/invalid')
    expect(b({ kind: 'car', title: 'x', starts_at: '2026-01-01' })).toBe('rejected/invalid')
    expect(b({ kind: 'car', title: 'x', start_tz: 'Mars/Base' })).toBe('rejected/invalid')
    expect(b({ kind: 'car', title: 'x', confirmation_code: 'x'.repeat(65) })).toBe(
      'rejected/invalid',
    )
    expect(b({ kind: 'car', title: 'x', starts_at: '2026-01-01T09:30' })).toBe('applied/')
  })

  it('resolves a todo tz from its place, else the trip, and keeps it on title-only edits', () => {
    run('dev-a', 'trip.update', undefined, { tz: 'Europe/Lisbon' })
    run('dev-a', 'todo.create', todoId(1), { title: 'a' })
    expect(state()?.todos[0].tz).toBe('Europe/Lisbon')
    run('dev-a', 'todo.update', todoId(1), { place: place('Tokyo', 'Asia/Tokyo') })
    expect(state()?.todos[0].tz).toBe('Asia/Tokyo')
    run('dev-a', 'trip.update', undefined, { tz: 'Europe/London' })
    run('dev-a', 'todo.update', todoId(1), { title: 'b' })
    expect(state()?.todos[0].tz).toBe('Asia/Tokyo')
  })

  it('appends new todos after the last of their day', () => {
    run('dev-a', 'todo.create', todoId(1), { title: 'a', day: '2026-10-20' })
    run('dev-a', 'todo.create', todoId(2), { title: 'b', day: '2026-10-20' })
    run('dev-a', 'todo.create', todoId(3), { title: 'c' })
    expect(state()?.todos.map((t) => t.order)).toEqual([1000, 2000, 1000])
  })
})

describe('field clocks', () => {
  beforeEach(mk)

  it('an older edit loses with conflicted + skipped_fields; the rest of the patch applies', () => {
    run('dev-a', 'todo.create', todoId(1), { title: 'a' }, NOW - 5000)
    run('dev-a', 'todo.update', todoId(1), { title: 'newer' }, NOW - 1000)
    const r = run('dev-b', 'todo.update', todoId(1), { title: 'older', notes: 'n' }, NOW - 3000)
    expect(r).toEqual({ op_id: r.op_id, status: 'conflicted', skipped_fields: ['title'] })
    expect(state()?.todos[0]).toMatchObject({ title: 'newer', notes: 'n' })
  })

  it('an edit at exactly the clock wins (ties apply)', () => {
    run('dev-a', 'trip.update', undefined, { notes: 'a' }, NOW - 1000)
    expect(run('dev-b', 'trip.update', undefined, { notes: 'b' }, NOW - 1000).status).toBe(
      'applied',
    )
    expect(state()?.fields.notes).toBe('b')
  })

  it('a fully skipped op is conflicted without a version bump or a delta', () => {
    run('dev-a', 'trip.update', undefined, { notes: 'a' }, NOW - 1000)
    const v = state()?.version
    const r = srv.ops(ROOM, [op('dev-b', 'trip.update', undefined, { notes: 'b' }, NOW - 9000)])
    expect(r.results[0].status).toBe('conflicted')
    expect(r.trips).toEqual([])
    expect(state()?.version).toBe(v)
  })

  it('clamps at to server time: a skewed phone clock does not win forever', () => {
    run('dev-a', 'trip.update', undefined, { notes: 'future' }, NOW + 86_400_000)
    expect(state()?.field_at.notes).toBe(NOW)
    expect(run('dev-b', 'trip.update', undefined, { notes: 'now' }, NOW).status).toBe('applied')
    expect(state()?.fields.notes).toBe('now')
  })

  it('day labels have a clock each: days.<date> conflicts only on the same date', () => {
    run('dev-a', 'trip.update', undefined, { days: { '2026-10-20': 'Sintra' } }, NOW - 1000)
    const other = run(
      'dev-b',
      'trip.update',
      undefined,
      { days: { '2026-10-21': 'Porto' } },
      NOW - 5000,
    )
    expect(other.status).toBe('applied')
    const same = run(
      'dev-b',
      'trip.update',
      undefined,
      { days: { '2026-10-20': 'Old' } },
      NOW - 5000,
    )
    expect(same).toMatchObject({ status: 'conflicted', skipped_fields: ['days.2026-10-20'] })
    expect(state()?.fields.days).toEqual({ '2026-10-20': 'Sintra', '2026-10-21': 'Porto' })
  })

  it('an empty label removes the day; the last removal drops the map', () => {
    run('dev-a', 'trip.update', undefined, { days: { '2026-10-20': 'Sintra' } }, NOW - 5000)
    run('dev-a', 'trip.update', undefined, { days: { '2026-10-20': '' } }, NOW - 1000)
    expect(state()?.fields.days).toBeUndefined()
  })

  it('done stamps done_by / done_at and clears them again', () => {
    run('dev-a', 'todo.create', todoId(1), { title: 'a' })
    run('dev-a', 'todo.update', todoId(1), { done: true })
    expect(state()?.todos[0]).toMatchObject({
      done: true,
      done_by: 'user_me',
      done_at: new Date(NOW).toISOString(),
    })
    run('dev-a', 'todo.update', todoId(1), { done: false })
    expect(state()?.todos[0].done_by).toBeUndefined()
    expect(state()?.todos[0].done_at).toBeUndefined()
  })
})

describe('trip fields', () => {
  it('takes tz from the destination once, then only explicit edits change it', () => {
    run('dev-a', 'trip.create', undefined, {
      title: 'T',
      destination: place('Lisbon', 'Europe/Lisbon'),
    })
    expect(state()?.fields.tz).toBe('Europe/Lisbon')
    run('dev-a', 'trip.update', undefined, { destination: place('Tokyo', 'Asia/Tokyo') })
    expect(state()?.fields.tz).toBe('Europe/Lisbon')
  })

  it.each([
    ['unknown icon', { icon: 'ROCKET' }, 'rejected/invalid'],
    ['known icon', { icon: 'PLANE' }, 'applied/'],
    ['empty icon clears', { icon: '' }, 'applied/'],
    ['end before start', { start_date: '2026-10-20', end_date: '2026-10-19' }, 'rejected/invalid'],
    ['bad date', { start_date: '2026-02-30' }, 'rejected/invalid'],
    ['bad tz', { tz: 'Nowhere/City' }, 'rejected/invalid'],
    ['empty tz', { tz: '' }, 'rejected/invalid'],
    ['long title', { title: 'x'.repeat(121) }, 'rejected/invalid'],
    ['too many bytes of notes', { notes: 'x'.repeat(16385) }, 'rejected/invalid'],
    ['unknown field', { colour: 'red' }, 'rejected/unsupported'],
    ['wrong type', { title: 5 }, 'rejected/invalid'],
    [
      'unknown field inside a place',
      { destination: { ...place('A'), from_the_future: 1 } },
      'rejected/unsupported',
    ],
    ['place with a bad latitude', { destination: { ...place('A'), lat: 123 } }, 'rejected/invalid'],
    [
      'place with a bad source',
      { destination: { ...place('A'), source: 'guess' } },
      'rejected/invalid',
    ],
    ['stop without a name', { stops: [{ ...place('A'), name: '' }] }, 'rejected/invalid'],
    ['day with a long label', { days: { '2026-10-20': 'x'.repeat(41) } }, 'rejected/invalid'],
    ['day with a bad date', { days: { tomorrow: 'x' } }, 'rejected/invalid'],
  ])('%s', (_n, patch, want) => {
    mk()
    expect(stateRec(run('dev-a', 'trip.update', undefined, patch))).toBe(want)
  })

  it('create needs a title', () => {
    expect(stateRec(run('dev-a', 'trip.create', undefined, {}))).toBe('rejected/invalid')
    expect(srv.trips.size).toBe(0)
  })

  it('caps stops at 12', () => {
    mk()
    const stops = (n: number) => Array.from({ length: n }, (_, i) => place(`S${i}`))
    expect(stateRec(run('dev-a', 'trip.update', undefined, { stops: stops(13) }))).toBe(
      'rejected/cap',
    )
    expect(run('dev-a', 'trip.update', undefined, { stops: stops(12) }).status).toBe('applied')
    expect(state()?.fields.stops).toHaveLength(12)
    run('dev-a', 'trip.update', undefined, { stops: null })
    expect(state()?.fields.stops).toEqual([])
  })

  // apply_trip_test.go TestTravellers*, trip_service_test.go TestApplyOpsRejectsTravellersWhoAreNotMembers
  it('sets travellers as a whole list, null clears to the whole house, shape is validated', () => {
    mk()
    expect(
      run('dev-a', 'trip.update', undefined, { travellers: ['user_a', 'user_b'] }).status,
    ).toBe('applied')
    expect(state()?.fields.travellers).toEqual(['user_a', 'user_b'])
    run('dev-a', 'trip.update', undefined, { travellers: null })
    expect(state()?.fields.travellers).toBeUndefined()
    const many = Array.from({ length: 21 }, (_, i) => `user_${i}`)
    for (const bad of [many, ['user_a', 'user_a'], [''], [1]])
      expect(stateRec(run('dev-a', 'trip.update', undefined, { travellers: bad }))).toBe(
        'rejected/invalid',
      )
  })

  it('rejects travellers who are not members of the house', () => {
    srv.members = [
      { user_id: 'user_a', name: 'A', avatar_key: 'a' },
      { user_id: 'user_b', name: 'B', avatar_key: 'b' },
    ]
    mk()
    expect(stateRec(run('dev-a', 'trip.update', undefined, { travellers: ['user_c'] }))).toBe(
      'rejected/invalid',
    )
    expect(run('dev-a', 'trip.update', undefined, { travellers: ['user_b'] }).status).toBe(
      'applied',
    )
  })

  it('caps day labels at 60 (per-patch key limit is invalid, the running total is cap)', () => {
    mk()
    const date = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
    const days = (from: number, n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [date(from + i), `d${i}`]))
    expect(stateRec(run('dev-a', 'trip.update', undefined, { days: days(0, 61) }))).toBe(
      'rejected/invalid',
    )
    expect(run('dev-a', 'trip.update', undefined, { days: days(0, 60) }).status).toBe('applied')
    expect(stateRec(run('dev-a', 'trip.update', undefined, { days: days(100, 1) }))).toBe(
      'rejected/cap',
    )
    // replacing an existing label does not add one
    expect(run('dev-a', 'trip.update', undefined, { days: days(0, 1) }, NOW).status).toBe('applied')
  })
})

describe('bounded clients', () => {
  it('at most 3 new client ids per trip per batch; the rest are cap and consume nothing', () => {
    mk()
    const r = srv.ops(
      ROOM,
      ['c1', 'c2', 'c3', 'c4'].map((c) => op(c, 'trip.update', undefined, { notes: c })),
    )
    expect(r.results.map(stateRec)).toEqual(['applied/', 'applied/', 'applied/', 'rejected/cap'])
    expect(state()?.acked.c4).toBeUndefined()
    // a known client is not "new" again, so it can go on
    expect(
      srv.ops(ROOM, [op('c1', 'trip.update', undefined, { notes: 'again' })]).results[0].status,
    ).toBe('applied')
    // the rejected one retries in the next batch
    seqs.c4 = 0
    expect(
      srv.ops(ROOM, [op('c4', 'trip.update', undefined, { notes: 'c4' })]).results[0].status,
    ).toBe('applied')
  })

  it('at most 200 clients per trip', () => {
    mk() // dev-a is the first
    for (let i = 1; i < 200; i++) run(`c${i}`, 'trip.update', undefined, { notes: `${i}` })
    expect(Object.keys(state()?.acked ?? {})).toHaveLength(200)
    expect(stateRec(run('one-too-many', 'trip.update', undefined, { notes: 'x' }))).toBe(
      'rejected/cap',
    )
    expect(run('c1', 'trip.update', undefined, { notes: 'known' }).status).toBe('applied')
  })
})

describe('stamping', () => {
  beforeEach(mk)
  const iso = new Date(NOW).toISOString()

  it('create stamps created_by, updated_by and updated_at', () => {
    srv.ops(ROOM, [op('dev-a', 'todo.create', todoId(1), { title: 'a' })], 'user_ann')
    srv.ops(
      ROOM,
      [op('dev-a', 'booking.create', bookingId(1), { kind: 'car', title: 'c' })],
      'user_ann',
    )
    expect(state()?.todos[0]).toMatchObject({
      created_by: 'user_ann',
      updated_by: 'user_ann',
      updated_at: iso,
    })
    expect(state()?.bookings[0]).toMatchObject({
      created_by: 'user_ann',
      updated_by: 'user_ann',
      updated_at: iso,
    })
  })

  it('an applied update changes updated_by / updated_at but never created_by', () => {
    srv.ops(ROOM, [op('dev-a', 'todo.create', todoId(1), { title: 'a' })], 'user_ann')
    srv.nowMs = () => NOW + 60_000
    srv.ops(ROOM, [op('dev-a', 'todo.update', todoId(1), { title: 'b' }, NOW + 60_000)], 'user_bob')
    expect(state()?.todos[0]).toMatchObject({
      created_by: 'user_ann',
      updated_by: 'user_bob',
      updated_at: new Date(NOW + 60_000).toISOString(),
    })
  })

  it('a fully conflicted update leaves the stamp alone', () => {
    srv.ops(ROOM, [op('dev-a', 'todo.create', todoId(1), { title: 'a' }, NOW - 1000)], 'user_ann')
    srv.ops(ROOM, [op('dev-b', 'todo.update', todoId(1), { title: 'old' }, NOW - 9000)], 'user_bob')
    expect(state()?.todos[0].updated_by).toBe('user_ann')
  })

  it('omits what Go omits: no nulls, empty strings or empty lists on the wire', () => {
    const r = srv.ops(ROOM, [
      op('dev-a', 'todo.create', todoId(1), { title: 'a', notes: '', day: null, place: null }),
      op('dev-a', 'booking.create', bookingId(1), { kind: 'car', title: 'c', starts_at: null }),
    ])
    const json = JSON.stringify(r)
    expect(json).not.toContain('null')
    expect(json).not.toContain('""')
    const td = r.trips[0].todos?.[0] as Record<string, unknown>
    expect(Object.keys(td).sort()).toEqual(
      [
        'category',
        'created_by',
        'done',
        'order',
        'title',
        'todo_id',
        'updated_at',
        'updated_by',
        'v',
      ].sort(),
    )
    expect(r.trips[0]).not.toHaveProperty('deleted')
    expect(r.results[0]).toEqual({ op_id: r.results[0].op_id, status: 'applied' })
  })
})

describe('booking end_place', () => {
  const bk = () => state()?.bookings[0] as unknown as Record<string, unknown>
  beforeEach(mk)

  it('sets, derives end_tz from the arrival place, never start_tz, and ships in the delta', () => {
    const r = srv.ops(ROOM, [
      op(
        'dev-a',
        'booking.create',
        bookingId(1),
        {
          kind: 'flight',
          title: 'NH 105',
          place: place('Tokyo HND', 'Asia/Tokyo'),
          end_place: place('Lisbon LIS', 'Europe/Lisbon'),
        },
        NOW - 10,
      ),
    ])
    expect(r.results[0].status).toBe('applied')
    expect(bk().end_tz).toBe('Europe/Lisbon')
    expect(bk().start_tz).toBeUndefined()
    expect(state()?.child_at[bookingId(1)].end_place).toBe(NOW - 10)
    expect((r.trips[0].bookings?.[0] as unknown as Record<string, unknown>).end_place).toBeDefined()
  })

  it('an explicit end_tz in the same patch wins; a place without tz leaves end_tz alone', () => {
    run(
      'dev-a',
      'booking.create',
      bookingId(1),
      { kind: 'flight', title: 'x', end_place: place('A', 'Europe/Lisbon') },
      NOW - 40,
    )
    run(
      'dev-a',
      'booking.update',
      bookingId(1),
      { end_place: place('B', 'Europe/Lisbon'), end_tz: 'Europe/London' },
      NOW - 30,
    )
    expect(bk().end_tz).toBe('Europe/London')
    run('dev-a', 'booking.update', bookingId(1), { end_place: place('C') }, NOW - 20)
    expect(bk().end_tz).toBe('Europe/London')
  })

  it('null clears only end_place', () => {
    run(
      'dev-a',
      'booking.create',
      bookingId(1),
      { kind: 'car', title: 'x', place: place('A'), end_place: place('B') },
      NOW - 40,
    )
    run('dev-a', 'booking.update', bookingId(1), { end_place: null }, NOW - 30)
    expect(bk().end_place).toBeUndefined()
    expect(bk().place).toBeDefined()
  })

  it('has its own clock, strict nested decoding and place validation', () => {
    run(
      'dev-a',
      'booking.create',
      bookingId(1),
      { kind: 'train', title: 'x', end_place: place('A') },
      NOW - 100,
    )
    const lost = run('dev-b', 'booking.update', bookingId(1), { end_place: place('B') }, NOW - 500)
    expect(lost).toMatchObject({ status: 'conflicted', skipped_fields: ['end_place'] })
    expect((bk().end_place as { name: string }).name).toBe('A')
    const upd = (p: unknown) =>
      stateRec(run('dev-a', 'booking.update', bookingId(1), { end_place: p }, NOW - 10))
    expect(upd({ ...place('C'), from_the_future: 1 })).toBe('rejected/unsupported')
    expect(upd({ ...place('C'), lat: 123 })).toBe('rejected/invalid')
    expect(upd({ ...place('C'), locality: 'x'.repeat(121) })).toBe('rejected/invalid')
  })
})

describe('sync', () => {
  it('answers deltas, soft-deleted removals for known trips and purged ids', () => {
    mk()
    expect(srv.sync(ROOM, {}).trips[0]).toMatchObject({
      trip_id: TRIP,
      full: true,
      base_version: 0,
    })
    expect(srv.sync(ROOM, { [TRIP]: 1 }).trips).toEqual([])
    run('dev-a', 'trip.delete', undefined, undefined)
    expect(srv.sync(ROOM, {}).removed).toEqual([])
    const known = srv.sync(ROOM, { [TRIP]: 1, trip_gone: 3 })
    expect(known.removed).toEqual(
      [
        { trip_id: TRIP, deleted_by: 'user_me' },
        { trip_id: 'trip_gone', purged: true },
      ].sort((a, b) => (a.trip_id < b.trip_id ? -1 : 1)),
    )
    expect(known.trips).toEqual([])
  })
})

describe('Google places (backend models.Place rules)', () => {
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
  const DAY = 24 * 60 * 60 * 1000
  const google = (extra: Record<string, unknown> = {}) => ({
    source: 'google',
    place_id: 'ChIJabc',
    lat: 38.7,
    lng: -9.1,
    coords_fetched_at: iso(DAY),
    ...extra,
  })
  const todo = (n: number, patch: Record<string, unknown>) =>
    run('dev-a', 'todo.create', todoId(n), patch)

  beforeEach(() => {
    mk()
  })

  it('stores a google place with its id, coordinates and fetch time, and a blank title', () => {
    expect(stateRec(todo(2, { title: '', place: google() }))).toBe('applied/')
    expect(state()?.todos[0].place?.place_id).toBe('ChIJabc')
    expect(state()?.todos[0].title).toBe('')
  })

  it('rejects a name or an address on a google place (Google content is never stored)', () => {
    expect(stateRec(todo(2, { title: 'x', place: google({ name: 'Sé' }) }))).toBe(
      'rejected/invalid',
    )
    expect(stateRec(todo(3, { title: 'x', place: google({ address: 'Rua 1' }) }))).toBe(
      'rejected/invalid',
    )
  })

  it('needs a place_id, and rejects osm_ref and the photon source as gone', () => {
    expect(stateRec(todo(2, { title: 'x', place: google({ place_id: '' }) }))).toBe(
      'rejected/invalid',
    )
    expect(stateRec(todo(3, { title: 'x', place: google({ osm_ref: 'n1' }) }))).toBe(
      'rejected/unsupported',
    )
    expect(stateRec(todo(4, { title: 'x', place: google({ source: 'pin' }) }))).toBe(
      'rejected/invalid',
    )
  })

  it('keeps coordinates at most 30 days, and needs coords_fetched_at with them', () => {
    expect(
      stateRec(todo(2, { title: 'x', place: google({ coords_fetched_at: iso(31 * DAY) }) })),
    ).toBe('rejected/invalid')
    expect(stateRec(todo(3, { title: 'x', place: google({ coords_fetched_at: undefined }) }))).toBe(
      'rejected/invalid',
    )
    // The server clock may be a little behind the client's, but not by hours.
    expect(
      stateRec(
        todo(4, { title: 'x', place: google({ coords_fetched_at: iso(-2 * 60 * 60 * 1000) }) }),
      ),
    ).toBe('rejected/invalid')
  })

  it('accepts a purged place (id only), but not a fetch time without coordinates', () => {
    expect(stateRec(todo(2, { title: '', place: { source: 'google', place_id: 'ChIJabc' } }))).toBe(
      'applied/',
    )
    expect(
      stateRec(
        todo(3, {
          title: '',
          place: { source: 'google', place_id: 'x', coords_fetched_at: iso(DAY) },
        }),
      ),
    ).toBe('rejected/invalid')
  })

  it('allows a blank title only with a google place', () => {
    expect(stateRec(todo(2, { title: '   ' }))).toBe('rejected/invalid')
    expect(stateRec(todo(3, { title: '', place: place('Cafe') }))).toBe('rejected/invalid')
    expect(stateRec(todo(4, { title: 'x' }))).toBe('applied/')
    // Clearing the title of a todo that has no google place is rejected too.
    expect(stateRec(run('dev-a', 'todo.update', todoId(4), { title: '' }))).toBe('rejected/invalid')
    expect(stateRec(run('dev-a', 'todo.update', todoId(4), { title: '', place: google() }))).toBe(
      'applied/',
    )
  })

  it('keeps pin and manual places as user content: a name and coordinates, no place_id', () => {
    expect(stateRec(todo(2, { title: 'x', place: place('Dropped') }))).toBe('applied/')
    expect(
      stateRec(todo(3, { title: 'x', place: { ...place('Dropped'), place_id: 'ChIJ' } })),
    ).toBe('rejected/invalid')
    expect(stateRec(todo(4, { title: 'x', place: { source: 'pin', lat: 1, lng: 2 } }))).toBe(
      'rejected/invalid',
    )
  })

  it('validates trip stops and booking places the same way', () => {
    expect(stateRec(run('dev-a', 'trip.update', undefined, { stops: [google()] }))).toBe('applied/')
    expect(
      stateRec(run('dev-a', 'trip.update', undefined, { stops: [google({ name: 'x' })] })),
    ).toBe('rejected/invalid')
    expect(
      stateRec(
        run('dev-a', 'booking.create', bookingId(2), {
          kind: 'flight',
          title: 'F',
          place: google(),
          end_place: google({ place_id: 'B' }),
        }),
      ),
    ).toBe('applied/')
  })

  it('has no places endpoints any more', () => {
    expect((srv as unknown as Record<string, unknown>).searchPlaces).toBeUndefined()
    expect((srv as unknown as Record<string, unknown>).reverse).toBeUndefined()
  })
})

describe('/me', () => {
  it('PUT answers 204 and changes only what was sent', () => {
    expect(srv.putMe({ preferences: { trips_show_next_stop: false } })).toEqual({ status: 204 })
    expect(srv.getMe().preferences).toEqual({ trips_show_next_stop: false })
    expect(srv.getMe().name).toBe('Jan')
    expect(srv.putMe({ name: 'Janet' })).toEqual({ status: 204 })
    expect(srv.getMe()).toMatchObject({
      name: 'Janet',
      preferences: { trips_show_next_stop: false },
    })
  })

  it.each([
    ['empty body', {}],
    ['empty preferences', { preferences: {} }],
    ['null preference only', { preferences: { trips_show_next_stop: null } }],
    ['unknown key', { nickname: 'x' }],
    ['unknown preference key', { preferences: { trips_show_next_stop: true, theme: 'dark' } }],
    ['empty name', { name: '' }],
    ['wrong type', { preferences: { trips_show_next_stop: 'yes' } }],
    ['not an object', []],
  ])('400: %s', (_n, body) => {
    const r = srv.putMe(body)
    expect(r.status).toBe(400)
    expect(srv.getMe().preferences.trips_show_next_stop).toBe(true)
  })

  it('GET /me always carries a concrete bool; members_meta entries carry user_id', () => {
    expect(typeof srv.getMe().preferences.trips_show_next_stop).toBe('boolean')
    srv.members = [{ user_id: 'user_jan', name: 'Jan', avatar_key: 'jan' }]
    expect(srv.membersMeta()).toEqual([{ user_id: 'user_jan', name: 'Jan', avatar_key: 'jan' }])
  })
})
