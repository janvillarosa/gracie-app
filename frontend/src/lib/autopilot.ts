import type { AutopilotApplied, AutopilotReason } from '@api/types'

/** Why autopilot added something, in the House's words. */
export function reasonText(reason: AutopilotReason | undefined): string {
  const days = Number(reason?.params?.days)
  if (reason?.code !== 'every_days' || !Number.isFinite(days) || days <= 0) {
    return 'Added because you usually buy it around now'
  }
  if (days <= 1) return 'You buy it about every day'
  if (days === 7) return 'You buy it about every week'
  if (days % 7 === 0 && days <= 28) return `You buy it about every ${days / 7} weeks`
  return `You buy it about every ${days} days`
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** When the run is, as the slip says it: today, tomorrow, or its weekday. */
export function runDay(runAt: Date, now: Date): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((day(runAt) - day(now)) / 86_400_000)
  if (diff <= 0) return 'today'
  if (diff === 1) return 'tomorrow'
  return WEEKDAYS[runAt.getDay()]
}

/** "Added 4 for Saturday". */
export function addedLine(count: number, runAt: Date, now: Date): string {
  return `Added ${count} for ${runDay(runAt, now)}`
}

/** The actions for the latest planned run that are still waiting on the list. */
export function latestRun(
  applied: AutopilotApplied[],
): { runAt: string; actions: AutopilotApplied[] } | null {
  const waiting = applied.filter((a) => a.state === 'applied' && a.run_at)
  if (waiting.length === 0) return null
  const runAt = waiting.reduce((m, a) => (a.run_at > m ? a.run_at : m), waiting[0].run_at)
  return { runAt, actions: waiting.filter((a) => a.run_at === runAt) }
}

// The slip shows once per planned run: the run it was last closed for is remembered per list.
const seenKey = (listId: string) => `gracie_autopilot_seen_${listId}`

export function seenRun(listId: string): string | null {
  try {
    return localStorage.getItem(seenKey(listId))
  } catch {
    return null
  }
}

export function markRunSeen(listId: string, runAt: string): void {
  try {
    localStorage.setItem(seenKey(listId), runAt)
  } catch {
    // Private mode or blocked storage: the slip may show again, which is harmless.
  }
}
