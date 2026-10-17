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
  /** The category of each check in `checks`, in step with it (undefined: none was set). */
  categories: (string | undefined)[]
  active: boolean
  startedAt?: number
  runChecks: number
  stamped: boolean
}

export type RunEvent =
  | { type: 'check'; at: number; category?: string }
  | { type: 'tick'; at: number }
  | { type: 'stamped' }

export const initialRun: RunState = {
  checks: [],
  categories: [],
  active: false,
  runChecks: 0,
  stamped: false,
}

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
        const categories = fresh ? [e.category] : [...s.categories, e.category]
        if (!fresh && s.active) {
          return { ...s, checks: chain, categories, runChecks: chain.length }
        }
        const k = Math.max(1, hint.checks_to_start)
        if (chain.length < k) return { ...initialRun, checks: chain, categories }
        // Checks faster than anyone shops are tidying up at home, not a run.
        const recent = chain.slice(-k)
        const tidying =
          recent.length > 1 && recent.every((t, i) => i === 0 || t - recent[i - 1] < burst)
        if (tidying) return { ...initialRun, checks: chain, categories }
        return {
          checks: chain,
          categories,
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

  const check = useCallback(
    (category?: string) => dispatch({ type: 'check', at: Date.now(), category }),
    [],
  )
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
    categories: state.categories,
    check,
    markStamped,
  }
}

/** What the run-done slip says. A run noticeably quicker than usual gets a word of praise; a slow
 *  one gets nothing (the slip is a reward, not a report card). */
export function runDoneLines(
  runChecks: number,
  minutes: number,
  typical?: { minutes: number },
): string[] {
  const items = `${runChecks} ${runChecks === 1 ? 'item' : 'items'}`
  const lines = ['Run done', minutes >= 1 ? `${items} · ${minutes} min` : items]
  const quicker = typical ? typical.minutes - minutes : 0
  if (quicker >= 3) lines.push(`${quicker} min quicker than usual`)
  return lines
}

/** What a run got, as categories with counts: biggest first, ties in the order first seen, at most
 *  four. A check with no category counts as General. */
export function tallyCategories(
  categories: (string | undefined)[],
): { label: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const c of categories) {
    const label = c?.trim() || 'General'
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
}
