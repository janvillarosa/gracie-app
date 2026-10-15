// Local persistence for the offline client: IndexedDB stores `trips` (server snapshots),
// `outbox` (ops in seq order) and `meta` (device client_id and the seq counter).
// A memory implementation backs tests and browsers without IndexedDB.
import type { Trip, TripOp } from '../../api/tripTypes'

export type StoredTrip = Trip & { room_id: string }
export const bySeq = (a: TripOp, b: TripOp) => a.seq - b.seq || a.at - b.at
export type Meta = { client_id: string; seq: number }

export interface TripDB {
  load(clientId: string): Promise<{ trips: StoredTrip[]; outbox: TripOp[]; meta: Meta | null }>
  putTrip(t: StoredTrip): Promise<void>
  deleteTrip(tripId: string): Promise<void>
  /** Appends an op and persists the seq counter in the same transaction. */
  appendOp(op: TripOp, meta: Meta): Promise<void>
  deleteOps(opIds: string[]): Promise<void>
  putMeta(meta: Meta): Promise<void>
}

export class MemoryTripDB implements TripDB {
  private trips = new Map<string, StoredTrip>()
  private ops = new Map<string, TripOp>()
  private metas = new Map<string, Meta>()
  async load(clientId: string) {
    return {
      trips: [...this.trips.values()],
      outbox: [...this.ops.values()].sort(bySeq),
      meta: this.metas.get(clientId) ?? null,
    }
  }
  async putTrip(t: StoredTrip) {
    this.trips.set(t.trip_id, t)
  }
  async deleteTrip(id: string) {
    this.trips.delete(id)
  }
  async appendOp(op: TripOp, meta: Meta) {
    this.ops.set(op.op_id, op)
    this.metas.set(meta.client_id, meta)
  }
  async deleteOps(opIds: string[]) {
    for (const s of opIds) this.ops.delete(s)
  }
  async putMeta(meta: Meta) {
    this.metas.set(meta.client_id, meta)
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
        db.createObjectStore('outbox', { keyPath: 'op_id' })
        db.createObjectStore('meta')
      }
      r.onsuccess = () => {
        const db = r.result
        // Let another tab (or a test) upgrade or delete the database.
        db.onversionchange = () => {
          db.close()
          this.opening = null
        }
        resolve(db)
      }
      r.onerror = () => reject(r.error)
    })
    return this.opening
  }

  async load(clientId: string) {
    const db = await this.open()
    const tx = db.transaction(['trips', 'outbox', 'meta'], 'readonly')
    const [trips, outbox, meta] = await Promise.all([
      req(tx.objectStore('trips').getAll()),
      req(tx.objectStore('outbox').getAll()),
      req(tx.objectStore('meta').get(clientId)),
    ])
    outbox.sort(bySeq)
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
    tx.objectStore('meta').put(meta, meta.client_id)
    await done(tx)
  }
  async deleteOps(opIds: string[]) {
    if (!opIds.length) return
    const db = await this.open()
    const tx = db.transaction('outbox', 'readwrite')
    for (const s of opIds) tx.objectStore('outbox').delete(s)
    await done(tx)
  }
  async putMeta(meta: Meta) {
    const db = await this.open()
    const tx = db.transaction('meta', 'readwrite')
    tx.objectStore('meta').put(meta, meta.client_id)
    await done(tx)
  }
}

export function createDefaultDB(): TripDB {
  return typeof indexedDB === 'undefined' ? new MemoryTripDB() : new IdbTripDB()
}
