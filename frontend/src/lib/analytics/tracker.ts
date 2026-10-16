// Behavior events (opens, views, suggestion and nudge taps) sent to our own API.
// Best effort: tracking never throws, never blocks the UI, and a lost event is acceptable.
// Identity is never sent; the server takes the user and house from the API key.

export type Ref = { type: string; id: string }

export type TrackedEvent = {
  event_id: string
  name: string
  occurred_at: number
  subject: Ref
  container?: Ref
  key?: string
  props?: Record<string, string | number | boolean>
  client_id: string
  session_id: string
}

export type TrackInput = {
  subject: Ref
  container?: Ref
  key?: string
  props?: Record<string, string | number | boolean>
}

export type SendResult = 'ok' | 'retry' | 'drop'

export type TrackerDeps = {
  now: () => number
  uid: () => string
  /** Sends one batch. 'retry' keeps the events queued, 'drop' discards them. */
  send: (events: TrackedEvent[], opts: { keepalive: boolean }) => Promise<SendResult>
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
}

const QUEUE_KEY = 'gracie_events_q'
const CLIENT_KEY = 'gracie_events_client'
const MAX_QUEUE = 200
const BATCH = 50
const SESSION_IDLE_MS = 30 * 60 * 1000
export const RESUME_AFTER_MS = 30 * 60 * 1000
export const FLUSH_EVERY_MS = 10_000

export class Tracker {
  private queue: TrackedEvent[] = []
  private enabled = false
  private flushing = false
  private sessionId = ''
  private lastActivity = 0
  private clientId = ''
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: TrackerDeps) {}

  /** Turns tracking on for a signed-in user, or off (and forgets the queue) with false. */
  setEnabled(on: boolean) {
    if (on === this.enabled) return
    this.enabled = on
    if (on) {
      this.queue = this.load()
      this.timer = setInterval(() => void this.flush(), FLUSH_EVERY_MS)
    } else {
      if (this.timer) clearInterval(this.timer)
      this.timer = null
      this.queue = []
      this.write()
    }
  }

  track(name: string, input: TrackInput) {
    if (!this.enabled) return
    try {
      const now = this.deps.now()
      if (!this.sessionId || now - this.lastActivity > SESSION_IDLE_MS)
        this.sessionId = this.deps.uid()
      this.lastActivity = now
      this.queue.push({
        event_id: `evt_${this.deps.uid()}`,
        name,
        occurred_at: now,
        client_id: this.client(),
        session_id: this.sessionId,
        ...input,
      })
      if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE)
      this.write()
    } catch {
      // never let tracking break the app
    }
  }

  /** Sends what is queued, oldest first, one batch at a time. */
  async flush(opts: { keepalive?: boolean } = {}) {
    if (!this.enabled || this.flushing || this.queue.length === 0) return
    this.flushing = true
    try {
      while (this.enabled && this.queue.length > 0) {
        const batch = this.queue.slice(0, BATCH)
        let result: SendResult
        try {
          result = await this.deps.send(batch, { keepalive: !!opts.keepalive })
        } catch {
          result = 'retry'
        }
        if (result === 'retry') return
        const sent = new Set(batch.map((e) => e.event_id))
        this.queue = this.queue.filter((e) => !sent.has(e.event_id))
        this.write()
      }
    } finally {
      this.flushing = false
    }
  }

  /** Time since the last tracked activity, for deciding if the app was away long enough to count as a resume. */
  idleMs(): number {
    return this.lastActivity ? this.deps.now() - this.lastActivity : Infinity
  }

  private client(): string {
    if (this.clientId) return this.clientId
    let id = ''
    try {
      id = this.deps.storage?.getItem(CLIENT_KEY) ?? ''
    } catch {}
    if (!id) {
      id = this.deps.uid()
      try {
        this.deps.storage?.setItem(CLIENT_KEY, id)
      } catch {}
    }
    this.clientId = id
    return id
  }

  private load(): TrackedEvent[] {
    try {
      const raw = this.deps.storage?.getItem(QUEUE_KEY)
      const parsed = raw ? (JSON.parse(raw) as unknown) : []
      return Array.isArray(parsed) ? (parsed as TrackedEvent[]).slice(-MAX_QUEUE) : []
    } catch {
      return []
    }
  }

  private write() {
    try {
      if (this.queue.length === 0) this.deps.storage?.removeItem(QUEUE_KEY)
      else this.deps.storage?.setItem(QUEUE_KEY, JSON.stringify(this.queue))
    } catch {
      // storage can be full or blocked; the in-memory queue still works
    }
  }
}
