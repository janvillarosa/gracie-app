import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DELETE_TIMEOUT_MS,
  IdbTripDB,
  wipeTripDatabase,
  wipeTripDatabases,
  type DraftOp,
} from '../lib/trips/db'
import { TripStore, type TripApi } from '../lib/trips/store'
import { MockTripServer } from '../mocks/tripsServer'

const ROOM = 'room_1'
const ME = 'user_me'
const uniq = (p: string) => `${p}_${Math.random().toString(16).slice(2)}`
const draft = (id: string): DraftOp => ({
  v: 1,
  op_id: id,
  at: 1,
  type: 'trip.update',
  trip_id: 'trip_a',
})
const dbNames = async () => (await indexedDB.databases()).map((d) => d.name)

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('N7: the database disappears under a store', () => {
  it('disposes the store and never reloads (so nothing persisted is dropped as "sent")', async () => {
    const srv = new MockTripServer()
    const name = uniq('gone')
    const ops = vi.fn(async (_r: string, o: Parameters<TripApi['ops']>[1]) => srv.ops(ROOM, o))
    const offline: TripApi = {
      sync: () => Promise.reject(new Error('offline')),
      ops: () => Promise.reject(new Error('offline')),
    }
    const store = new TripStore({
      roomId: ROOM,
      userId: ME,
      api: offline,
      db: new IdbTripDB(name),
    })
    await store.hydrate()
    store.createTrip({ title: 'Kept' })
    await store.flush()
    expect(store.getState().pending).toBe(1)
    // Another tab signs out: the database is deleted under this connection.
    await new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase(`bauhouse-trips-${name}`)
      r.onsuccess = () => resolve()
    })
    await vi.waitFor(() => expect(store.isDisposed).toBe(true))
    store.setApi({ sync: async (_r, k) => srv.sync(ROOM, k), ops })
    await store.flush()
    expect(ops).not.toHaveBeenCalled()
    // Not dropped as "sent by another tab", and not recreated empty.
    expect(store.getState().pending).toBe(1)
    expect(await dbNames()).not.toContain(`bauhouse-trips-${name}`)
  })

  it('stops waiting for a delete that never answers', async () => {
    vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation(() => ({}) as IDBOpenDBRequest)
    vi.useFakeTimers()
    localStorage.setItem('bauhouse_trips_dbs', JSON.stringify(['bauhouse-trips-hung']))
    let settled = false
    const p = wipeTripDatabases().then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(DELETE_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(settled).toBe(true)
  })

  it('does not open a database while a delete for the same name is pending', async () => {
    const name = uniq('relogin')
    const first = new IdbTripDB(name)
    await first.appendOp(draft('old'), ROOM)
    // Hold the delete open by hand.
    const real = indexedDB.deleteDatabase.bind(indexedDB)
    const hold: { release?: () => void } = {}
    vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation((n) => {
      const r = {} as IDBOpenDBRequest
      hold.release = () => {
        const inner = real(n)
        inner.onsuccess = () => r.onsuccess?.(new Event('success'))
      }
      return r
    })
    const open = vi.spyOn(indexedDB, 'open')
    const destroying = first.destroy()
    const second = new IdbTripDB(name)
    const loading = second.load()
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(open).not.toHaveBeenCalled()
    hold.release?.()
    await destroying
    const loaded = await loading
    expect(open).toHaveBeenCalledTimes(1)
    expect(loaded.outbox).toHaveLength(0)
    vi.restoreAllMocks()
    await second.destroy()
  })
})

describe('wiping one user', () => {
  it('deletes only that user and leaves the others alone', async () => {
    const a = new IdbTripDB('wipe_a')
    const b = new IdbTripDB('wipe_b')
    await a.appendOp(draft('mine'), ROOM)
    await b.appendOp(draft('theirs'), ROOM)
    await wipeTripDatabase('wipe_a')
    expect(await dbNames()).not.toContain('bauhouse-trips-wipe_a')
    expect(await dbNames()).toContain('bauhouse-trips-wipe_b')
    expect(JSON.parse(localStorage.getItem('bauhouse_trips_dbs') ?? '[]')).toEqual([
      'bauhouse-trips-wipe_b',
    ])
    b.close()
    await wipeTripDatabases()
  })
})
