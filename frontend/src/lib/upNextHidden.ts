// Up next is put away for one run, per list, on this device: no server call, nothing the forecast
// ever sees. The key says which run it was put away for (the server's run start, or the day's usual
// window when no run has begun), so a reload is not a new run but the next shop is. A put-away
// never outlives 12 hours. Storage can be blocked or full; then it simply is not remembered.
const HIDE_FOR_MS = 12 * 60 * 60_000
// A hide made before any check-off is keyed to the day's usual window. When a run then starts, the
// key becomes the run's start, but it is the same shop if the run began shortly around the hide.
const SAME_SHOP_BEFORE_MS = 45 * 60_000 // the server's run gap
const SAME_SHOP_AFTER_MS = 2 * 60 * 60_000

const storageKey = (listId: string) => `gracie_up_next_hidden_${listId}`

export function hideUpNext(listId: string, runKey: string, now: number): void {
  try {
    localStorage.setItem(storageKey(listId), JSON.stringify({ runKey, at: now }))
  } catch {
    // not remembered
  }
}

/** runStartedAt (ms) is when the server's current run began, if one has: it lets a hide made
 *  before the run (keyed to the window) carry into it. */
export function isUpNextHidden(
  listId: string,
  runKey: string,
  now: number,
  runStartedAt?: number,
): boolean {
  try {
    const raw = localStorage.getItem(storageKey(listId))
    if (!raw) return false
    const v = JSON.parse(raw) as { runKey?: string; at?: number }
    if (typeof v.at !== 'number' || now - v.at > HIDE_FOR_MS) return false
    if (v.runKey === runKey) return true
    return (
      !!v.runKey?.startsWith('window-') &&
      runStartedAt !== undefined &&
      runStartedAt >= v.at - SAME_SHOP_BEFORE_MS &&
      runStartedAt <= v.at + SAME_SHOP_AFTER_MS
    )
  } catch {
    return false
  }
}
