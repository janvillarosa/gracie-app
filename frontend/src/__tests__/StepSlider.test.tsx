import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StepSlider } from '@components/ui'

type Mode = 'off' | 'suggest' | 'assist'
const steps = [
  { value: 'off' as const, label: 'Off', icon: <span>o</span> },
  { value: 'suggest' as const, label: 'Suggest', icon: <span>s</span> },
  { value: 'assist' as const, label: 'Assist', icon: <span>a</span> },
]

const Harness = ({ onChange }: { onChange?: (m: Mode) => void }) => {
  const [v, setV] = useState<Mode>('suggest')
  return (
    <StepSlider
      label="Butler"
      value={v}
      steps={steps}
      onChange={(m) => {
        setV(m)
        onChange?.(m)
      }}
    />
  )
}

describe('StepSlider', () => {
  it('is one slider whose value is the step’s name', () => {
    render(<Harness />)
    const s = screen.getByRole('slider', { name: 'Butler' })
    expect(s).toHaveAttribute('aria-valuenow', '1')
    expect(s).toHaveAttribute('aria-valuetext', 'Suggest')
    expect(s).toHaveAttribute('aria-valuemax', '2')
    // The names are the stops, not a second set of controls for screen readers.
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('moves with the arrow keys, Home and End, and stops at the ends', async () => {
    const seen: Mode[] = []
    render(<Harness onChange={(m) => seen.push(m)} />)
    const s = screen.getByRole('slider', { name: 'Butler' })
    s.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{Home}{ArrowLeft}{End}')
    expect(seen).toEqual(['assist', 'off', 'assist'])
    expect(s).toHaveAttribute('aria-valuetext', 'Assist')
  })

  it('a tap on a stop’s name moves the key there', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Off'))
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', 'Off')
  })

  it('a drag snaps to the nearest stop when let go', () => {
    // jsdom has no PointerEvent; a MouseEvent carries the coordinates the slider reads.
    const had = 'PointerEvent' in window
    if (!had) (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent
    const seen: Mode[] = []
    render(<Harness onChange={(m) => seen.push(m)} />)
    const track = screen.getByRole('slider')
    const rail = track.querySelector('.ui-steps-rail') as HTMLElement
    rail.getBoundingClientRect = () => ({
      left: 0,
      width: 200,
      top: 0,
      height: 44,
      right: 200,
      bottom: 44,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    fireEvent.pointerDown(track, { button: 0, clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: 185, pointerId: 1 })
    expect(track.closest('.ui-steps')).toHaveClass('is-dragging')
    fireEvent.pointerUp(track, { clientX: 185, pointerId: 1 })
    expect(seen).toEqual(['assist'])
    expect(track.closest('.ui-steps')).not.toHaveClass('is-dragging')
    // One window serves every test file: leave it as it was.
    if (!had) delete (window as unknown as { PointerEvent?: unknown }).PointerEvent
  })
})
