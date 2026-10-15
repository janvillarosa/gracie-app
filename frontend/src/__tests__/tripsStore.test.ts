import { describe, expect, it, vi } from 'vitest'
import type { OpsResponse, SyncResponse, TripOp } from '../api/tripTypes'
import { IdbTripDB, MemoryTripDB } from '../lib/trips/db'
import { applyOpLocal, mergeDelta, newId, renderTrip } from '../lib/trips/replay'
import { TripStore, type TripApi } from '../lib/trips/store'
import { MockTripServer } from '../mocks/tripsServer'

const ROOM = 'room_1'
const ME = 'user_me'

const direct = (srv: MockTripServer): TripApi => ({
  sync: async (_r, known) => srv.sync(ROOM, known),
  ops: async (_r, ops) => srv.ops(ROOM, ops),
})

// An api that fails until switched on, so tests can queue several ops before they flush.
const gated = (srv: MockTripServer, inner: Partial<TripApi> = {}) => {
  const g = { online: false }
  const api: TripApi = {
    sync: async (r, k) =>
      g.online ? (inner.sync ?? direct(srv).sync)(r, k) : Promise.reject(new Error('offline')),
    ops: async (r, o) =>
      g.online ? (inner.ops ?? direct(srv).ops)(r, o) : Promise.reject(new Error('offline')),
  }
  return { g, api }
}

const make = (srv: MockTripServer, api: TripApi = direct(srv), db = new MemoryTripDB()) => {
  const store = new TripStore({ roomId: ROOM, userId: ME, api, db })
  return { store, db }
}

describe('ids', () => {
  it('uses the contract prefixes and 32 hex characters', () => {
    expect(newId('trip')).toMatch(/^trip_[0-9a-f]{32}$/)
    expect(newId('ttd')).toMatch(/^ttd_[0-9a-f]{32}$/)
    expect(newId('tbk')).toMatch(/^tbk_[0-9a-f]{32}$/)
  })
})

describe('replay', () => {
  it('applies todo ops optimistically and merges day labels', () => {
    const op = (
      type: TripOp['type'],
      entity: string | undefined,
      patch?: Record<string, unknown>,
    ): TripOp => ({
      v: 1,
      op_id: 'o',
      client_id: 'c',
      seq: 1,
      at: 1,
      type,
      trip_id: 'trip_a',
      entity_id: entity,
      patch,
    })
    let t = applyOpLocal(
      undefined,
      op('trip.create', undefined, { title: 'Lisbon', tz: 'Europe/Lisbon' }),
      ME,
      'now',
    )
    t = applyOpLocal(
      t,
      op('todo.create', 'ttd_1', { title: 'Pena', day: '2026-10-24', order: 1 }),
      ME,
      'now',
    )
    t = applyOpLocal(t, op('todo.update', 'ttd_1', { done: true }), ME, 'now')
    t = applyOpLocal(
      t,
      op('trip.update', undefined, { days: { '2026-10-24': 'Sintra' } }),
      ME,
      'now',
    )
    t = applyOpLocal(t, op('trip.update', undefined, { days: { '2026-10-24': '' } }), ME, 'now')
    expect(t?.todos[0]).toMatchObject({
      title: 'Pena',
      done: true,
      done_by: ME,
      tz: 'Europe/Lisbon',
    })
    expect(t?.days).toEqual({})
    t = applyOpLocal(t, op('todo.delete', 'ttd_1'), ME, 'now')
    expect(t?.todos).toHaveLength(0)
  })

  it('merges a delta over a snapshot and removes tombstoned ids', () => {
    const base = mergeDelta(undefined, {
      trip_id: 'trip_a',
      full: true,
      base_version: 0,
      version: 3,
      trip: { title: 'A' },
      todos: [{ todo_id: 'ttd_1', title: 'x', done: false, order: 1, category: 'food' }],
    })
    const next = mergeDelta(base, {
      trip_id: 'trip_a',
      full: false,
      base_version: 3,
      version: 4,
      removed_ids: ['ttd_1'],
    })
    expect(next.version).toBe(4)
    expect(next.todos).toHaveLength(0)
    expect(renderTrip(next, [], ME, 'now')?.title).toBe('A')
  })
})

describe('TripStore', () => {
  it('shows a new trip instantly, then settles when the server acks', async () => {
    const srv = new MockTripServer()
    const { store } = make(srv)
    await store.hydrate()
    const id = store.createTrip({ title: 'Lisbon', tz: 'Europe/Lisbon' })
    expect(store.getState().trips[id].title).toBe('Lisbon')
    expect(store.getState().pending).toBe(1)
    await store.flush()
    expect(store.getState().pending).toBe(0)
    expect(srv.trips.has(id)).toBe(true)
    expect(store.getState().trips[id].version).toBe(1)
  })

  it('keeps editing while offline and flushes in seq order once back', async () => {
    const srv = new MockTripServer()
    let online = false
    const api: TripApi = {
      sync: async (_r, k) => (online ? srv.sync(ROOM, k) : Promise.reject(new Error('offline'))),
      ops: async (_r, o) => (online ? srv.ops(ROOM, o) : Promise.reject(new Error('offline'))),
    }
    const { store } = make(srv, api)
    await store.hydrate()
    const id = store.createTrip({ title: 'Trip' })
    const todo = store.createTodo(id, { title: 'Museum', day: '2026-10-24', order: 1 })
    store.updateTodo(id, todo, { done: true })
    await store.flush()
    expect(store.getState().offline).toBe(true)
    expect(store.getState().pending).toBe(3)
    expect(store.getState().trips[id].todos[0].done).toBe(true)
    online = true
    await store.flush()
    expect(store.getState().offline).toBe(false)
    expect(store.getState().pending).toBe(0)
    expect(srv.trips.get(id)?.todos[0].done).toBe(true)
  })

  it('persists the outbox and seq counter across restarts', async () => {
    const srv = new MockTripServer()
    const offline: TripApi = {
      sync: () => Promise.reject(new Error('x')),
      ops: () => Promise.reject(new Error('x')),
    }
    const db = new MemoryTripDB()
    const a = make(srv, offline, db).store
    await a.hydrate()
    const id = a.createTrip({ title: 'Saved' })
    a.createTodo(id, { title: 'One', order: 1 })
    await a.flush()
    const b = make(srv, direct(srv), db).store
    await b.hydrate()
    expect(b.getState().pending).toBe(2)
    expect(b.getState().trips[id].todos).toHaveLength(1)
    const op = b.enqueue('trip.update', id, undefined, { notes: 'n' })
    await b.settle()
    expect(op.seq).toBe(3)
    await b.flush()
    expect(srv.trips.get(id)?.todos).toHaveLength(1)
  })

  it('reverts a rejected change and says why', async () => {
    const srv = new MockTripServer()
    const { store } = make(srv)
    await store.hydrate()
    const id = store.createTrip({ title: 'T' })
    const todo = store.createTodo(id, { title: 'Idea', order: 1 })
    await store.flush()
    // A housemate deletes it; this device edits it offline afterwards.
    srv.ops(ROOM, [
      {
        v: 1,
        op_id: 'x',
        client_id: 'other',
        seq: 1,
        at: Date.now(),
        type: 'todo.delete',
        trip_id: id,
        entity_id: todo,
      },
    ])
    store.updateTodo(id, todo, { title: 'Renamed' })
    await store.flush()
    expect(store.getState().pending).toBe(0)
    expect(store.getState().trips[id].todos).toHaveLength(0)
    expect(store.getState().toasts.map((t) => t.text)).toContain('This item was deleted.')
  })

  it('drops unsupported ops and reverts them', async () => {
    const srv = new MockTripServer()
    const { store } = make(srv)
    await store.hydrate()
    const id = store.createTrip({ title: 'T' })
    await store.flush()
    store.enqueue('trip.update', id, undefined, { colour: 'red' })
    expect(store.getState().trips[id]).toMatchObject({ colour: 'red' })
    await store.flush()
    expect(store.getState().pending).toBe(0)
    expect(store.getState().trips[id]).not.toHaveProperty('colour')
    expect(store.getState().toasts[0].text).toMatch(/doesn’t support/)
  })

  it('reports a cap rejection', async () => {
    const srv = new MockTripServer()
    const { store } = make(srv)
    await store.hydrate()
    const id = store.createTrip({ title: 'Full' })
    for (let i = 0; i < 151; i++) store.createTodo(id, { title: `t${i}`, order: i })
    await store.flush()
    expect(srv.trips.get(id)?.todos).toHaveLength(150)
    expect(store.getState().trips[id].todos).toHaveLength(150)
    expect(store.getState().toasts[0].text).toMatch(/trip is full/)
  })

  it('turns a conflicted op into a row note and keeps the other fields', async () => {
    const srv = new MockTripServer()
    const { g, api } = gated(srv)
    const { store } = make(srv, api)
    await store.hydrate()
    g.online = true
    const id = store.createTrip({ title: 'T' })
    const todo = store.createTodo(id, { title: 'Dinner', order: 1 })
    await store.flush()
    g.online = false
    // Offline edit made at t0; a housemate edits the same field afterwards.
    const offlineAt = srv.nowMs() - 60_000
    store.updateTodo(id, todo, { title: 'Dinner at 8', notes: 'book' })
    store['outbox'][0].at = offlineAt // an edit made a minute ago on this device
    srv.housemateUpdateTodo(id, todo, { title: 'Dinner at Mia’s' })
    g.online = true
    await store.flush()
    const note = store.getState().notes[todo]
    expect(note.fields).toEqual(['title'])
    const t = store.getState().trips[id].todos[0]
    expect(t.title).toBe('Dinner at Mia’s')
    expect(t.notes).toBe('book')
    store.dismissNote(todo)
    expect(store.getState().notes[todo]).toBeUndefined()
  })

  it('keeps retry ops in the outbox, drops the applied ones and resends only the retry', async () => {
    const srv = new MockTripServer()
    const calls: number[][] = []
    const api: TripApi = {
      sync: async (_r, k) => srv.sync(ROOM, k),
      ops: async (_r, ops) => {
        calls.push(ops.map((o) => o.seq))
        if (calls.length === 1)
          return {
            server_time: Date.now(),
            trips: [],
            results: ops.map((o, i) => ({ op_id: o.op_id, status: i === 0 ? 'retry' : 'applied' })),
          } as OpsResponse
        return srv.ops(ROOM, ops)
      },
    }
    const { store } = make(srv, api)
    await store.hydrate()
    const id = store.createTrip({ title: 'T' })
    store.updateTrip(id, { notes: 'x' })
    await store.flush()
    expect(store.getState().pending).toBe(1)
    await store.flush()
    expect(store.getState().pending).toBe(0)
    expect(calls[1]).toEqual([1])
  })

  it('treats a duplicate result as done and corrects the clock from server_time', async () => {
    const srv = new MockTripServer()
    const { store } = make(srv)
    await store.hydrate()
    const id = store.createTrip({ title: 'T' })
    const first = { ...store['outbox'][0] }
    await store.flush()
    // The response was lost: the same op is sent again.
    const again = srv.ops(ROOM, [first])
    expect(again.results[0].status).toBe('duplicate')
    expect(srv.trips.get(id)?.version).toBe(1)
    srv.nowMs = () => Date.now() + 5000
    await store.flush()
    expect(Math.abs(store.clock() - (Date.now() + 5000))).toBeLessThan(500)
  })

  it('halves the batch when the server answers 400 and drops a poison op', async () => {
    const srv = new MockTripServer()
    const sizes: number[] = []
    const api: TripApi = {
      sync: async (_r, k) => srv.sync(ROOM, k),
      ops: async (_r, ops) => {
        sizes.push(ops.length)
        if (ops.length > 1 || ops[0].patch?.title === 'poison') {
          throw Object.assign(new Error('bad'), { status: 400 })
        }
        return srv.ops(ROOM, ops)
      },
    }
    const { g, api: gate } = gated(srv, { ops: api.ops })
    const { store } = make(srv, gate)
    await store.hydrate()
    const id = store.createTrip({ title: 'ok' })
    store.updateTrip(id, { title: 'poison' })
    await store.flush()
    g.online = true
    await store.flush()
    expect(sizes[0]).toBe(2)
    expect(store.getState().pending).toBe(0)
    expect(store.getState().toasts[0].text).toMatch(/couldn’t be saved/)
    expect(srv.trips.get(id)?.fields.title).toBe('ok')
  })

  it('marks a trip another member deleted and restores it', async () => {
    const srv = new MockTripServer()
    const { store } = make(srv)
    await store.hydrate()
    const id = store.createTrip({ title: 'T' })
    await store.flush()
    srv.ops(ROOM, [
      {
        v: 1,
        op_id: 'd',
        client_id: 'other',
        seq: 1,
        at: Date.now(),
        type: 'trip.delete',
        trip_id: id,
      },
    ])
    await store.flush()
    expect(store.getState().trips[id].deleted).toBeTruthy()
    store.restoreTrip(id)
    expect(store.getState().trips[id].deleted).toBeFalsy()
    await store.flush()
    expect(srv.trips.get(id)?.deleted_by).toBeUndefined()
  })

  it('drops purged trips and their pending ops', async () => {
    const srv = new MockTripServer()
    const { store } = make(srv)
    await store.hydrate()
    const id = store.createTrip({ title: 'T' })
    await store.flush()
    srv.trips.delete(id)
    const sync: SyncResponse = srv.sync(ROOM, { [id]: 1 })
    expect(sync.removed).toEqual([{ trip_id: id, purged: true }])
    await store.flush()
    expect(store.getState().trips[id]).toBeUndefined()
  })

  it('keeps the outbox and tells its owner when the house answers 403', async () => {
    const srv = new MockTripServer()
    let forbidden = 0
    const api: TripApi = {
      sync: async (_r, k) => srv.sync(ROOM, k),
      ops: async () => {
        throw Object.assign(new Error('forbidden'), { status: 403 })
      },
    }
    const store = new TripStore({
      roomId: ROOM,
      userId: ME,
      api,
      db: new MemoryTripDB(),
      onForbidden: () => forbidden++,
    })
    await store.hydrate()
    store.createTrip({ title: 'Kept' })
    await store.flush()
    expect(forbidden).toBeGreaterThan(0)
    expect(store.getState().pending).toBe(1)
  })

  it('refetches a trip whole when a delta does not start at our version', async () => {
    const srv = new MockTripServer()
    const knownSeen: Array<Record<string, number>> = []
    const api: TripApi = {
      sync: async (_r, k) => {
        knownSeen.push({ ...k })
        return srv.sync(ROOM, k)
      },
      ops: async (_r, ops) => {
        const r = srv.ops(ROOM, ops)
        // Pretend a housemate wrote in between: the delta starts at a different version.
        return { ...r, trips: r.trips.map((d) => ({ ...d, full: false, base_version: 99 })) }
      },
    }
    const { store } = make(srv, api)
    await store.hydrate()
    const id = store.createTrip({ title: 'Whole' })
    await store.flush()
    expect(knownSeen.some((k) => !(id in k))).toBe(true)
    expect(store.getState().trips[id].title).toBe('Whole')
    expect(store.getState().trips[id].version).toBe(1)
  })
})

describe('one device, many tabs', () => {
  const quiet: TripApi = {
    sync: () => Promise.reject(new Error('offline')),
    ops: () => Promise.reject(new Error('offline')),
  }

  it('shares one client id between tabs and never reuses a seq', async () => {
    const srv = new MockTripServer()
    const name = `tabs_${Math.random().toString(16).slice(2)}`
    const dbA = new IdbTripDB(name)
    const dbB = new IdbTripDB(name)
    const a = new TripStore({ roomId: ROOM, userId: ME, api: quiet, db: dbA })
    const b = new TripStore({ roomId: ROOM, userId: ME, api: quiet, db: dbB })
    await Promise.all([a.hydrate(), b.hydrate()])
    const id = a.createTrip({ title: 'Shared' })
    const ops = [
      a.enqueue('trip.update', id, undefined, { notes: 'from a' }),
      b.enqueue('trip.update', id, undefined, { notes: 'from b' }),
      a.enqueue('trip.update', id, undefined, { notes: 'a again' }),
      b.enqueue('trip.update', id, undefined, { notes: 'b again' }),
    ]
    await Promise.all([a.settle(), b.settle()])
    expect(new Set(ops.map((o) => o.client_id)).size).toBe(1)
    expect(ops[0].client_id).toMatch(/^dev_/)
    expect(new Set(ops.map((o) => o.seq)).size).toBe(4)
    // Either tab can send everything, in seq order: nothing is dropped as a duplicate.
    const sender = new TripStore({
      roomId: ROOM,
      userId: ME,
      api: direct(srv),
      db: new IdbTripDB(name),
    })
    await sender.hydrate()
    await sender.flush()
    expect(sender.getState().pending).toBe(0)
    expect(srv.trips.get(id)?.fields.title).toBe('Shared')
    await Promise.all([a.dispose(), b.dispose(), sender.dispose()])
    await new IdbTripDB(name).destroy()
  })

  it('a second tab does not lose its ops when the first has already sent them', async () => {
    const srv = new MockTripServer()
    const db = new MemoryTripDB()
    const a = new TripStore({ roomId: ROOM, userId: ME, api: quiet, db })
    await a.hydrate()
    const id = a.createTrip({ title: 'T' })
    await a.flush()
    const b = new TripStore({ roomId: ROOM, userId: ME, api: direct(srv), db })
    await b.hydrate()
    expect(b.getState().pending).toBe(1)
    await b.flush()
    expect(srv.trips.get(id)).toBeDefined()
    // The first tab still holds the op in memory; sending it again is a duplicate, then gone.
    a.setApi(direct(srv))
    await a.flush()
    expect(a.getState().pending).toBe(0)
  })
})

describe('when the device cannot keep our changes', () => {
  class BrokenDB extends MemoryTripDB {
    async appendOp(): Promise<TripOp> {
      throw new Error('QuotaExceededError')
    }
  }

  it('still syncs them under a new client id, and says they are not saved here', async () => {
    const srv = new MockTripServer()
    const { g, api } = gated(srv)
    const store = new TripStore({ roomId: ROOM, userId: ME, api, db: new BrokenDB() })
    await store.hydrate()
    const id = store.createTrip({ title: 'Kept in memory' })
    const second = store.enqueue('trip.update', id, undefined, { notes: 'n' })
    await store.flush()
    expect(store.getState().persistFailed).toBe(true)
    // A reload from the (empty) database never drops what only this tab has.
    expect(store.getState().pending).toBe(2)
    expect(second.client_id).toMatch(/^dev_/)
    expect(second.seq).toBe(2)
    g.online = true
    await store.flush()
    expect(store.getState().pending).toBe(0)
    expect(srv.trips.get(id)?.fields.notes).toBe('n')
  })

  it('opens again after a failed open instead of staying broken', async () => {
    const db = new IdbTripDB('reopen')
    const proto = indexedDB.open.bind(indexedDB)
    let fail = true
    const spy = vi.spyOn(indexedDB, 'open').mockImplementation((n, v) => {
      if (fail) {
        fail = false
        const r = {} as IDBOpenDBRequest
        setTimeout(() => {
          Object.defineProperty(r, 'error', { value: new Error('denied') })
          r.onerror?.(new Event('error'))
        })
        return r
      }
      return proto(n, v)
    })
    await expect(db.load('r')).rejects.toBeDefined()
    await expect(db.load('r')).resolves.toBeDefined()
    spy.mockRestore()
    await db.destroy()
  })
})

describe('signing in again', () => {
  it('treats a refused key as sign-in, not as offline, and goes on with the new key', async () => {
    const srv = new MockTripServer()
    let refused = 0
    const bad: TripApi = {
      sync: () => Promise.reject(Object.assign(new Error('unauthorized'), { status: 401 })),
      ops: () => Promise.reject(Object.assign(new Error('unauthorized'), { status: 401 })),
    }
    const store = new TripStore({
      roomId: ROOM,
      userId: ME,
      api: bad,
      db: new MemoryTripDB(),
      onUnauthorized: () => refused++,
    })
    store.start()
    await store.hydrate()
    const id = store.createTrip({ title: 'Before' })
    await store.flush()
    expect(refused).toBeGreaterThan(0)
    expect(store.getState().offline).toBe(false)
    expect(store.getState().pending).toBe(1)
    // The new key is used from the next call; the queued change goes out.
    store.setApi(direct(srv))
    await store.flush()
    expect(store.getState().pending).toBe(0)
    expect(srv.trips.get(id)?.fields.title).toBe('Before')
    store.stop()
    await store.dispose()
  })
})

describe('conflict notes', () => {
  const titleConflicts = (srv: MockTripServer): TripApi => ({
    sync: async (_r, k) => srv.sync(ROOM, k),
    ops: async (_r, ops) => {
      const real = srv.ops(ROOM, ops)
      const titled = new Set(
        ops
          .filter((o) => o.patch && 'title' in o.patch && o.type.endsWith('update'))
          .map((o) => o.op_id),
      )
      return {
        ...real,
        results: real.results.map((r) =>
          titled.has(r.op_id)
            ? { ...r, status: 'conflicted' as const, skipped_fields: ['title'] }
            : r,
        ),
      }
    },
  })

  it('keeps a trip-level and a booking-level note, each with its kind, and expires them', async () => {
    const srv = new MockTripServer()
    let t = 1_000_000
    const store = new TripStore({
      roomId: ROOM,
      userId: ME,
      api: titleConflicts(srv),
      db: new MemoryTripDB(),
      now: () => t,
    })
    await store.hydrate()
    const id = store.createTrip({ title: 'Trip' })
    const bk = store.createBooking(id, { kind: 'train', title: 'Train' })
    await store.flush()
    store.updateTrip(id, { title: 'Renamed' })
    store.updateBooking(id, bk, { title: 'Renamed train' })
    await store.flush()
    const notes = store.getState().notes
    expect(notes[id]).toMatchObject({ kind: 'trip', tripId: id, fields: ['title'] })
    expect(notes[bk]).toMatchObject({ kind: 'booking', tripId: id })
    // Notes expire after a day (the next change to the store drops them).
    t += 25 * 3600 * 1000
    store.updateTrip(id, { notes: 'x' })
    expect(store.getState().notes).toEqual({})
    await store.dispose()
  })

  it('forgets a note when the trip changes again', async () => {
    const srv = new MockTripServer()
    const store = new TripStore({
      roomId: ROOM,
      userId: ME,
      api: titleConflicts(srv),
      db: new MemoryTripDB(),
    })
    await store.hydrate()
    const id = store.createTrip({ title: 'Trip' })
    await store.flush()
    store.updateTrip(id, { title: 'Mine' })
    await store.flush()
    expect(store.getState().notes[id]).toBeDefined()
    // A housemate edits the trip: the next sync delivers a delta for it.
    srv.ops(ROOM, [
      {
        v: 1,
        op_id: 'x',
        client_id: 'other',
        seq: 1,
        at: Date.now() + 10_000,
        type: 'trip.update',
        trip_id: id,
        patch: { notes: 'theirs' },
      },
    ])
    await store.flush()
    expect(store.getState().notes[id]).toBeUndefined()
    await store.dispose()
  })
})

describe('before the first load, retries and disposal', () => {
  it('holds ops made before the load finished, and keeps their order', async () => {
    const srv = new MockTripServer()
    const store = new TripStore({
      roomId: ROOM,
      userId: ME,
      api: direct(srv),
      db: new MemoryTripDB(),
    })
    // No hydrate() yet.
    const id = store.createTrip({ title: 'Early' })
    store.updateTrip(id, { notes: 'later' })
    await store.hydrate()
    await store.flush()
    expect(store.getState().pending).toBe(0)
    expect(srv.trips.get(id)?.fields).toMatchObject({ title: 'Early', notes: 'later' })
    await store.dispose()
  })

  it('still pulls after a partial retry, without calling it offline', async () => {
    const srv = new MockTripServer()
    let pulls = 0
    const api: TripApi = {
      sync: async (_r, k) => {
        pulls++
        return srv.sync(ROOM, k)
      },
      ops: async (_r, ops) => ({
        server_time: Date.now(),
        results: ops.map((o) => ({ op_id: o.op_id, status: 'retry' as const })),
        trips: [],
      }),
    }
    const store = new TripStore({ roomId: ROOM, userId: ME, api, db: new MemoryTripDB() })
    await store.hydrate()
    store.createTrip({ title: 'Busy' })
    await store.flush()
    expect(pulls).toBeGreaterThan(0)
    expect(store.getState().offline).toBe(false)
    expect(store.getState().pending).toBe(1)
    await store.dispose()
  })

  it('ignores results that arrive after it was disposed', async () => {
    const srv = new MockTripServer()
    let release: () => void = () => {}
    const api: TripApi = {
      sync: async (_r, k) => srv.sync(ROOM, k),
      ops: (_r, ops) =>
        new Promise((resolve) => {
          release = () => resolve(srv.ops(ROOM, ops))
        }),
    }
    const db = new MemoryTripDB()
    const store = new TripStore({ roomId: ROOM, userId: ME, api, db })
    await store.hydrate()
    store.createTrip({ title: 'Late' })
    await store.settle()
    const run = store.flush()
    await new Promise((r) => setTimeout(r, 10))
    const gone = store.dispose()
    release()
    await Promise.all([run, gone])
    // The late answer wrote nothing: the op is still in the database for the next session.
    expect((await db.load(ROOM)).outbox).toHaveLength(1)
  })
})
