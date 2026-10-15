// Typing a time. "9", "930", "9:30", "0930", "14.15" and "2:30pm" all mean something; anything
// else means nothing (null), and the field puts the old time back.

const pad = (n: number) => String(n).padStart(2, '0')

/** "09:30" for what was typed, or null when it is not a time of day. */
export function parseClock(text: string): string | null {
  const m = /^\s*(\d{1,2})(?:[:.]?(\d{2}))?\s*([ap]m?)?\s*$/i.exec(text)
  if (!m) return null
  // "930" and "0930" are four/three digits with no separator: split them from the right.
  let h = Number(m[1])
  let min = m[2] === undefined ? 0 : Number(m[2])
  if (m[2] === undefined) {
    const digits = text.replace(/\D/g, '')
    if (digits.length === 3) {
      h = Number(digits.slice(0, 1))
      min = Number(digits.slice(1))
    } else if (digits.length === 4) {
      h = Number(digits.slice(0, 2))
      min = Number(digits.slice(2))
    }
  }
  const ap = m[3]?.toLowerCase()
  if (ap) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (ap.startsWith('p') ? 12 : 0)
  }
  if (h > 23 || min > 59) return null
  return `${pad(h)}:${pad(min)}`
}

/** The time `delta` minutes from `time`, wrapping around midnight; with no time, 09:00. */
export function stepClock(time: string | null | undefined, delta: number): string {
  const p = time ? parseClock(time) : null
  if (!p) return '09:00'
  const [h, m] = p.split(':').map(Number)
  const total = (((h * 60 + m + delta) % 1440) + 1440) % 1440
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}
