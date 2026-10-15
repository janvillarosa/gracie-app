// Local persistence for the offline client. One IndexedDB per signed-in user holds `trips`
// (server snapshots), `outbox` (ops, tagged with the house they were queued in) and `meta` (the device's
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
  /** Everything this user's database holds. Ops are not filtered by house: a user has one house
   *  and joining another moves their trips, so ops queued before a join still have to go out.
   *  A `roomId` narrows the outbox to that house (kept for callers that want it). */
  load(roomId?: string): Promise<{ trips: StoredTrip[]; outbox: TripOp[]; meta: Meta | null }>
  putTrip(t: StoredTrip): Promise<void>
  deleteTrip(tripId: string): Promise<void>
  /** Stamps the op with the device's client_id and the next seq, atomically, and stores it. */
  appendOp(op: DraftOp, roomId: string): Promise<TripOp>
  deleteOps(opIds: string[]): Promise<void>
  /** Tags every queued op with `roomId` (ops target trip ids, so they still apply after a join). */
  retagOps(roomId: string): Promise<void>
  /** Called when the database was deleted or upgraded under this connection (another tab,
   *  sign-out elsewhere). The owner should stop; the database refuses to reopen. */
  onInvalidated?(fn: () => void): void
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
  async load(roomId?: string) {
    return {
      trips: [...this.trips.values()],
      outbox: [...this.ops.values()]
        .filter((o) => roomId === undefined || o.room_id === roomId)
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
  async retagOps(roomId: string) {
    for (const o of this.ops.values()) o.room_id = roomId
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

/** How long a delete may take before we stop waiting for it (a hung or blocked delete must
 *  not hang sign-out or the next sign-in). */
export const DELETE_TIMEOUT_MS = 3000
const pendingDeletes = new Map<string, Promise<void>>()

/** Deletes a database, resolving when it is gone, failed, or took too long. While a delete is
 *  pending, opening the same name waits for it (see IdbTripDB.open), so a fast re-login can never
 *  open a database that is about to disappear. */
export function deleteDb(name: string): Promise<void> {
  const running = pendingDeletes.get(name)
  if (running) return running
  const p = new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (timer !== undefined) clearTimeout(timer)
      resolve()
    }
    timer = setTimeout(finish, DELETE_TIMEOUT_MS)
    try {
      const r = indexedDB.deleteDatabase(name)
      r.onsuccess = r.onerror = finish
    } catch {
      finish()
    }
  }).finally(() => pendingDeletes.delete(name))
  pendingDeletes.set(name, p)
  return p
}

const registered = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}
const forget = (names: string[]) => {
  try {
    const left = registered().filter((n) => !names.includes(n))
    if (left.length) localStorage.setItem(REGISTRY_KEY, JSON.stringify(left))
    else localStorage.removeItem(REGISTRY_KEY)
  } catch {}
}

// Before the databases were per user there was one shared `bauhouse-trips` (with every user's
// booking codes in it). Remove it once, on the first open or wipe, so old codes don't linger.
const LEGACY_DB = 'bauhouse-trips'
const LEGACY_FLAG = 'bauhouse_trips_legacy_removed'

async function removeLegacyOnce(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    if (localStorage.getItem(LEGACY_FLAG)) return
  } catch {}
  await deleteDb(LEGACY_DB)
  try {
    localStorage.setItem(LEGACY_FLAG, '1')
  } catch {}
}

/** Deletes one user's trips database (sign-out of that user; never anyone else's). */
export async function wipeTripDatabase(userId: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const name = `${DB_PREFIX}${userId}`
  forget([name])
  await Promise.all([deleteDb(name), removeLegacyOnce()])
}

/** Deletes every trips database this browser made for any user (tests; never on sign-out). */
export async function wipeTripDatabases(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const names = registered()
  forget(names)
  await Promise.all([...names.map(deleteDb), removeLegacyOnce()])
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
  private invalidated = false
  private invalidatedListener: (() => void) | null = null

  constructor(userId: string) {
    this.name = `${DB_PREFIX}${userId}`
  }

  private open() {
    this.opening ??= this.connect().catch((e) => {
      // A failed open must not poison every later call.
      this.opening = null
      throw e
    })
    return this.opening
  }

  private async connect(): Promise<IDBDatabase> {
    // The database was deleted or upgraded under this connection: it is gone, and opening it
    // again would silently create an empty one that then looks like "everything was sent".
    if (this.invalidated) throw new Error('The trips database was removed')
    // Never open a name that has a delete in flight (sign-out, then a quick sign-in).
    await pendingDeletes.get(this.name)
    await removeLegacyOnce()
    if (this.invalidated) throw new Error('The trips database was removed')
    return new Promise<IDBDatabase>((resolve, reject) => {
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
        // Another tab (or a test) deleted or upgraded the database: close, and tell the owner
        // to stop. It must not reload (an empty database would read as "other tabs sent it all").
        db.onversionchange = () => {
          db.close()
          this.opening = null
          this.invalidated = true
          this.invalidatedListener?.()
        }
        resolve(db)
      }
      r.onerror = () => reject(r.error)
      r.onblocked = () => reject(new Error('IndexedDB is blocked'))
    })
  }

  async load(roomId?: string) {
    const db = await this.open()
    const tx = db.transaction(['trips', 'outbox', 'meta'], 'readonly')
    const [trips, outbox, meta] = await Promise.all([
      req(tx.objectStore('trips').getAll()),
      req(tx.objectStore('outbox').getAll()),
      req(tx.objectStore('meta').get(DEVICE)),
    ])
    const mine = (outbox as Array<TripOp & { room_id?: string }>)
      .filter((o) => roomId === undefined || o.room_id === roomId)
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
  async retagOps(roomId: string) {
    const db = await this.open()
    const tx = db.transaction('outbox', 'readwrite')
    const store = tx.objectStore('outbox')
    const all = (await req(store.getAll())) as Array<TripOp & { room_id?: string }>
    for (const o of all) if (o.room_id !== roomId) store.put({ ...o, room_id: roomId })
    await done(tx)
  }
  close() {
    const p = this.opening
    this.opening = null
    void p?.then((db) => db.close()).catch(() => {})
  }
  onInvalidated(fn: () => void) {
    this.invalidatedListener = fn
  }
  async destroy() {
    this.close()
    forget([this.name])
    await deleteDb(this.name)
  }
}

export function createDefaultDB(userId: string): TripDB {
  return typeof indexedDB === 'undefined' ? new MemoryTripDB() : new IdbTripDB(userId)
}
