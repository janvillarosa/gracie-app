import { describe, expect, it } from 'vitest'
import type { OpsResponse, TripOp } from '../api/tripTypes'
import { IdbTripDB, MemoryTripDB, type DraftOp } from '../lib/trips/db'
import { TripStore, type TripApi } from '../lib/trips/store'
import { MockTripServer } from '../mocks/tripsServer'

const ROOM = 'room_1'
const ME = 'user_me'
const uniq = (p: string) => `${p}_${Math.random().toString(16).slice(2)}`

const direct = (srv: MockTripServer, room = ROOM): TripApi => ({
  sync: async (_r, known) => srv.sync(room, known),
  ops: async (_r, ops) => srv.ops(room, ops),
})

describe('N2: a lower seq never goes out after a higher one', () => {
  it('sends ops two tabs queue while one is flushing, in seq order', async () => {
    const srv = new MockTripServer()
    const name = uniq('n2')
    let tabB: TripStore | null = null
    let tabA: TripStore | null = null
    let id = ''
    let calls = 0
    const sent: number[] = []
    const apiA: TripApi = {
      sync: direct(srv).sync,
      ops: async (r, ops) => {
        calls++
        sent.push(...ops.map((o) => o.seq))
        const resp = await direct(srv).ops(r, ops)
        if (calls === 1) {
          // Tab B queues the lower seq, then tab A (which is flushing) queues the higher one.
          tabB?.updateTrip(id, { destination: 'from B' })
          await tabB?.settle()
          tabA?.updateTrip(id, { notes: 'from A' })
          await tabA?.settle()
        }
        return resp
      },
    }
    const a = new TripStore({ roomId: ROOM, userId: ME, api: apiA, db: new IdbTripDB(name) })
    // Tab B waits its turn behind A's flush lock; here it is simply unable to send.
    const offline: TripApi = {
      sync: () => Promise.reject(new Error('offline')),
      ops: () => Promise.reject(new Error('offline')),
    }
    const b = new TripStore({ roomId: ROOM, userId: ME, api: offline, db: new IdbTripDB(name) })
    tabA = a
    tabB = b
    await Promise.all([a.hydrate(), b.hydrate()])
    id = a.createTrip({ title: 'T' })
    await a.flush()
    const t = srv.trips.get(id)
    expect(t?.fields.destination).toBe('from B')
    expect(t?.fields.notes).toBe('from A')
    expect(sent).toEqual([...sent].sort((x, y) => x - y))
    expect(a.getState().pending).toBe(0)
    b.setApi(direct(srv))
    await b.flush()
    expect(b.getState().pending).toBe(0)
    await Promise.all([a.dispose(), b.dispose()])
    await new IdbTripDB(name).destroy()
  })
})

describe('N5: only stamped ops are sent', () => {
  class SlowStampDB extends MemoryTripDB {
    release: (() => void) | null = null
    hold = false
    async appendOp(op: DraftOp, roomId: string) {
      if (this.hold) await new Promise<void>((res) => (this.release = res))
      return super.appendOp(op, roomId)
    }
  }

  it('does not send an op the database has not stamped yet', async () => {
    const srv = new MockTripServer()
    const db = new SlowStampDB()
    const seen: TripOp[] = []
    let first = true
    let id = ''
    const api: TripApi = {
      sync: direct(srv).sync,
      ops: async (r, ops): Promise<OpsResponse> => {
        seen.push(...ops.map((o) => ({ ...o })))
        const resp = await direct(srv).ops(r, ops)
        if (first) {
          first = false
          db.hold = true
          store.updateTrip(id, { notes: 'late' })
          // The stamp lands only after the sender had its chance to go ahead without it.
          setTimeout(() => {
            db.hold = false
            db.release?.()
          }, 0)
        }
        return resp
      },
    }
    const store = new TripStore({ roomId: ROOM, userId: ME, api, db })
    await store.hydrate()
    id = store.createTrip({ title: 'T' })
    await store.flush()
    await store.flush()
    expect(seen.every((o) => o.seq > 0 && o.client_id !== '')).toBe(true)
    expect(seen).toHaveLength(2)
    expect(srv.trips.get(id)?.fields.notes).toBe('late')
    await store.dispose()
  })
})

describe('N3: one flush lock per user', () => {
  it('names the lock by user, whatever the device id or house', async () => {
    const names: string[] = []
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (name: string, cb: () => Promise<void>) => {
          names.push(name)
          return cb()
        },
      },
    })
    try {
      const srv = new MockTripServer()
      const name = uniq('n3')
      const a = new TripStore({
        roomId: ROOM,
        userId: ME,
        api: direct(srv),
        db: new IdbTripDB(name),
      })
      const b = new TripStore({
        roomId: 'room_2',
        userId: ME,
        api: direct(srv, 'room_2'),
        db: new IdbTripDB(name),
      })
      await Promise.all([a.hydrate(), b.hydrate()])
      // The first flush runs before the database has a device id, the later ones after.
      await a.flush()
      a.createTrip({ title: 'T' })
      await a.flush()
      await b.flush()
      expect(names.length).toBeGreaterThanOrEqual(3)
      expect(new Set(names)).toEqual(new Set([`bauhouse-trips-flush-${ME}`]))
      await Promise.all([a.dispose(), b.dispose()])
      await new IdbTripDB(name).destroy()
    } finally {
      Reflect.deleteProperty(navigator, 'locks')
    }
  })
})
