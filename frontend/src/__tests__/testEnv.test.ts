// The test environment itself (src/setupTests.ts). Frames used to stop for good after a test asked
// for one while it faked timers, and every later rAF-driven test (focus, sign-out) then timed out.

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r))

describe('animation frames in tests', () => {
  it('keep running after a test that asked for one under fake timers', async () => {
    vi.useFakeTimers()
    requestAnimationFrame(() => {})
    vi.useRealTimers()
    await expect(nextFrame()).resolves.toEqual(expect.any(Number))
  })

  it('follow the fake clock while it is installed', () => {
    vi.useFakeTimers()
    const cb = vi.fn()
    requestAnimationFrame(cb)
    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(17)
    expect(cb).toHaveBeenCalledOnce()
  })

  it('can be cancelled, under either clock', async () => {
    vi.useFakeTimers()
    const fake = vi.fn()
    cancelAnimationFrame(requestAnimationFrame(fake))
    vi.advanceTimersByTime(50)
    vi.useRealTimers()
    const real = vi.fn()
    cancelAnimationFrame(requestAnimationFrame(real))
    await nextFrame()
    await nextFrame()
    expect(fake).not.toHaveBeenCalled()
    expect(real).not.toHaveBeenCalled()
  })
})
