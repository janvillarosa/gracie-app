import { RubberStamp } from '@components/ui'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const motion = (reduce: boolean) =>
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (q: string) =>
      ({
        matches: reduce && q.includes('reduce'),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  )

describe('RubberStamp', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('announces its lines politely and leaves after the hold', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    render(<RubberStamp title="Run done" lines={['14 items · 22 min']} onDone={onDone} />)
    const stamp = screen.getByRole('status')
    expect(stamp).toHaveTextContent('Run done')
    expect(stamp).toHaveTextContent('14 items · 22 min')
    act(() => {
      vi.advanceTimersByTime(2400)
    })
    expect(onDone).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('a tap dismisses it', async () => {
    const onDone = vi.fn()
    render(<RubberStamp title="Run done" lines={[]} onDone={onDone} holdMs={60_000} />)
    await userEvent.click(screen.getByRole('status'))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('lands without the press under reduced motion', () => {
    motion(true)
    render(<RubberStamp title="Run done" lines={[]} onDone={() => {}} />)
    expect(screen.getByRole('status')).toHaveClass('is-still')
  })
})
