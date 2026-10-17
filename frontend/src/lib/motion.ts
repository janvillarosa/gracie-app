// Motion tier. Every device gets the full choreography unless it shows it can't keep up; then
// `<html data-motion="lite">` trims what runs at once (styles.css and ui.css, "Motion tier:
// lite") and the JS effects scale down (no View Transition, a smaller confetti burst, no
// scroll-linked landing motion). Nothing changes on a device that holds its frame rate.
//
// Two ways in:
// - Static signals, read once at boot, for phones that are plainly small: Save-Data, two or
//   fewer cores, or Chromium's deviceMemory of 2 GB or less (4 GB with four or fewer cores).
//   Safari reports none of these, so iPhones only ever go lite by the frame check below.
// - The frame check: when a CSS animation starts, frames are timed for a short window. A
//   window counts as janky when more than a third of its frames were missed against the
//   screen's own cadence. Three janky windows out of the last six switch the tier to lite,
//   remembered for a week (a hot or Low Power phone recovers). Twenty smooth windows in a row
//   end the check, so a fast device stops paying for it.
//
// `?motion=full` or `?motion=lite` pins the tier on this device (for testing both).

export type MotionTier = 'full' | 'lite'

const KEY = 'gracie_motion'
const LITE_FOR_MS = 7 * 24 * 60 * 60 * 1000

type Nav = Navigator & {
  deviceMemory?: number
  connection?: { saveData?: boolean }
}

/** The tier the device's own signals ask for, before any frame is timed. */
export function staticTier(
  nav: Nav | undefined = globalThis.navigator as Nav | undefined,
): MotionTier {
  if (!nav) return 'full'
  if (nav.connection?.saveData) return 'lite'
  const cores = nav.hardwareConcurrency ?? 0
  const mem = nav.deviceMemory ?? 0
  if (cores > 0 && cores <= 2) return 'lite'
  if (mem > 0 && mem <= 2) return 'lite'
  if (mem > 0 && mem <= 4 && cores > 0 && cores <= 4) return 'lite'
  return 'full'
}

/** The current tier, as set on the document. */
export function motionTier(): MotionTier {
  if (typeof document === 'undefined') return 'full'
  return document.documentElement.dataset.motion === 'lite' ? 'lite' : 'full'
}

export const isLiteMotion = () => motionTier() === 'lite'

function setTier(t: MotionTier) {
  document.documentElement.dataset.motion = t
}

type Stored = { tier: MotionTier; pinned?: boolean; at: number }

function readStored(now: number): Stored | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Stored
    if (s.tier !== 'full' && s.tier !== 'lite') return null
    if (!s.pinned && now - s.at > LITE_FOR_MS) return null
    return s
  } catch {
    return null
  }
}

function writeStored(s: Stored | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch {}
}

/** Frames missed in one timed window, measured against the window's own cadence (its fastest
 *  quarter), so a 120 Hz screen, a 60 Hz screen and a phone in Low Power at 30 are each judged
 *  against themselves. Returns the share of frames that were missed. */
export function missedShare(deltas: number[]): number {
  if (deltas.length < 5) return 0
  const sorted = [...deltas].sort((a, b) => a - b)
  const cadence = Math.max(sorted[Math.floor((sorted.length - 1) / 4)], 4)
  let missed = 0
  for (const d of deltas) missed += Math.max(0, Math.round(d / cadence) - 1)
  return missed / (missed + deltas.length)
}

export const JANK_SHARE = 1 / 3
const WINDOW_MS = 500
const RECENT = 6
const JANKY_TO_LITE = 3
const SMOOTH_TO_STOP = 20

/** Keeps the last few windows and decides. Pure, so it can be tested without frames. */
export function createJudge() {
  const recent: boolean[] = []
  let smoothRun = 0
  return {
    /** Records one window; returns 'lite' to switch, 'stop' when the device has proved itself. */
    add(share: number): 'lite' | 'stop' | 'more' {
      const janky = share > JANK_SHARE
      recent.push(janky)
      if (recent.length > RECENT) recent.shift()
      smoothRun = janky ? 0 : smoothRun + 1
      if (recent.filter(Boolean).length >= JANKY_TO_LITE) return 'lite'
      if (smoothRun >= SMOOTH_TO_STOP) return 'stop'
      return 'more'
    },
  }
}

function watchFrames(onLite: () => void) {
  const judge = createJudge()
  let timing = false
  const time = () => {
    if (timing || document.hidden) return
    timing = true
    const deltas: number[] = []
    let last = 0
    const start = performance.now()
    const frame = (t: number) => {
      if (last) deltas.push(t - last)
      last = t
      if (t - start < WINDOW_MS && !document.hidden) {
        requestAnimationFrame(frame)
        return
      }
      timing = false
      if (document.hidden) return
      const verdict = judge.add(missedShare(deltas))
      if (verdict === 'more') return
      document.removeEventListener('animationstart', time, true)
      if (verdict === 'lite') onLite()
    }
    requestAnimationFrame(frame)
  }
  document.addEventListener('animationstart', time, true)
}

/** Sets the tier on the document before the app mounts, and starts the frame check. */
export function initMotion() {
  if (typeof document === 'undefined') return
  const now = Date.now()
  const pin = new URLSearchParams(location.search).get('motion')
  if (pin === 'full' || pin === 'lite') writeStored({ tier: pin, pinned: true, at: now })
  const stored = readStored(now)
  if (stored?.pinned) return setTier(stored.tier)
  if (stored?.tier === 'lite' || staticTier() === 'lite') return setTier('lite')
  setTier('full')
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  if (typeof requestAnimationFrame !== 'function') return
  watchFrames(() => {
    writeStored({ tier: 'lite', at: Date.now() })
    setTier('lite')
  })
}
