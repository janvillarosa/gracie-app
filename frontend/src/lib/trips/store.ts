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
import { createDefaultDB, type Meta, type StoredTrip, type TripDB } from './db'
import { mergeDelta, newId, newOpId, renderTrip } from './replay'

export type TripApi = {
  sync(known: Record<string, number>): Promise<SyncResponse>
  ops(ops: TripOp[]): Promise<OpsResponse>
}

export type ConflictNote = { key: string; tripId: string; fields: string[] }
export type Toast = { id: number; text: string }

export type StoreState = {
  ready: boolean
  trips: Record<string, Trip>
  pending: number
  offline: boolean
  notes: Record<string, ConflictNote>
  toasts: Toast[]
}

type Deps = {
  roomId: string
  userId: string
  api: TripApi
  db?: TripDB
  now?: () => number
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

  private snapshots = new Map<string, Trip>()
  private outbox: TripOp[] = []
  private meta: Meta = { client_id: '', seq: 0 }
  private offsetMs = 0
  private rendered: Record<string, Trip> = {}
  private notes: Record<string, ConflictNote> = {}
  private toasts: Toast[] = []
  private toastSeq = 0
  private ready = false
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
    this.db = deps.db ?? createDefaultDB()
    this.now = deps.now ?? Date.now
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

  private makeState(): StoreState {
    return {
      ready: this.ready,
      trips: this.rendered,
      pending: this.outbox.length,
      offline: this.offline,
      notes: this.notes,
      toasts: this.toasts,
    }
  }
  private emit() {
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
      }
      const stale: string[] = []
      for (const t of loaded.trips) {
        if (t.room_id === this.roomId) this.snapshots.set(t.trip_id, t)
        else stale.push(t.trip_id)
      }
      for (const id of stale) void this.db.deleteTrip(id).catch(() => {})
      this.outbox = loaded.outbox
      const maxSeq = loaded.outbox.reduce((m, o) => Math.max(m, o.seq), 0)
      this.meta = loaded.meta ?? { client_id: newId('trip').replace('trip_', 'dev_'), seq: 0 }
      this.meta.seq = Math.max(this.meta.seq, maxSeq)
      if (!loaded.meta) void this.db.putMeta(this.meta).catch(() => {})
      this.recomputeAll()
      this.ready = true
      this.emit()
    })()
    return this.hydrating
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
  /** Queues one op: it shows immediately, persists, and flushes when the network allows. */
  enqueue(
    type: TripOpType,
    tripId: string,
    entityId?: string,
    patch?: Record<string, unknown>,
  ): TripOp {
    this.meta = { ...this.meta, seq: this.meta.seq + 1 }
    const op: TripOp = {
      v: 1,
      op_id: newOpId(),
      client_id: this.meta.client_id,
      seq: this.meta.seq,
      at: this.clock(),
      type,
      trip_id: tripId,
      ...(entityId ? { entity_id: entityId } : {}),
      ...(patch ? { patch } : {}),
    }
    this.outbox = [...this.outbox, op]
    const applied = renderTrip(
      this.rendered[tripId],
      [op],
      this.userId,
      new Date(this.now()).toISOString(),
    )
    const next = { ...this.rendered }
    if (applied) next[tripId] = applied
    this.rendered = next
    this.emit()
    void this.db.appendOp(op, this.meta).catch(() => {})
    void this.flush()
    return op
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
    do {
      this.again = false
      const ok = (await this.pushOps()) && (await this.pull())
      if (!ok) break
    } while (this.again)
  }

  private scheduleRetry() {
    if (this.timer) clearTimeout(this.timer)
    const delay = Math.min(60000, 2000 * 2 ** Math.min(this.failures, 5))
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, delay)
  }

  private fail() {
    this.failures++
    this.offline = true
    this.emit()
    if (this.started) this.scheduleRetry()
  }

  private succeed() {
    this.failures = 0
    if (this.offline) {
      this.offline = false
      this.emit()
    }
  }

  private async pushOps(): Promise<boolean> {
    while (this.outbox.length) {
      const batch = this.outbox.slice(0, this.batchSize)
      let resp: OpsResponse
      try {
        resp = await this.api.ops(batch)
      } catch (e) {
        const status = (e as { status?: number }).status
        if ((status === 400 || status === 413) && batch.length > 1) {
          this.batchSize = Math.max(1, Math.floor(batch.length / 2))
          continue
        }
        if (status === 400 || status === 413) {
          this.toast('That change couldn’t be saved, so it was undone.')
          await this.drop(batch.map((o) => o.seq))
          continue
        }
        this.fail()
        return false
      }
      this.succeed()
      this.batchSize = BATCH
      const retried = await this.handleResults(batch, resp)
      if (retried > 0) {
        // The server's compare-and-swap kept losing. Later ops must not overtake a retried
        // one (the server drops any seq at or below the highest it has applied), so wait.
        this.fail()
        this.offline = false
        this.emit()
        return false
      }
    }
    return true
  }

  private async handleResults(batch: TripOp[], resp: OpsResponse): Promise<number> {
    if (typeof resp.server_time === 'number') this.offsetMs = resp.server_time - this.now()
    const byId = new Map(resp.results.map((r) => [r.op_id, r]))
    const drop: number[] = []
    let retried = 0
    for (const op of batch) {
      const r: OpResult | undefined = byId.get(op.op_id)
      if (!r || r.status === 'retry') {
        retried++
        continue
      }
      drop.push(op.seq)
      if (r.status === 'conflicted') {
        const key = op.entity_id ?? op.trip_id
        this.notes = {
          ...this.notes,
          [key]: { key, tripId: op.trip_id, fields: r.skipped_fields ?? [] },
        }
      } else if (r.status === 'rejected') {
        const text = (REJECT_TEXT[r.code ?? 'invalid'] ?? REJECT_TEXT.invalid)(op.type)
        this.toast(text)
      }
    }
    // Remove acked ops first, then fold in the server's copy, so nothing replays twice.
    await this.drop(drop, false)
    await this.applyDeltas(resp.trips ?? [])
    this.emit()
    return retried
  }

  private async drop(seqs: number[], emit = true) {
    const gone = new Set(seqs)
    this.outbox = this.outbox.filter((o) => !gone.has(o.seq))
    await this.db.deleteOps(seqs).catch(() => {})
    this.recomputeAll()
    if (emit) this.emit()
  }

  private async applyDeltas(deltas: TripDelta[]) {
    for (const d of deltas) {
      const next = mergeDelta(this.snapshots.get(d.trip_id), d)
      this.snapshots.set(d.trip_id, next)
      await this.db.putTrip({ ...next, room_id: this.roomId }).catch(() => {})
    }
    this.recomputeAll()
  }

  private async pull(): Promise<boolean> {
    const known: Record<string, number> = {}
    for (const [id, t] of this.snapshots) known[id] = t.version
    let resp: SyncResponse
    try {
      resp = await this.api.sync(known)
    } catch {
      this.fail()
      return false
    }
    this.succeed()
    if (typeof resp.server_time === 'number') this.offsetMs = resp.server_time - this.now()
    await this.applyDeltas(resp.trips ?? [])
    for (const r of resp.removed ?? []) {
      const rm = typeof r === 'string' ? { trip_id: r, purged: true } : r
      if (rm.purged) {
        this.snapshots.delete(rm.trip_id)
        await this.db.deleteTrip(rm.trip_id).catch(() => {})
        const gone = this.outbox.filter((o) => o.trip_id === rm.trip_id).map((o) => o.seq)
        if (gone.length) await this.drop(gone, false)
      } else {
        const cur = this.snapshots.get(rm.trip_id)
        if (cur) {
          const next = { ...cur, deleted: { by: rm.deleted_by } }
          this.snapshots.set(rm.trip_id, next)
          await this.db.putTrip({ ...next, room_id: this.roomId } as StoredTrip).catch(() => {})
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
  if (!s) {
    s = make()
    registry.set(key, s)
  }
  return s
}
export function resetTripStores() {
  registry.clear()
}
