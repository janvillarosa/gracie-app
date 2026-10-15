// The server's limits, checked before anything is queued so the person is told what is wrong
// where they are typing, instead of the change being undone later.
export const LIMITS = {
  titleRunes: 200,
  itemNotesBytes: 2048,
  tripNotesBytes: 16384,
  todos: 150,
  todosWarnAt: 140,
  bookings: 50,
}

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null

/** Bytes as the server counts them (UTF-8). */
export const byteLength = (s: string) =>
  encoder ? encoder.encode(s).length : unescape(encodeURIComponent(s)).length

/** Characters as people count them (a pair of surrogates is one). */
export const runeCount = (s: string) => [...s].length

export const titleProblem = (s: string): string =>
  runeCount(s) > LIMITS.titleRunes ? `Titles can be up to ${LIMITS.titleRunes} characters.` : ''

export const notesProblem = (s: string, maxBytes: number): string =>
  byteLength(s) > maxBytes
    ? `That note is too long (${byteLength(s).toLocaleString('en')} of ${maxBytes.toLocaleString('en')} bytes). Shorten it to save.`
    : ''

/** The device's time zone as an IANA name, or nothing when the browser cannot say. */
export function deviceZone(): string | undefined {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone
    return z && z !== 'Etc/Unknown' ? z : undefined
  } catch {
    return undefined
  }
}
