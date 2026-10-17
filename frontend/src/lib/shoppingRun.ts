import type { RunHint } from '@api/types'
import { useCallback, useEffect, useReducer, useRef } from 'react'

// Spotting a shopping run from live check-offs. The server's run hint (learned habits) sets the
// thresholds; without one the rule is the server's own: predict.RunMin checks with no pause over
// predict.RunGap (backend/internal/analytics/predict/rhythm.go).
export const DEFAULT_RUN_HINT: RunHint = {
  likely: 'unknown',
  checks_to_start: 3,
  idle_end_min: 45,
  burst_sec: 15,
}

export type RunState = {
  /** This visit's check times (ms) that still chain: no gap longer than the idle gap. */
  checks: number[]
  active: boolean
  startedAt?: number
  runChecks: number
  stamped: boolean
}

export type RunEvent =
  | { type: 'check'; at: number }
  | { type: 'tick'; at: number }
  | { type: 'stamped' }

export const initialRun: RunState = { checks: [], active: false, runChecks: 0, stamped: false }

const MIN = 60_000

export function runReducer(hint: RunHint) {
  const idle = hint.idle_end_min * MIN
  const burst = hint.burst_sec * 1000
  return (s: RunState, e: RunEvent): RunState => {
    const last = s.checks[s.checks.length - 1]
    const lapsed = (at: number) => last !== undefined && at - last > idle
    switch (e.type) {
      case 'stamped':
        return s.active ? { ...s, stamped: true } : s
      case 'tick':
        return s.active && lapsed(e.at) ? initialRun : s
      case 'check': {
        const fresh = lapsed(e.at)
        const chain = fresh ? [e.at] : [...s.checks, e.at]
        if (!fresh && s.active) {
          return { ...s, checks: chain, runChecks: chain.length }
        }
        const k = Math.max(1, hint.checks_to_start)
        if (chain.length < k) return { ...initialRun, checks: chain }
        // Checks faster than anyone shops are tidying up at home, not a run.
        const recent = chain.slice(-k)
        const tidying =
          recent.length > 1 && recent.every((t, i) => i === 0 || t - recent[i - 1] < burst)
        if (tidying) return { ...initialRun, checks: chain }
        return {
          checks: chain,
          active: true,
          startedAt: chain[0],
          runChecks: chain.length,
          stamped: false,
        }
      }
    }
  }
}

/** Live shopping-run state for one list visit. Call `check()` for each item checked off (never for
 *  an uncheck); the run ends by itself once the idle gap passes. */
export function useShoppingRun(hint: RunHint | undefined) {
  const hintRef = useRef(hint ?? DEFAULT_RUN_HINT)
  hintRef.current = hint ?? DEFAULT_RUN_HINT
  const [state, dispatch] = useReducer(
    (s: RunState, e: RunEvent) => runReducer(hintRef.current)(s, e),
    initialRun,
  )

  useEffect(() => {
    if (!state.active) return
    const id = setInterval(() => dispatch({ type: 'tick', at: Date.now() }), 30_000)
    return () => clearInterval(id)
  }, [state.active])

  const stateRef = useRef(state)
  stateRef.current = state
  /** Records a check-off; says whether a run is on once it counts (the reducer is pure, so this is
   *  the state React will reach). */
  const check = useCallback(() => {
    const e = { type: 'check', at: Date.now() } as const
    dispatch(e)
    return runReducer(hintRef.current)(stateRef.current, e).active
  }, [])
  const markStamped = useCallback(() => dispatch({ type: 'stamped' }), [])
  const last = state.checks[state.checks.length - 1]
  const minutes =
    state.active && state.startedAt !== undefined && last !== undefined
      ? Math.round((last - state.startedAt) / MIN)
      : 0
  return {
    active: state.active,
    runChecks: state.runChecks,
    minutes,
    stamped: state.stamped,
    check,
    markStamped,
  }
}

// A run is compared with the usual one only when it is about as big (a top-up shop is not "quick").
const COMPARABLE_SHARE = 0.75

/** What the run-done announcement says. A run noticeably quicker than a usual run of its size gets a
 *  word of praise; a slow one gets nothing (it is a reward, not a report card). */
export function runDoneLines(
  runChecks: number,
  minutes: number,
  typical?: { minutes: number; items: number },
): string[] {
  const items = `${runChecks} ${runChecks === 1 ? 'item' : 'items'}`
  const lines = ['Run done', minutes >= 1 ? `${items} · ${minutes} min` : items]
  const comparable = !!typical && runChecks >= Math.ceil(typical.items * COMPARABLE_SHARE)
  const quicker = comparable && typical ? typical.minutes - minutes : 0
  if (quicker >= 3) lines.push(`${quicker} min quicker than usual`)
  return lines
}

/** What the run-done key says: a little cheer, different every run. */
export const CHEERS = [
  'Nice!',
  'Huzzah!',
  'Amazing!',
  'Woohoo!',
  'Ta-da!',
  'Sorted!',
  'Brilliant!',
  'All stocked!',
] as const

/** A random cheer, never the one said last time. */
export function pickCheer(rand: () => number = Math.random, previous?: string): string {
  const pool = CHEERS.filter((c) => c !== previous)
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))]
}

const LAST_CHEER_KEY = 'gracie_last_cheer'

/** The next cheer, remembered on this device so two runs in a row never say the same thing. */
export function nextCheer(): string {
  let previous: string | undefined
  try {
    previous = localStorage.getItem(LAST_CHEER_KEY) ?? undefined
  } catch {
    // storage blocked: any cheer will do
  }
  const cheer = pickCheer(Math.random, previous)
  try {
    localStorage.setItem(LAST_CHEER_KEY, cheer)
  } catch {
    // storage blocked: fine
  }
  return cheer
}
