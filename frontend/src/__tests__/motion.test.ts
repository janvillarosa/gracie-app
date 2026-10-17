import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createJudge,
  initMotion,
  isIPhone,
  isLiteMotion,
  JANK_SHARE,
  missedShare,
  staticTier,
} from '@lib/motion'
import { withViewTransition } from '@lib/viewTransition'

const nav = (n: Record<string, unknown>) => n as unknown as Navigator

afterEach(() => {
  delete document.documentElement.dataset.motion
  localStorage.removeItem('gracie_motion')
  window.history.replaceState(null, '', '/')
  delete (document as { startViewTransition?: unknown }).startViewTransition
})

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1'
const IPAD_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'

describe('staticTier', () => {
  it('keeps the full tier on a capable desktop, iPad or Android phone', () => {
    expect(staticTier(nav({}))).toBe('full')
    expect(staticTier(nav({ userAgent: IPAD_DESKTOP, hardwareConcurrency: 8 }))).toBe('full')
    expect(staticTier(nav({ userAgent: ANDROID, hardwareConcurrency: 8, deviceMemory: 8 }))).toBe(
      'full',
    )
    expect(staticTier(nav({ hardwareConcurrency: 6 }))).toBe('full')
  })

  it('goes lite on every iPhone, in any iOS browser', () => {
    expect(isIPhone(IPHONE_SAFARI)).toBe(true)
    expect(isIPhone(IPHONE_CHROME)).toBe(true)
    expect(isIPhone(IPAD_DESKTOP)).toBe(false)
    expect(isIPhone(ANDROID)).toBe(false)
    // WebKit reports no memory and a capped core count, so the model never matters.
    expect(staticTier(nav({ userAgent: IPHONE_SAFARI, hardwareConcurrency: 8 }))).toBe('lite')
  })

  it('goes lite for Save-Data, four or fewer cores, or 4 GB or less', () => {
    expect(staticTier(nav({ connection: { saveData: true } }))).toBe('lite')
    expect(staticTier(nav({ hardwareConcurrency: 4 }))).toBe('lite')
    expect(staticTier(nav({ hardwareConcurrency: 8, deviceMemory: 4 }))).toBe('lite')
    expect(staticTier(nav({ hardwareConcurrency: 8, deviceMemory: 2 }))).toBe('lite')
  })
})

describe('missedShare', () => {
  it('is zero for a steady cadence at any refresh rate', () => {
    expect(missedShare(Array(30).fill(16.7))).toBe(0)
    expect(missedShare(Array(60).fill(8.3))).toBe(0)
    // Low Power Mode: a steady 30 fps is the phone's cadence, not jank.
    expect(missedShare(Array(15).fill(33.3))).toBe(0)
  })

  it('counts frames skipped against the window’s own cadence', () => {
    // 20 good frames and 10 that each missed one frame: 10 missed of 40.
    const d = [...Array(20).fill(16.7), ...Array(10).fill(33.4)]
    expect(missedShare(d)).toBeCloseTo(10 / 40)
    // One long stall of six frames among a few good ones is janky.
    expect(missedShare([16.7, 16.7, 16.7, 16.7, 16.7, 116.9])).toBeGreaterThan(JANK_SHARE)
  })

  it('ignores windows too short to judge', () => {
    expect(missedShare([16.7, 200])).toBe(0)
  })
})

describe('createJudge', () => {
  it('switches to lite after two janky windows among the last six', () => {
    const j = createJudge()
    expect(j.add(0.25)).toBe('more')
    expect(j.add(0)).toBe('more')
    expect(j.add(0.25)).toBe('lite')
  })

  it('counts a window as janky once more than a fifth of its frames were missed', () => {
    const j = createJudge()
    expect(j.add(0.2)).toBe('more')
    expect(j.add(0.2)).toBe('more')
    expect(j.add(0.21)).toBe('more')
    expect(j.add(0.21)).toBe('lite')
  })

  it('forgets janky windows older than the last six', () => {
    const j = createJudge()
    j.add(0.5)
    for (let i = 0; i < 6; i++) expect(j.add(0)).toBe('more')
    expect(j.add(0.5)).toBe('more')
  })

  it('stops checking a device after twenty smooth windows in a row', () => {
    const j = createJudge()
    for (let i = 0; i < 19; i++) expect(j.add(0.1)).toBe('more')
    expect(j.add(0.1)).toBe('stop')
  })
})

describe('initMotion', () => {
  // jsdom reports the host's cores; a small CI runner must not read as a small phone.
  beforeEach(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8, configurable: true })
  })
  afterEach(() => {
    delete (navigator as { hardwareConcurrency?: number }).hardwareConcurrency
  })

  it('starts on the full tier on a capable device', () => {
    initMotion()
    expect(document.documentElement.dataset.motion).toBe('full')
    expect(isLiteMotion()).toBe(false)
  })

  it('keeps a remembered lite verdict for a week, then checks again', () => {
    const now = Date.now()
    localStorage.setItem('gracie_motion', JSON.stringify({ tier: 'lite', at: now - 1000 }))
    initMotion()
    expect(isLiteMotion()).toBe(true)

    localStorage.setItem(
      'gracie_motion',
      JSON.stringify({ tier: 'lite', at: now - 8 * 24 * 60 * 60 * 1000 }),
    )
    initMotion()
    expect(isLiteMotion()).toBe(false)
  })

  it('lets ?motion= pin either tier on this device', () => {
    window.history.replaceState(null, '', '/?motion=lite')
    initMotion()
    expect(isLiteMotion()).toBe(true)
    window.history.replaceState(null, '', '/')
    initMotion()
    expect(isLiteMotion()).toBe(true)

    window.history.replaceState(null, '', '/?motion=full')
    initMotion()
    expect(isLiteMotion()).toBe(false)
  })
})

describe('withViewTransition on the lite tier', () => {
  it('updates in place without a View Transition', () => {
    const start = vi.fn()
    ;(document as { startViewTransition?: unknown }).startViewTransition = start
    document.documentElement.dataset.motion = 'lite'
    const update = vi.fn()
    withViewTransition(update)
    expect(update).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
  })
})
