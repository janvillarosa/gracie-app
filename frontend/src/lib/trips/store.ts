// The offline trips client: local snapshots + an outbox of ops, replayed on top for every
// render, flushed when the network allows. Framework-free; React binds through
// subscribe/getState (see hooks.ts).
import type {
  OpResult,
  OpsResponse,
  SyncResponse,
  Trip,
  TripDelta,
  TripOp,
  TripOpType,
} from '../../api/tripTypes'
import {
  bySeq,
  clearCurrentTripUser,
  createDefaultDB,
  currentTripUser,
  hasTripDatabase,
  IdbTripDB,
  markCurrentTripUser,
  newDeviceId,
  wipeTripDatabase,
  type DraftOp,
  type StoredTrip,
  type TripDB,
} from './db'
import { mergeDelta, newId, newOpId, renderTrip } from './replay'

export type TripApi = {
  sync(roomId: string, known: Record<string, number>): Promise<SyncResponse>
  ops(roomId: string, ops: TripOp[]): Promise<OpsResponse>
}

// What our offline edit lost to a housemate's: of a trip itself, one of its todos or a booking.
export type ConflictNote = {
  key: string
  tripId: string
  kind: 'trip' | 'todo' | 'booking'
  fields: string[]
  at: number
}
const NOTE_TTL_MS = 24 * 3600 * 1000
export type Toast = { id: number; text: string }

export type StoreState = {
  ready: boolean
  // True once the first sync has answered (or failed), so "not found" isn't shown too early.
  synced: boolean
  trips: Record<string, Trip>
  pending: number
  offline: boolean
  notes: Record<string, ConflictNote>
  toasts: Toast[]
  // The device refused to keep our changes (private window, full disk): they sync while this
  // tab lives but would be lost on reload.
  persistFailed: boolean
}

type Deps = {
  roomId: string
  userId: string
  api: TripApi
  db?: TripDB
  now?: () => number
  // Called when the server says this house is not ours any more (e.g. after joining another).
  onForbidden?: () => void
  // Called when the key is no longer accepted: the owner re-checks who we are (re-auth), and
  // the store stops retrying (that is not being offline).
  onUnauthorized?: () => void
}

const BATCH = 200
const POLL_MS = 20000

const REJECT_TEXT: Record<string, (type: TripOpType) => string> = {
  gone: (t) =>
    t.startsWith('booking')
      ? 'This booking was deleted.'
      : t.startsWith('trip')
        ? 'This trip was deleted.'
        : 'This item was deleted.',
  cap: () => 'This trip is full. Remove something before adding more.',
  forbidden_or_unknown: () => 'You can’t change this trip any more.',
  unsupported: () => 'The server doesn’t support that change yet. It was undone.',
  invalid: () => 'That change wasn’t accepted, so it was undone.',
}

export class TripStore {
  readonly roomId: string
  readonly userId: string
  private api: TripApi
  private db: TripDB
  private now: () => number
  private onForbidden?: () => void
  private onUnauthorized?: () => void
  // The device's client id (one per browser profile, kept in the database). Until the database
  // can stamp an op the op has none; if it cannot at all, ops go out under a volatile id.
  private volatileId = ''
  private volatileSeq = 0
  private persistFailed = false
  private unpersisted = new Set<string>()
  private writing = new Set<Promise<void>>()
  // Ops handed to the database that it has not stamped yet.
  private stamping = new Set<string>()
  // Ops made before the first load finished wait for it, so order and seq stay right.
  private early: Array<() => void> = []
  private disposed = false
  private authFailed = false

  private snapshots = new Map<string, Trip>()
  private outbox: TripOp[] = []
  private offsetMs = 0
  private rendered: Record<string, Trip> = {}
  private notes: Record<string, ConflictNote> = {}
  // Notes made by the results being handled right now: the pull that follows (a stale delta means
  // a housemate wrote in between, which is exactly when the note matters) must not forget them.
  private freshNotes = new Set<string>()
  private toasts: Toast[] = []
  private toastSeq = 0
  private ready = false
  private synced = false
  private offline = false
  private failures = 0
  private batchSize = BATCH
  private inflight: Promise<void> | null = null
  private again = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  private listeners = new Set<() => void>()
  private state: StoreState
  private hydrating: Promise<void> | null = null
  private started = 0

  constructor(deps: Deps) {
    this.roomId = deps.roomId
    this.userId = deps.userId
    this.api = deps.api
    this.db = deps.db ?? createDefaultDB(deps.userId)
    this.now = deps.now ?? Date.now
    this.onForbidden = deps.onForbidden
    this.onUnauthorized = deps.onUnauthorized
    this.db.onInvalidated?.(() => void this.dispose())
    markCurrentTripUser(this.userId)
    this.state = this.makeState()
  }

  // ---- subscription --------------------------------------------------------------------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  getState = () => this.state
  get isDisposed() {
    return this.disposed
  }

  private makeState(): StoreState {
    return {
      ready: this.ready,
      synced: this.synced,
      trips: this.rendered,
      pending: this.outbox.length,
      offline: this.offline,
      notes: this.notes,
      toasts: this.toasts,
      persistFailed: this.persistFailed,
    }
  }
  private emit() {
    this.pruneNotes()
    this.state = this.makeState()
    for (const l of this.listeners) l()
  }

  // ---- lifecycle -----------------------------------------------------------------------
  hydrate(): Promise<void> {
    this.hydrating ??= (async () => {
      let loaded: Awaited<ReturnType<TripDB['load']>>
      try {
        loaded = await this.db.load()
      } catch {
        loaded = { trips: [], outbox: [], meta: null }
        this.persistFailed = true
      }
      if (this.disposed) return
      const stale: string[] = []
      for (const t of loaded.trips) {
        if (t.room_id === this.roomId) this.snapshots.set(t.trip_id, t)
        else stale.push(t.trip_id)
      }
      for (const id of stale) void this.persist(() => this.db.deleteTrip(id))
      // Ops queued before a house join belong to this user's trips, which the join moved here:
      // keep them, and tag them with the house they will now be sent to.
      this.outbox = loaded.outbox
      await this.persist(() => this.db.retagOps(this.roomId))
      if (this.disposed) return
      this.recomputeAll()
      this.ready = true
      this.emit()
      // Ops made while we were loading go in now, in the order they were made.
      for (const run of this.early.splice(0)) run()
    })()
    return this.hydrating
  }

  /** Waits until every op handed to the database has been stamped and stored (or has fallen
   *  back to memory). */
  async settle(): Promise<void> {
    while (this.writing.size) await Promise.all([...this.writing])
  }

  /** Runs a database write, never throwing; after dispose it does nothing at all. */
  private persist(fn: () => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.resolve()
    return fn().catch(() => {
      if (!this.disposed && !this.persistFailed) {
        this.persistFailed = true
        this.emit()
      }
    })
  }

  /** Swaps the credentials the store talks with (the key changed after a sign-in). */
  setApi(api: TripApi) {
    this.api = api
    if (this.authFailed) {
      this.authFailed = false
      this.failures = 0
      void this.flush()
    }
  }

  /** Begins background syncing. Reference counted so strict-mode remounts are safe. */
  start() {
    this.started++
    if (this.started > 1) return
    void this.hydrate().then(() => this.flush())
    if (typeof window === 'undefined') return
    window.addEventListener('online', this.onWake)
    document.addEventListener('visibilitychange', this.onVisible)
    this.poll = setInterval(() => {
      if (document.visibilityState === 'visible') void this.flush()
    }, POLL_MS)
  }

  stop() {
    this.started = Math.max(0, this.started - 1)
    if (this.started > 0) return
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onWake)
      document.removeEventListener('visibilitychange', this.onVisible)
    }
    if (this.poll) clearInterval(this.poll)
    if (this.timer) clearTimeout(this.timer)
    this.poll = this.timer = null
  }

  /** Ends this store for good: timers and listeners go, results that arrive late are ignored,
   *  and the database connection closes. */
  async dispose(fast = false): Promise<void> {
    this.disposed = true
    this.started = 0
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onWake)
      document.removeEventListener('visibilitychange', this.onVisible)
    }
    if (this.poll) clearInterval(this.poll)
    if (this.timer) clearTimeout(this.timer)
    this.poll = this.timer = null
    this.listeners.clear()
    this.early = []
    // `fast`: do not wait for a request that may never answer; its result is ignored anyway.
    if (!fast) await this.inflight?.catch(() => {})
    await this.settle()
    this.db.close()
  }

  /** Tries to send everything queued (for at most `timeoutMs`), then disposes. Resolves with how
   *  many ops are still unsent, counted in the database so other tabs' ops are included. */
  async flushAndDispose(timeoutMs: number): Promise<number> {
    if (timeoutMs > 0 && !this.disposed) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      })
      await Promise.race([this.flush().catch(() => {}), timeout])
      if (timer !== undefined) clearTimeout(timer)
    }
    await this.settle()
    const left = await this.unsentCount()
    await this.dispose(true)
    return left
  }

  private async unsentCount(): Promise<number> {
    try {
      const { outbox } = await this.db.load()
      const inDb = new Set(outbox.map((o) => o.op_id))
      return (
        outbox.length +
        this.outbox.filter((o) => !inDb.has(o.op_id) && this.unpersisted.has(o.op_id)).length
      )
    } catch {
      return this.outbox.length
    }
  }

  /** Deletes this store's database (after dispose). */
  async destroyDb(): Promise<void> {
    await this.db.destroy()
  }

  /** Deletes this user's local trips data (sign-out). */
  async destroy(): Promise<void> {
    await this.dispose()
    await this.db.destroy()
  }

  private onWake = () => {
    this.failures = 0
    void this.flush()
  }
  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.flush()
  }

  // ---- reading -------------------------------------------------------------------------
  private pendingFor(tripId: string) {
    return this.outbox.filter((o) => o.trip_id === tripId)
  }

  private recompute(tripId: string) {
    const t = renderTrip(
      this.snapshots.get(tripId),
      this.pendingFor(tripId),
      this.userId,
      new Date(this.now()).toISOString(),
    )
    const next = { ...this.rendered }
    if (t) next[tripId] = t
    else delete next[tripId]
    this.rendered = next
  }

  private recomputeAll() {
    const ids = new Set<string>([...this.snapshots.keys(), ...this.outbox.map((o) => o.trip_id)])
    this.rendered = {}
    for (const id of ids) {
      const t = renderTrip(
        this.snapshots.get(id),
        this.pendingFor(id),
        this.userId,
        new Date(this.now()).toISOString(),
      )
      if (t) this.rendered[id] = t
    }
  }

  /** Server-corrected clock, used for op timestamps. */
  clock() {
    return this.now() + this.offsetMs
  }

  // ---- writing -------------------------------------------------------------------------
  /** Queues one op: it shows immediately, persists, and flushes when the network allows. The
   *  database stamps it with this device's client id and the next seq (see settle()). */
  enqueue(
    type: TripOpType,
    tripId: string,
    entityId?: string,
    patch?: Record<string, unknown>,
  ): TripOp {
    const draft: DraftOp = {
      v: 1,
      op_id: newOpId(),
      at: this.clock(),
      type,
      trip_id: tripId,
      ...(entityId ? { entity_id: entityId } : {}),
      ...(patch ? { patch } : {}),
    }
    // Until the database stamps it, the op carries a placeholder identity.
    const op: TripOp = { ...draft, client_id: '', seq: 0 }
    if (!this.ready) {
      this.early.push(() => this.accept(op, draft))
      void this.hydrate()
    } else this.accept(op, draft)
    return op
  }

  private accept(op: TripOp, draft: DraftOp) {
    if (this.disposed) return
    this.outbox = [...this.outbox, op]
    this.stamping.add(op.op_id)
    const applied = renderTrip(
      this.rendered[op.trip_id],
      [op],
      this.userId,
      new Date(this.now()).toISOString(),
    )
    const next = { ...this.rendered }
    if (applied) next[op.trip_id] = applied
    this.rendered = next
    this.emit()
    const w: Promise<void> = this.db
      .appendOp(draft, this.roomId)
      .then((stamped) => {
        op.client_id = stamped.client_id
        op.seq = stamped.seq
      })
      .catch(() => this.degrade(op))
      .finally(() => {
        this.stamping.delete(op.op_id)
        this.writing.delete(w)
      })
    this.writing.add(w)
    void this.flush()
  }

  /** The database could not keep this op: send it under a volatile client id (a new one, so its
   *  seq can never collide with the device's) and say that it is not saved on this device. */
  private degrade(op: TripOp) {
    if (this.disposed) return
    this.volatileId ||= newDeviceId()
    op.client_id = this.volatileId
    op.seq = ++this.volatileSeq
    this.unpersisted.add(op.op_id)
    this.persistFailed = true
    this.emit()
  }

  createTrip(patch: Record<string, unknown>): string {
    const id = newId('trip')
    this.enqueue('trip.create', id, undefined, patch)
    return id
  }
  updateTrip(tripId: string, patch: Record<string, unknown>) {
    this.enqueue('trip.update', tripId, undefined, patch)
  }
  deleteTrip(tripId: string) {
    this.enqueue('trip.delete', tripId)
  }
  restoreTrip(tripId: string) {
    this.enqueue('trip.restore', tripId)
  }
  createTodo(tripId: string, patch: Record<string, unknown>): string {
    const id = newId('ttd')
    this.enqueue('todo.create', tripId, id, patch)
    return id
  }
  updateTodo(tripId: string, todoId: string, patch: Record<string, unknown>) {
    this.enqueue('todo.update', tripId, todoId, patch)
  }
  deleteTodo(tripId: string, todoId: string) {
    this.enqueue('todo.delete', tripId, todoId)
  }
  createBooking(tripId: string, patch: Record<string, unknown>): string {
    const id = newId('tbk')
    this.enqueue('booking.create', tripId, id, patch)
    return id
  }
  updateBooking(tripId: string, bookingId: string, patch: Record<string, unknown>) {
    this.enqueue('booking.update', tripId, bookingId, patch)
  }
  deleteBooking(tripId: string, bookingId: string) {
    this.enqueue('booking.delete', tripId, bookingId)
  }

  private pruneNotes() {
    const keep = Object.entries(this.notes).filter(([, n]) => this.now() - n.at < NOTE_TTL_MS)
    if (keep.length !== Object.keys(this.notes).length) this.notes = Object.fromEntries(keep)
  }

  dismissNote(key: string) {
    if (!this.notes[key]) return
    const { [key]: _gone, ...rest } = this.notes
    this.notes = rest
    this.emit()
  }
  dismissToast(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id)
    this.emit()
  }
  private toast(text: string) {
    this.toasts = [...this.toasts, { id: ++this.toastSeq, text }]
  }

  // ---- syncing -------------------------------------------------------------------------
  /** Pushes the outbox, then pulls. Callers during a run share the run (and wait for it). */
  flush(): Promise<void> {
    if (this.inflight) {
      // One more pass after the current run, whatever it ends in.
      this.again = true
      return this.inflight.then(() => {
        if (!this.again || this.inflight) return
        this.again = false
        return this.flush()
      })
    }
    this.inflight = this.run().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private async run(): Promise<void> {
    if (!this.ready) await this.hydrate()
    if (this.disposed) return
    await this.settle()
    // One flusher per device across tabs, so ops go out once and in seq order. A second tab
    // waits its turn (and then finds the outbox already sent). Without the Web Locks API the
    // in-tab guard in flush() is all there is.
    const locks = (navigator as unknown as { locks?: LockManager }).locks
    if (!locks) return this.runLocked()
    await locks.request(`bauhouse-trips-flush-${this.userId}`, async () => {
      if (!this.disposed) await this.runLocked()
    })
  }

  private async runLocked(): Promise<void> {
    try {
      await this.runPasses()
    } finally {
      // Notes made by this run survived its own pulls; from now on a changed trip forgets them.
      this.freshNotes.clear()
    }
  }

  private async runPasses(): Promise<void> {
    do {
      this.again = false
      const pushed = await this.pushOps()
      if (pushed === 'stop' || this.disposed) break
      if (!(await this.pull())) break
      if (pushed === 'retry') {
        // The server's compare-and-swap kept losing: try again soon, without calling it offline.
        this.failures++
        if (this.started) this.scheduleRetry()
        break
      }
    } while (this.again)
  }

  /** Waits for this tab's writes, then reads the outbox back from the database: it picks up ops
   *  other tabs queued and forgets ones they already sent. Returns the ops that may go out now:
   *  those the database holds (stamped, and so in seq order with every lower seq present, since
   *  seqs are allocated atomically) plus ops that only exist in this tab (they have their own
   *  volatile client id). An op still being stamped is never among them. */
  private async reloadOutbox(): Promise<TripOp[]> {
    await this.settle()
    try {
      const { outbox } = await this.db.load()
      if (this.disposed) return []
      // Ops this tab already holds keep their identity; the database adds what other tabs queued.
      const mine = new Map(this.outbox.map((o) => [o.op_id, o]))
      const inDb = new Set(outbox.map((o) => o.op_id))
      const stored = outbox.map((o) => {
        const m = mine.get(o.op_id)
        if (!m) return o
        // Stored before this tab heard back: take the stamp the database gave it.
        if (!m.seq) {
          m.client_id = o.client_id
          m.seq = o.seq
        }
        return m
      })
      const onlyHere = this.outbox.filter(
        (o) => !inDb.has(o.op_id) && (this.unpersisted.has(o.op_id) || this.stamping.has(o.op_id)),
      )
      this.outbox = [...stored, ...onlyHere]
      this.recomputeAll()
      this.emit()
      return [...stored, ...onlyHere.filter((o) => this.unpersisted.has(o.op_id))].filter(
        (o) => o.seq > 0,
      )
    } catch {
      // Could not read the database: fall back to what this tab holds, stamped ops only.
      return this.outbox.filter((o) => o.seq > 0).sort(bySeq)
    }
  }

  private scheduleRetry() {
    if (this.timer) clearTimeout(this.timer)
    const delay = Math.min(60000, 2000 * 2 ** Math.min(this.failures, 5))
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.disposed) void this.flush()
    }, delay)
  }

  private fail() {
    this.synced = true
    this.failures++
    this.offline = true
    this.emit()
    if (this.started && !this.authFailed) this.scheduleRetry()
  }

  private succeed() {
    this.failures = 0
    if (this.offline) {
      this.offline = false
      this.emit()
    }
  }

  /** 'ok': everything went; 'retry': the server asked us to try again (later ops wait);
   *  'stop': offline, signed out or moved house. */
  private async pushOps(): Promise<'ok' | 'retry' | 'stop'> {
    for (;;) {
      // Before EVERY batch: re-read the database, so a lower seq another tab queued meanwhile is
      // never sent after a higher one (the server drops any seq at or below what it has applied).
      const ready = await this.reloadOutbox()
      if (this.disposed) return 'stop'
      const batch = ready.slice(0, this.batchSize)
      if (!batch.length) break
      let resp: OpsResponse
      try {
        resp = await this.api.ops(this.roomId, batch)
      } catch (e) {
        if (this.disposed) return 'stop'
        const status = (e as { status?: number }).status
        if (status === 401) {
          // Not offline: the key is no longer good. The owner re-checks who we are.
          this.authFailed = true
          this.onUnauthorized?.()
          return 'stop'
        }
        if (status === 403) {
          // The house changed under us (a join moved our trips). The outbox is kept (and the new
          // house's store re-tags it); the owner refreshes who we are and starts that store.
          this.onForbidden?.()
          this.fail()
          return 'stop'
        }
        if ((status === 400 || status === 413) && batch.length > 1) {
          this.batchSize = Math.max(1, Math.floor(batch.length / 2))
          continue
        }
        if (status === 400 || status === 413) {
          this.toast('That change couldn’t be saved, so it was undone.')
          await this.drop(batch.map((o) => o.op_id))
          continue
        }
        this.fail()
        return 'stop'
      }
      if (this.disposed) return 'stop'
      this.succeed()
      this.batchSize = BATCH
      const retried = await this.handleResults(batch, resp)
      // Later ops must not overtake a retried one (the server drops any seq at or below the
      // highest it has applied), so wait.
      if (retried > 0) return 'retry'
    }
    return 'ok'
  }

  private async handleResults(batch: TripOp[], resp: OpsResponse): Promise<number> {
    if (typeof resp.server_time === 'number') this.offsetMs = resp.server_time - this.now()
    const byId = new Map(resp.results.map((r) => [r.op_id, r]))
    const drop: string[] = []
    let retried = 0
    for (const op of batch) {
      const r: OpResult | undefined = byId.get(op.op_id)
      if (!r || r.status === 'retry') {
        retried++
        continue
      }
      drop.push(op.op_id)
      if (r.status === 'conflicted') {
        const key = op.entity_id ?? op.trip_id
        const kind = op.type.startsWith('booking')
          ? 'booking'
          : op.type.startsWith('todo')
            ? 'todo'
            : 'trip'
        this.freshNotes.add(key)
        this.notes = {
          ...this.notes,
          [key]: { key, tripId: op.trip_id, kind, fields: r.skipped_fields ?? [], at: this.now() },
        }
      } else if (r.status === 'rejected') {
        const text = (REJECT_TEXT[r.code ?? 'invalid'] ?? REJECT_TEXT.invalid)(op.type)
        this.toast(text)
      }
    }
    // Remove acked ops first, then fold in the server's copy, so nothing replays twice.
    await this.drop(drop, false)
    // A delta that doesn't start where our copy ends means someone else wrote in between:
    // fetch those trips whole instead of guessing.
    const stale = await this.applyDeltas(resp.trips ?? [], true)
    if (stale.length) await this.pull(new Set(stale))
    this.emit()
    return retried
  }

  private async drop(opIds: string[], emit = true) {
    const gone = new Set(opIds)
    this.outbox = this.outbox.filter((o) => !gone.has(o.op_id))
    for (const id of opIds) this.unpersisted.delete(id)
    await this.persist(() => this.db.deleteOps(opIds))
    this.recomputeAll()
    if (emit) this.emit()
  }

  private async applyDeltas(
    deltas: TripDelta[],
    checkBase = false,
    fromPull = false,
  ): Promise<string[]> {
    const stale: string[] = []
    for (const d of deltas) {
      const cur = this.snapshots.get(d.trip_id)
      if (checkBase && !d.full && (!cur || cur.version !== d.base_version)) {
        stale.push(d.trip_id)
        continue
      }
      const next = mergeDelta(this.snapshots.get(d.trip_id), d)
      this.snapshots.set(d.trip_id, next)
      // Someone changed the trip again: what we noted about an older clash is stale.
      if (fromPull) this.forgetNotes(d.trip_id)
      await this.persist(() => this.db.putTrip({ ...next, room_id: this.roomId }))
    }
    this.recomputeAll()
    return stale
  }

  private forgetNotes(tripId: string) {
    const keep = Object.entries(this.notes).filter(
      ([k, n]) => n.tripId !== tripId || this.freshNotes.has(k),
    )
    if (keep.length !== Object.keys(this.notes).length) this.notes = Object.fromEntries(keep)
  }

  private async pull(refetch?: Set<string>): Promise<boolean> {
    const known: Record<string, number> = {}
    for (const [id, t] of this.snapshots) if (!refetch?.has(id)) known[id] = t.version
    let resp: SyncResponse
    try {
      resp = await this.api.sync(this.roomId, known)
    } catch (e) {
      if (this.disposed) return false
      if ((e as { status?: number }).status === 401) {
        this.authFailed = true
        this.synced = true
        this.onUnauthorized?.()
        this.emit()
        return false
      }
      this.fail()
      return false
    }
    if (this.disposed) return false
    this.succeed()
    this.synced = true
    if (typeof resp.server_time === 'number') this.offsetMs = resp.server_time - this.now()
    await this.applyDeltas(resp.trips ?? [], false, true)
    for (const r of resp.removed ?? []) {
      const rm = typeof r === 'string' ? { trip_id: r, purged: true } : r
      if (rm.purged) {
        this.snapshots.delete(rm.trip_id)
        await this.persist(() => this.db.deleteTrip(rm.trip_id))
        const gone = this.outbox.filter((o) => o.trip_id === rm.trip_id).map((o) => o.op_id)
        if (gone.length) await this.drop(gone, false)
      } else {
        const cur = this.snapshots.get(rm.trip_id)
        if (cur) {
          const next = { ...cur, deleted: { by: rm.deleted_by } }
          this.snapshots.set(rm.trip_id, next)
          await this.persist(() => this.db.putTrip({ ...next, room_id: this.roomId } as StoredTrip))
        }
      }
    }
    this.recomputeAll()
    this.emit()
    return true
  }
}

// One store per signed-in house, kept across page changes so navigation never reloads from disk.
const registry = new Map<string, TripStore>()
export function getTripStore(key: string, make: () => TripStore): TripStore {
  let s = registry.get(key)
  // A disposed store (its database was removed under it) never comes back; make a fresh one.
  if (!s || s.isDisposed) {
    s = make()
    registry.set(key, s)
  }
  return s
}

/** Disposes every store (stops timers, closes databases, ignores late results). */
export async function resetTripStores(): Promise<void> {
  const all = [...registry.values()]
  registry.clear()
  await Promise.all(all.map((s) => s.dispose()))
}

// How many changes could not be sent at the last sign-out (their database was kept for the next
// sign-in). The sign-in screen can say so.
let pendingOnLogout = 0
const pendingListeners = new Set<() => void>()
export const getPendingOnLogout = () => pendingOnLogout
export function subscribePendingOnLogout(fn: () => void) {
  pendingListeners.add(fn)
  return () => {
    pendingListeners.delete(fn)
  }
}
const setPendingOnLogout = (n: number) => {
  if (n === pendingOnLogout) return
  pendingOnLogout = n
  for (const l of pendingListeners) l()
}

/** Sends what is queued in every live store (waiting at most `timeoutMs` in all), then disposes
 *  them. Resolves with the number of changes still unsent. */
export async function flushAndDispose(timeoutMs = 4000): Promise<number> {
  const all = [...registry.values()]
  registry.clear()
  const left = await Promise.all(all.map((s) => s.flushAndDispose(timeoutMs)))
  return left.reduce((a, b) => a + b, 0)
}

/** Sign-out. The signed-out user's stores send what they can (unless `flush` is false, e.g. the
 *  key is already refused), then their local trips data is deleted - but only if nothing is left
 *  unsent: otherwise the database is kept for their next sign-in and the count is exposed through
 *  getPendingOnLogout(). Only this user's database is touched, never another user's. */
export async function wipeTripData(
  opts: { flush?: boolean; timeoutMs?: number } = {},
): Promise<number> {
  const stores = [...registry.values()]
  const users = new Set(stores.map((s) => s.userId))
  const marked = currentTripUser()
  if (marked) users.add(marked)
  registry.clear()
  const timeout = opts.flush === false ? 0 : (opts.timeoutMs ?? 4000)
  let left = (await Promise.all(stores.map((s) => s.flushAndDispose(timeout)))).reduce(
    (a, b) => a + b,
    0,
  )
  // A user with no live store (signed out before opening a trips screen) may still have queued
  // changes from an earlier visit.
  const live = new Set(stores.map((s) => s.userId))
  if (typeof indexedDB !== 'undefined') {
    for (const u of users) {
      if (live.has(u) || !hasTripDatabase(u)) continue
      const db = new IdbTripDB(u)
      try {
        left += (await db.load()).outbox.length
      } catch {
      } finally {
        db.close()
      }
    }
  }
  setPendingOnLogout(left)
  // Whoever signs in next is not this user: a kept database is never wiped by someone else's sign-out.
  clearCurrentTripUser()
  if (left > 0) return left
  await Promise.all(stores.map((s) => s.destroyDb()))
  await Promise.all([...users].map((u) => wipeTripDatabase(u)))
  return 0
}
