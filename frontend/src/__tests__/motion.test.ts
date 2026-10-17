import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createJudge,
  initMotion,
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

describe('staticTier', () => {
  it('keeps the full tier when the device says nothing (Safari) or is capable', () => {
    expect(staticTier(nav({}))).toBe('full')
    expect(staticTier(nav({ hardwareConcurrency: 6 }))).toBe('full')
    expect(staticTier(nav({ hardwareConcurrency: 8, deviceMemory: 8 }))).toBe('full')
    expect(staticTier(nav({ hardwareConcurrency: 8, deviceMemory: 4 }))).toBe('full')
    expect(staticTier(nav({ hardwareConcurrency: 4 }))).toBe('full')
  })

  it('goes lite for Save-Data, two cores, 2 GB, or 4 GB with four cores', () => {
    expect(staticTier(nav({ connection: { saveData: true } }))).toBe('lite')
    expect(staticTier(nav({ hardwareConcurrency: 2 }))).toBe('lite')
    expect(staticTier(nav({ hardwareConcurrency: 8, deviceMemory: 2 }))).toBe('lite')
    expect(staticTier(nav({ hardwareConcurrency: 4, deviceMemory: 4 }))).toBe('lite')
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
  it('switches to lite after three janky windows among the last six', () => {
    const j = createJudge()
    expect(j.add(0.5)).toBe('more')
    expect(j.add(0)).toBe('more')
    expect(j.add(0.5)).toBe('more')
    expect(j.add(0.5)).toBe('lite')
  })

  it('forgets janky windows older than the last six', () => {
    const j = createJudge()
    j.add(0.5)
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
