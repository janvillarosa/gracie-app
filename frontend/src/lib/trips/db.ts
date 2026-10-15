// Local persistence for the offline client: IndexedDB stores `trips` (server snapshots),
// `outbox` (ops in seq order) and `meta` (device client_id and the seq counter).
// A memory implementation backs tests and browsers without IndexedDB.
import type { Trip, TripOp } from '../../api/tripTypes'

export type StoredTrip = Trip & { room_id: string }
export type Meta = { client_id: string; seq: number }

export interface TripDB {
  load(): Promise<{ trips: StoredTrip[]; outbox: TripOp[]; meta: Meta | null }>
  putTrip(t: StoredTrip): Promise<void>
  deleteTrip(tripId: string): Promise<void>
  /** Appends an op and persists the seq counter in the same transaction. */
  appendOp(op: TripOp, meta: Meta): Promise<void>
  deleteOps(seqs: number[]): Promise<void>
  putMeta(meta: Meta): Promise<void>
}

export class MemoryTripDB implements TripDB {
  private trips = new Map<string, StoredTrip>()
  private ops = new Map<number, TripOp>()
  private meta: Meta | null = null
  async load() {
    return {
      trips: [...this.trips.values()],
      outbox: [...this.ops.values()].sort((a, b) => a.seq - b.seq),
      meta: this.meta,
    }
  }
  async putTrip(t: StoredTrip) {
    this.trips.set(t.trip_id, t)
  }
  async deleteTrip(id: string) {
    this.trips.delete(id)
  }
  async appendOp(op: TripOp, meta: Meta) {
    this.ops.set(op.seq, op)
    this.meta = meta
  }
  async deleteOps(seqs: number[]) {
    for (const s of seqs) this.ops.delete(s)
  }
  async putMeta(meta: Meta) {
    this.meta = meta
  }
}

const DB_NAME = 'bauhouse-trips'

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

  private open() {
    this.opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1)
      r.onupgradeneeded = () => {
        const db = r.result
        db.createObjectStore('trips', { keyPath: 'trip_id' })
        db.createObjectStore('outbox', { keyPath: 'seq' })
        db.createObjectStore('meta')
      }
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    return this.opening
  }

  async load() {
    const db = await this.open()
    const tx = db.transaction(['trips', 'outbox', 'meta'], 'readonly')
    const [trips, outbox, meta] = await Promise.all([
      req(tx.objectStore('trips').getAll()),
      req(tx.objectStore('outbox').getAll()),
      req(tx.objectStore('meta').get('device')),
    ])
    outbox.sort((a: TripOp, b: TripOp) => a.seq - b.seq)
    return {
      trips: trips as StoredTrip[],
      outbox: outbox as TripOp[],
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
  async appendOp(op: TripOp, meta: Meta) {
    const db = await this.open()
    const tx = db.transaction(['outbox', 'meta'], 'readwrite')
    tx.objectStore('outbox').put(op)
    tx.objectStore('meta').put(meta, 'device')
    await done(tx)
  }
  async deleteOps(seqs: number[]) {
    if (!seqs.length) return
    const db = await this.open()
    const tx = db.transaction('outbox', 'readwrite')
    for (const s of seqs) tx.objectStore('outbox').delete(s)
    await done(tx)
  }
  async putMeta(meta: Meta) {
    const db = await this.open()
    const tx = db.transaction('meta', 'readwrite')
    tx.objectStore('meta').put(meta, 'device')
    await done(tx)
  }
}

export function createDefaultDB(): TripDB {
  return typeof indexedDB === 'undefined' ? new MemoryTripDB() : new IdbTripDB()
}
