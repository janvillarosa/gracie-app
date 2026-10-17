import type { RunHint } from '@api/types'
import {
  DEFAULT_RUN_HINT,
  initialRun,
  type RunState,
  runReducer,
  CHEERS,
  pickCheer,
  runDoneLines,
  useShoppingRun,
} from '@lib/shoppingRun'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const MIN = 60_000
const T = Date.UTC(2026, 9, 17, 10, 0, 0)

function checks(hint: RunHint, ...atMs: number[]): RunState {
  const step = runReducer(hint)
  return atMs.reduce((s, at) => step(s, { type: 'check', at: T + at }), initialRun)
}

const hint = (over: Partial<RunHint>): RunHint => ({ ...DEFAULT_RUN_HINT, ...over })

describe('runReducer', () => {
  it('starts a run on the third check by default', () => {
    expect(checks(DEFAULT_RUN_HINT, 0, MIN).active).toBe(false)
    const s = checks(DEFAULT_RUN_HINT, 0, MIN, 2 * MIN)
    expect(s.active).toBe(true)
    expect(s.startedAt).toBe(T)
    expect(s.runChecks).toBe(3)
  })

  it('uses the hint: two checks at a usual time, four at an odd one', () => {
    expect(checks(hint({ checks_to_start: 2 }), 0, MIN).active).toBe(true)
    expect(checks(hint({ checks_to_start: 4 }), 0, MIN, 2 * MIN).active).toBe(false)
    expect(checks(hint({ checks_to_start: 4 }), 0, MIN, 2 * MIN, 3 * MIN).active).toBe(true)
  })

  it('burst does not start a run', () => {
    // Ticking things off at home after unpacking: three checks inside ten seconds.
    expect(checks(DEFAULT_RUN_HINT, 0, 4_000, 9_000).active).toBe(false)
    // A real check two minutes later makes it a run.
    const s = checks(DEFAULT_RUN_HINT, 0, 4_000, 9_000, 2 * MIN)
    expect(s.active).toBe(true)
    expect(s.runChecks).toBe(4)
  })

  it('checks further apart than the idle gap do not chain', () => {
    const h = hint({ idle_end_min: 15 })
    expect(checks(h, 0, 16 * MIN, 32 * MIN).active).toBe(false)
    expect(checks(h, 0, 14 * MIN, 28 * MIN).active).toBe(true)
  })

  it('ends the run once the idle gap passes with no check', () => {
    const h = hint({ idle_end_min: 20 })
    const step = runReducer(h)
    let s = checks(h, 0, MIN, 2 * MIN)
    s = step(s, { type: 'stamped' })
    s = step(s, { type: 'tick', at: T + 10 * MIN })
    expect(s.active).toBe(true)
    s = step(s, { type: 'tick', at: T + 23 * MIN })
    expect(s).toEqual(initialRun)
  })

  it('a check after the idle gap starts counting again', () => {
    const h = hint({ idle_end_min: 20 })
    const step = runReducer(h)
    let s = checks(h, 0, MIN, 2 * MIN)
    s = step(s, { type: 'check', at: T + 60 * MIN })
    expect(s.active).toBe(false)
    expect(s.checks).toEqual([T + 60 * MIN])
  })

  it('marks the run stamped once', () => {
    const step = runReducer(DEFAULT_RUN_HINT)
    const s = step(checks(DEFAULT_RUN_HINT, 0, MIN, 2 * MIN), { type: 'stamped' })
    expect(s.stamped).toBe(true)
    expect(step(s, { type: 'check', at: T + 3 * MIN }).stamped).toBe(true)
  })
})

describe('useShoppingRun', () => {
  afterEach(() => vi.useRealTimers())

  it('no hint uses defaults, and minutes run from the first to the last check', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T)
    const { result } = renderHook(() => useShoppingRun(undefined))
    act(() => result.current.check())
    vi.setSystemTime(T + 4 * MIN)
    act(() => result.current.check())
    expect(result.current.active).toBe(false)
    vi.setSystemTime(T + 11 * MIN)
    act(() => result.current.check())
    expect(result.current.active).toBe(true)
    expect(result.current.runChecks).toBe(3)
    expect(result.current.minutes).toBe(11)
  })

  it('ends on its own after the idle gap', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T)
    const { result } = renderHook(() =>
      useShoppingRun(hint({ checks_to_start: 2, idle_end_min: 15 })),
    )
    act(() => result.current.check())
    vi.setSystemTime(T + MIN)
    act(() => result.current.check())
    expect(result.current.active).toBe(true)
    act(() => {
      vi.advanceTimersByTime(16 * MIN)
    })
    expect(result.current.active).toBe(false)
  })
})

describe('runDoneLines', () => {
  it('says how many items and how long', () => {
    expect(runDoneLines(14, 22)).toEqual(['Run done', '14 items · 22 min'])
  })
  it('drops the minutes under one', () => {
    expect(runDoneLines(5, 0)).toEqual(['Run done', '5 items'])
  })
  it('says one item, not one items', () => {
    expect(runDoneLines(1, 3)).toEqual(['Run done', '1 item · 3 min'])
  })
  it('praises a run at least three minutes quicker than usual', () => {
    expect(runDoneLines(14, 18, { minutes: 22 })).toEqual([
      'Run done',
      '14 items · 18 min',
      '4 min quicker than usual',
    ])
  })
  it('never mentions a run that was only a little quicker, or slower', () => {
    expect(runDoneLines(14, 20, { minutes: 22 })).toHaveLength(2)
    expect(runDoneLines(14, 30, { minutes: 22 })).toHaveLength(2)
  })
})

describe('pickCheer', () => {
  it('says something from the list', () => {
    expect(CHEERS).toEqual(expect.arrayContaining(['Nice!', 'Huzzah!', 'Amazing!']))
    for (const r of [0, 0.3, 0.6, 0.999]) expect(CHEERS).toContain(pickCheer(() => r))
  })

  it('never says the same thing twice in a row', () => {
    for (const previous of CHEERS) {
      for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
        expect(pickCheer(() => r, previous)).not.toBe(previous)
      }
    }
  })

  it('every cheer can come up', () => {
    const seen = new Set(CHEERS.map((_, i) => pickCheer(() => i / CHEERS.length)))
    expect(seen.size).toBe(CHEERS.length)
  })
})
