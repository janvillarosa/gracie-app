// After logging in, the logo plays a short welcome (the window lights up, the door swings
// open and shut) wherever it first appears. Pages remount the top bar as their data loads,
// so this is a time window rather than a one-shot flag: a logo that mounts partway through
// picks the animation up where it is instead of restarting or cutting off.
export const WELCOME_MS = 1600

let startedAt: number | null = null

export function startWelcome() {
  startedAt = performance.now()
}

// Milliseconds into the welcome, or null when there is none to play.
export function welcomeElapsed(): number | null {
  if (startedAt === null) return null
  const t = performance.now() - startedAt
  if (t >= WELCOME_MS) {
    startedAt = null
    return null
  }
  return t
}
