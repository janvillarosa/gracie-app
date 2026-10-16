import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLUSH_EVERY_MS, Tracker, type SendResult, type TrackedEvent } from '@lib/analytics/tracker'

const subject = { type: 'list', id: 'list_1' }

function memStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & {
  data: Map<string, string>
} {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

function setup(result: SendResult = 'ok') {
  let t = 1_000_000
  let n = 0
  const storage = memStorage()
  const sent: TrackedEvent[][] = []
  const send = vi.fn(async (events: TrackedEvent[]) => {
    sent.push(events)
    return result
  })
  const tracker = new Tracker({ now: () => t, uid: () => `id${++n}`, send, storage })
  return {
    tracker,
    storage,
    sent,
    send,
    advance: (ms: number) => (t += ms),
    setResult: (r: SendResult) =>
      send.mockImplementation(async (e) => {
        sent.push(e)
        return r
      }),
  }
}

describe('Tracker', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('records nothing until enabled, and forgets everything when disabled', () => {
    const { tracker, storage } = setup()
    tracker.track('list.view', { subject })
    expect(storage.data.size).toBe(0)
    tracker.setEnabled(true)
    tracker.track('list.view', { subject })
    expect(storage.data.get('gracie_events_q')).toContain('list.view')
    tracker.setEnabled(false)
    expect(storage.data.has('gracie_events_q')).toBe(false)
  })

  it('sends queued events, oldest first, then empties the queue', async () => {
    const { tracker, sent, storage } = setup()
    tracker.setEnabled(true)
    tracker.track('app.open', { subject: { type: 'app', id: 'web' } })
    tracker.track('list.view', { subject })
    await tracker.flush()
    expect(sent).toHaveLength(1)
    expect(sent[0].map((e) => e.name)).toEqual(['app.open', 'list.view'])
    expect(sent[0][0].event_id).toMatch(/^evt_/)
    expect(storage.data.has('gracie_events_q')).toBe(false)
  })

  it('keeps events queued when the send should be retried', async () => {
    const { tracker, storage } = setup('retry')
    tracker.setEnabled(true)
    tracker.track('list.view', { subject })
    await tracker.flush()
    expect(storage.data.get('gracie_events_q')).toContain('list.view')
  })

  it('drops a batch the server will never accept', async () => {
    const { tracker, storage } = setup('drop')
    tracker.setEnabled(true)
    tracker.track('list.view', { subject })
    await tracker.flush()
    expect(storage.data.has('gracie_events_q')).toBe(false)
  })

  it('restores the queue after a reload and does not double-send', async () => {
    const a = setup('retry')
    a.tracker.setEnabled(true)
    a.tracker.track('list.view', { subject })
    await a.tracker.flush()
    const b = new Tracker({
      now: () => 2_000_000,
      uid: () => 'x',
      send: async (e) => (a.sent.push(e), 'ok'),
      storage: a.storage,
    })
    b.setEnabled(true)
    await b.flush()
    const ids = a.sent.flat().map((e) => e.event_id)
    expect(new Set(ids).size).toBe(1) // same event id both times: the server dedupes retries
  })

  it('caps the queue and sends in batches of 50', async () => {
    const { tracker, sent } = setup()
    tracker.setEnabled(true)
    for (let i = 0; i < 260; i++) tracker.track('list.view', { subject })
    await tracker.flush()
    expect(sent.map((b) => b.length)).toEqual([50, 50, 50, 50])
  })

  it('rotates the session after 30 idle minutes', () => {
    const { tracker, sent, advance } = setup()
    tracker.setEnabled(true)
    tracker.track('list.view', { subject })
    advance(10 * 60_000)
    tracker.track('list.view', { subject })
    advance(31 * 60_000)
    tracker.track('list.view', { subject })
    void tracker.flush()
    const s = sent[0].map((e) => e.session_id)
    expect(s[0]).toBe(s[1])
    expect(s[2]).not.toBe(s[1])
  })

  it('flushes on a timer while enabled', async () => {
    const { tracker, send } = setup()
    tracker.setEnabled(true)
    tracker.track('list.view', { subject })
    await vi.advanceTimersByTimeAsync(FLUSH_EVERY_MS)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('survives storage that throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      },
      removeItem: () => {},
    }
    const tracker = new Tracker({
      now: () => 1,
      uid: () => 'u',
      send: async () => 'ok',
      storage: throwing,
    })
    expect(() => {
      tracker.setEnabled(true)
      tracker.track('list.view', { subject })
    }).not.toThrow()
  })

  it('never lets a failing send break the caller', async () => {
    const tracker = new Tracker({
      now: () => 1,
      uid: () => 'u',
      send: async () => {
        throw new Error('boom')
      },
      storage: null,
    })
    tracker.setEnabled(true)
    tracker.track('list.view', { subject })
    await expect(tracker.flush()).resolves.toBeUndefined()
  })
})
