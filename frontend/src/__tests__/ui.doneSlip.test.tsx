import { DoneSlip } from '@components/ui'
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

describe('DoneSlip', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('announces its lines politely and leaves after the hold', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    render(
      <DoneSlip
        title="Run done"
        lines={['14 items · 22 min', '4 min quicker than usual']}
        onDone={onDone}
      />,
    )
    const slip = screen.getByRole('status')
    expect(slip).toHaveTextContent('Run done')
    expect(slip).toHaveTextContent('14 items · 22 min')
    expect(slip).toHaveTextContent('4 min quicker than usual')
    act(() => {
      vi.advanceTimersByTime(2400)
    })
    expect(onDone).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('shows what the run got as category tags with counts', () => {
    render(
      <DoneSlip
        title="Run done"
        lines={['6 items · 4 min']}
        tags={[
          { label: 'Produce', count: 3 },
          { label: 'Dairy', count: 2 },
        ]}
        onDone={() => {}}
      />,
    )
    const slip = screen.getByRole('status')
    expect(slip).toHaveTextContent('Produce ×3')
    expect(slip).toHaveTextContent('Dairy ×2')
    expect(slip.querySelector('.cat-produce')).not.toBeNull()
    expect(slip.querySelector('.cat-dairy')).not.toBeNull()
  })

  it('a tap dismisses it, once, and so does Esc', async () => {
    const onDone = vi.fn()
    render(<DoneSlip title="Run done" lines={[]} onDone={onDone} holdMs={60_000} />)
    await userEvent.click(screen.getByRole('status'))
    await userEvent.keyboard('{Escape}')
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('rests in place under reduced motion', () => {
    motion(true)
    render(<DoneSlip title="Run done" lines={[]} onDone={() => {}} />)
    expect(screen.getByRole('status')).toHaveClass('is-still')
  })
})
