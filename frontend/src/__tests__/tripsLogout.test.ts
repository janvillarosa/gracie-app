import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpsResponse } from '../api/tripTypes'
import { IdbTripDB, wipeTripDatabases, type DraftOp } from '../lib/trips/db'
import {
  flushAndDispose,
  getPendingOnLogout,
  getTripStore,
  resetTripStores,
  subscribePendingOnLogout,
  TripStore,
  wipeTripData,
  type TripApi,
} from '../lib/trips/store'
import { MockTripServer } from '../mocks/tripsServer'

const ROOM = 'room_1'
const uniq = (p: string) => `${p}${Math.random().toString(16).slice(2, 8)}`
const names = async () => (await indexedDB.databases()).map((d) => d.name)
const dbName = (u: string) => `bauhouse-trips-${u}`
const draft = (id: string): DraftOp => ({
  v: 1,
  op_id: id,
  at: 1,
  type: 'trip.update',
  trip_id: 'trip_a',
})

const direct = (srv: MockTripServer): TripApi => ({
  sync: async (_r, known) => srv.sync(ROOM, known),
  ops: async (_r, ops) => srv.ops(ROOM, ops),
})
const offline: TripApi = {
  sync: () => Promise.reject(new Error('offline')),
  ops: () => Promise.reject(new Error('offline')),
}

// A store the registry holds (as the app does), on the default per-user database.
const registered = (user: string, api: TripApi) =>
  getTripStore(`${user}:${ROOM}`, () => new TripStore({ roomId: ROOM, userId: user, api }))

afterEach(async () => {
  vi.useRealTimers()
  await resetTripStores()
  await wipeTripDatabases()
  localStorage.clear()
})

describe('N6: sign-out sends first and never silently discards', () => {
  it('flushAndDispose sends what is queued and reports nothing left', async () => {
    const srv = new MockTripServer()
    const user = uniq('u')
    const store = registered(user, direct(srv))
    await store.hydrate()
    const id = store.createTrip({ title: 'Sent on the way out' })
    expect(await flushAndDispose()).toBe(0)
    expect(srv.trips.get(id)?.fields.title).toBe('Sent on the way out')
    expect(store.isDisposed).toBe(true)
  })

  it('wipes the signed-out user when everything was sent', async () => {
    const srv = new MockTripServer()
    const user = uniq('u')
    const store = registered(user, direct(srv))
    await store.hydrate()
    store.createTrip({ title: 'T' })
    await store.settle()
    expect(await names()).toContain(dbName(user))
    expect(await wipeTripData()).toBe(0)
    expect(srv.trips.size).toBe(1)
    expect(await names()).not.toContain(dbName(user))
    expect(getPendingOnLogout()).toBe(0)
  })

  it('keeps the database and reports the count when changes could not be sent', async () => {
    const user = uniq('u')
    const heard: number[] = []
    const off = subscribePendingOnLogout(() => heard.push(getPendingOnLogout()))
    const store = registered(user, offline)
    await store.hydrate()
    store.createTrip({ title: 'A' })
    store.createTrip({ title: 'B' })
    await store.settle()
    expect(await wipeTripData()).toBe(2)
    expect(getPendingOnLogout()).toBe(2)
    expect(heard).toEqual([2])
    expect(await names()).toContain(dbName(user))
    // The next sign-in of the same user finds the changes and sends them.
    const srv = new MockTripServer()
    const again = new TripStore({ roomId: ROOM, userId: user, api: direct(srv) })
    await again.hydrate()
    expect(again.getState().pending).toBe(2)
    await again.flush()
    expect(again.getState().pending).toBe(0)
    expect(srv.trips.size).toBe(2)
    await again.dispose()
    off()
  })

  it('stops waiting for a request that never answers after the timeout', async () => {
    const user = uniq('u')
    const hung: TripApi = {
      sync: () => new Promise(() => {}),
      ops: () => new Promise<OpsResponse>(() => {}),
    }
    const store = registered(user, hung)
    await store.hydrate()
    store.createTrip({ title: 'Stuck' })
    await store.settle()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let left = -1
    const p = wipeTripData({ timeoutMs: 4000 }).then((n) => {
      left = n
    })
    await vi.advanceTimersByTimeAsync(3999)
    expect(left).toBe(-1)
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(left).toBe(1)
    vi.useRealTimers()
    expect(await names()).toContain(dbName(user))
  })

  it('counts changes of a user with no live store from the database', async () => {
    const user = uniq('u')
    const store = registered(user, offline)
    await store.hydrate()
    store.createTrip({ title: 'Queued earlier' })
    await store.settle()
    await resetTripStores()
    expect(await wipeTripData()).toBe(1)
    expect(await names()).toContain(dbName(user))
  })

  it('does not try to send when the key is already refused (flush: false)', async () => {
    const ops = vi.fn(() => Promise.reject(new Error('no')))
    const user = uniq('u')
    const store = registered(user, { sync: offline.sync, ops })
    await store.hydrate()
    store.createTrip({ title: 'Kept' })
    await store.flush()
    ops.mockClear()
    expect(await wipeTripData({ flush: false })).toBe(1)
    expect(ops).not.toHaveBeenCalled()
    expect(await names()).toContain(dbName(user))
  })
})

describe('CR-4: users are isolated', () => {
  it("never loads one user's ops for another", async () => {
    const a = uniq('a')
    const b = uniq('b')
    const storeA = new TripStore({ roomId: ROOM, userId: a, api: offline })
    await storeA.hydrate()
    storeA.createTrip({ title: "A's secret" })
    await storeA.settle()
    await storeA.dispose()
    const srv = new MockTripServer()
    const storeB = new TripStore({ roomId: ROOM, userId: b, api: direct(srv) })
    await storeB.hydrate()
    expect(storeB.getState().pending).toBe(0)
    await storeB.flush()
    expect(srv.trips.size).toBe(0)
    await storeB.dispose()
    // And A's are still there for A.
    const again = new TripStore({ roomId: ROOM, userId: a, api: offline })
    await again.hydrate()
    expect(again.getState().pending).toBe(1)
    await again.dispose()
  })

  it("a sign-out wipes only the current user's database, never another user's", async () => {
    const mine = uniq('me')
    const other = uniq('other')
    const theirs = new IdbTripDB(other)
    await theirs.appendOp(draft('theirs'), ROOM)
    theirs.close()
    const srv = new MockTripServer()
    const store = registered(mine, direct(srv))
    await store.hydrate()
    store.createTrip({ title: 'Mine' })
    expect(await wipeTripData()).toBe(0)
    expect(await names()).not.toContain(dbName(mine))
    expect(await names()).toContain(dbName(other))
    const left = new IdbTripDB(other)
    expect((await left.load()).outbox.map((o) => o.op_id)).toEqual(['theirs'])
    left.close()
  })
})
