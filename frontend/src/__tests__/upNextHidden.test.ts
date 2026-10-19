import { hideUpNext, isUpNextHidden } from '@lib/upNextHidden'

const H = 60 * 60_000

describe('upNextHidden', () => {
  beforeEach(() => localStorage.clear())

  it('is not hidden until the person puts it away', () => {
    expect(isUpNextHidden('l1', 'run-a', 0)).toBe(false)
  })

  it('stays hidden for the same run, across reloads', () => {
    hideUpNext('l1', 'run-a', 0)
    expect(isUpNextHidden('l1', 'run-a', 3 * H)).toBe(true)
  })

  it('comes back for the next run', () => {
    hideUpNext('l1', 'run-a', 0)
    expect(isUpNextHidden('l1', 'run-b', 1000)).toBe(false)
  })

  it('lapses after 12 hours even for the same run key', () => {
    hideUpNext('l1', 'window-2026-10-19', 0)
    expect(isUpNextHidden('l1', 'window-2026-10-19', 12 * H + 1)).toBe(false)
  })

  it('is per list', () => {
    hideUpNext('l1', 'run-a', 0)
    expect(isUpNextHidden('l2', 'run-a', 1000)).toBe(false)
  })

  it('survives storage that throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(isUpNextHidden('l1', 'run-a', 0)).toBe(false)
    spy.mockRestore()
  })
})
