// Mirrors backend/internal/parse/similar.go so the browser folds names the way the pantry
// does. Keep the two in step (itemKey.test.ts repeats the Go cases).

/** Lowercased, with spaces and hyphens dropped and simple plurals made singular. */
export function compactKey(name: string): string {
  return name
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(singular)
    .join('')
}

function singular(w: string): string {
  if (w.length <= 3) return w
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`
  if (['sses', 'ches', 'shes', 'xes', 'zes', 'oes'].some((s) => w.endsWith(s))) {
    return w.slice(0, -2)
  }
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) {
    return w.slice(0, -1)
  }
  return w
}

export function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  let cur = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]
}
