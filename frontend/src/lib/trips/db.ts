// Local persistence for the offline client. One IndexedDB per signed-in user holds `trips`
// (server snapshots), `outbox` (ops, each tagged with its house) and `meta` (the device's
// client_id and the seq counter). The seq is handed out inside the same transaction that stores
// the op, so two tabs (or a duplicated tab) can never reuse one.
// A memory implementation backs tests and browsers without IndexedDB.
import type { Trip, TripOp } from '../../api/tripTypes'

export type StoredTrip = Trip & { room_id: string }
export const bySeq = (a: TripOp, b: TripOp) => a.seq - b.seq || a.at - b.at
export type Meta = { client_id: string; seq: number }
/** An op before the database has stamped it with this device's id and next seq. */
export type DraftOp = Omit<TripOp, 'client_id' | 'seq'>

export interface TripDB {
  load(roomId: string): Promise<{ trips: StoredTrip[]; outbox: TripOp[]; meta: Meta | null }>
  putTrip(t: StoredTrip): Promise<void>
  deleteTrip(tripId: string): Promise<void>
  /** Stamps the op with the device's client_id and the next seq, atomically, and stores it. */
  appendOp(op: DraftOp, roomId: string): Promise<TripOp>
  deleteOps(opIds: string[]): Promise<void>
  /** Releases the connection. */
  close(): void
  /** Deletes everything this database holds (sign-out). */
  destroy(): Promise<void>
}

export const newDeviceId = () => {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return `dev_${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

export class MemoryTripDB implements TripDB {
  private trips = new Map<string, StoredTrip>()
  private ops = new Map<string, TripOp & { room_id: string }>()
  private meta: Meta | null = null
  async load(roomId: string) {
    return {
      trips: [...this.trips.values()],
      outbox: [...this.ops.values()]
        .filter((o) => o.room_id === roomId)
        .map(({ room_id: _r, ...op }) => op as TripOp)
        .sort(bySeq),
      meta: this.meta ? { ...this.meta } : null,
    }
  }
  async putTrip(t: StoredTrip) {
    this.trips.set(t.trip_id, t)
  }
  async deleteTrip(id: string) {
    this.trips.delete(id)
  }
  async appendOp(op: DraftOp, roomId: string) {
    this.meta = { client_id: this.meta?.client_id ?? newDeviceId(), seq: (this.meta?.seq ?? 0) + 1 }
    const stamped: TripOp = { ...op, client_id: this.meta.client_id, seq: this.meta.seq }
    this.ops.set(op.op_id, { ...stamped, room_id: roomId })
    return stamped
  }
  async deleteOps(opIds: string[]) {
    for (const s of opIds) this.ops.delete(s)
  }
  close() {}
  async destroy() {
    this.trips.clear()
    this.ops.clear()
    this.meta = null
  }
}

const DB_PREFIX = 'bauhouse-trips-'
const REGISTRY_KEY = 'bauhouse_trips_dbs'
const DEVICE = 'device'

const remember = (name: string) => {
  try {
    const have = JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? '[]') as string[]
    if (!have.includes(name)) localStorage.setItem(REGISTRY_KEY, JSON.stringify([...have, name]))
  } catch {}
}

/** Deletes every trips database this browser made for any user (sign-out). */
export async function wipeTripDatabases(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  let names: string[] = []
  try {
    names = JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? '[]') as string[]
    localStorage.removeItem(REGISTRY_KEY)
  } catch {}
  await Promise.all(
    names.map(
      (n) =>
        new Promise<void>((resolve) => {
          const r = indexedDB.deleteDatabase(n)
          r.onsuccess = r.onerror = r.onblocked = () => resolve()
        }),
    ),
  )
}

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })

export class IdbTripDB implements TripDB {
  private opening: Promise<IDBDatabase> | null = null
  private name: string

  constructor(userId: string) {
    this.name = `${DB_PREFIX}${userId}`
  }

  private open() {
    this.opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(this.name, 1)
      r.onupgradeneeded = () => {
        const db = r.result
        db.createObjectStore('trips', { keyPath: 'trip_id' })
        db.createObjectStore('outbox', { keyPath: 'op_id' })
        db.createObjectStore('meta')
      }
      r.onsuccess = () => {
        const db = r.result
        remember(this.name)
        // Let another tab (or a test) upgrade or delete the database.
        db.onversionchange = () => {
          db.close()
          this.opening = null
        }
        resolve(db)
      }
      r.onerror = () => {
        // A failed open must not poison every later call.
        this.opening = null
        reject(r.error)
      }
      r.onblocked = () => {
        this.opening = null
        reject(new Error('IndexedDB is blocked'))
      }
    })
    return this.opening
  }

  async load(roomId: string) {
    const db = await this.open()
    const tx = db.transaction(['trips', 'outbox', 'meta'], 'readonly')
    const [trips, outbox, meta] = await Promise.all([
      req(tx.objectStore('trips').getAll()),
      req(tx.objectStore('outbox').getAll()),
      req(tx.objectStore('meta').get(DEVICE)),
    ])
    const mine = (outbox as Array<TripOp & { room_id?: string }>)
      .filter((o) => o.room_id === roomId)
      .map(({ room_id: _r, ...op }) => op as TripOp)
      .sort(bySeq)
    return {
      trips: trips as StoredTrip[],
      outbox: mine,
      meta: (meta ?? null) as Meta | null,
    }
  }
  async putTrip(t: StoredTrip) {
    const db = await this.open()
    const tx = db.transaction('trips', 'readwrite')
    tx.objectStore('trips').put(t)
    await done(tx)
  }
  async deleteTrip(id: string) {
    const db = await this.open()
    const tx = db.transaction('trips', 'readwrite')
    tx.objectStore('trips').delete(id)
    await done(tx)
  }
  async appendOp(op: DraftOp, roomId: string) {
    const db = await this.open()
    const tx = db.transaction(['outbox', 'meta'], 'readwrite')
    const meta = tx.objectStore('meta')
    const cur = (await req(meta.get(DEVICE))) as Meta | undefined
    const next: Meta = { client_id: cur?.client_id ?? newDeviceId(), seq: (cur?.seq ?? 0) + 1 }
    const stamped: TripOp = { ...op, client_id: next.client_id, seq: next.seq }
    tx.objectStore('outbox').put({ ...stamped, room_id: roomId })
    meta.put(next, DEVICE)
    await done(tx)
    return stamped
  }
  async deleteOps(opIds: string[]) {
    if (!opIds.length) return
    const db = await this.open()
    const tx = db.transaction('outbox', 'readwrite')
    for (const s of opIds) tx.objectStore('outbox').delete(s)
    await done(tx)
  }
  close() {
    const p = this.opening
    this.opening = null
    void p?.then((db) => db.close()).catch(() => {})
  }
  async destroy() {
    this.close()
    await new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase(this.name)
      r.onsuccess = r.onerror = r.onblocked = () => resolve()
    })
  }
}

export function createDefaultDB(userId: string): TripDB {
  return typeof indexedDB === 'undefined' ? new MemoryTripDB() : new IdbTripDB(userId)
}
