// Up next is put away for one run, per list, on this device: no server call, nothing the forecast
// ever sees. The key says which run it was put away for (the server's run start, or the day's usual
// window when no run has begun), so a reload is not a new run but the next shop is. A put-away
// never outlives 12 hours. Storage can be blocked or full; then it simply is not remembered.
const HIDE_FOR_MS = 12 * 60 * 60_000

const storageKey = (listId: string) => `gracie_up_next_hidden_${listId}`

export function hideUpNext(listId: string, runKey: string, now: number): void {
  try {
    localStorage.setItem(storageKey(listId), JSON.stringify({ runKey, at: now }))
  } catch {
    // not remembered
  }
}

export function isUpNextHidden(listId: string, runKey: string, now: number): boolean {
  try {
    const raw = localStorage.getItem(storageKey(listId))
    if (!raw) return false
    const v = JSON.parse(raw) as { runKey?: string; at?: number }
    return v.runKey === runKey && typeof v.at === 'number' && now - v.at <= HIDE_FOR_MS
  } catch {
    return false
  }
}
