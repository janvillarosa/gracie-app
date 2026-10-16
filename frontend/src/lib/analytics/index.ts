import { apiFetch, type ApiError } from '@api/client'
import {
  RESUME_AFTER_MS,
  Tracker,
  type SendResult,
  type TrackedEvent,
  type TrackInput,
} from './tracker'

let apiKey: string | null = null

function randomId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '')
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

async function send(events: TrackedEvent[], opts: { keepalive: boolean }): Promise<SendResult> {
  if (!apiKey) return 'drop'
  try {
    await apiFetch('/events', {
      method: 'POST',
      apiKey,
      body: JSON.stringify({ events }),
      keepalive: opts.keepalive,
    })
    return 'ok'
  } catch (e) {
    const status = (e as ApiError).status
    // No status means the network failed; 408/429/5xx are worth another try. Other 4xx will
    // never succeed (a stale build, a bad event), so the batch is dropped rather than retried forever.
    if (status === undefined || status === 408 || status === 429 || status >= 500) return 'retry'
    return 'drop'
  }
}

export const tracker = new Tracker({ now: Date.now, uid: randomId, send, storage: safeStorage() })

/** Called by AuthProvider whenever the signed-in key changes. */
export function setAnalyticsKey(key: string | null) {
  apiKey = key
  tracker.setEnabled(!!key)
}

export const track = (name: string, input: TrackInput) => tracker.track(name, input)

let listening = false

/** Emits app.open once, app.resume after a long absence, and flushes when the page is hidden. */
export function startAppTracking() {
  if (listening || typeof document === 'undefined') return
  listening = true
  track('app.open', { subject: { type: 'app', id: 'web' } })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void tracker.flush({ keepalive: true })
    } else if (tracker.idleMs() > RESUME_AFTER_MS) {
      track('app.resume', { subject: { type: 'app', id: 'web' } })
    }
  })
  window.addEventListener('online', () => void tracker.flush())
}
