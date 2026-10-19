import { fireEvent, render, screen } from '@testing-library/react'
import { UpNextSlip } from '@components/UpNextSlip'

const slip = (over: Partial<React.ComponentProps<typeof UpNextSlip>> = {}) => {
  const onDone = vi.fn()
  const onHide = vi.fn()
  const view = render(
    <UpNextSlip
      next={{ itemId: 'it_1', name: 'Eggs' }}
      thenName="Bread"
      onDone={onDone}
      onHide={onHide}
      {...over}
    />,
  )
  return { onDone, onHide, ...view }
}

describe('UpNextSlip', () => {
  it('names the item and what usually follows, marked as autopilot’s guess', () => {
    slip()
    expect(screen.getByRole('region', { name: 'Up next' })).toBeInTheDocument()
    expect(screen.getByText('Eggs')).toBeInTheDocument()
    expect(screen.getByText('Usually next · then Bread')).toBeInTheDocument()
  })

  it('says only "Usually next" when nothing follows', () => {
    slip({ thenName: undefined })
    expect(screen.getByText('Usually next')).toBeInTheDocument()
  })

  it('checks the item off from the tick box', () => {
    const { onDone } = slip()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Eggs, done' }))
    expect(onDone).toHaveBeenCalledWith('it_1')
  })

  it('can be waved off with a round ✕', () => {
    const { onHide } = slip()
    const x = screen.getByRole('button', { name: 'Hide up next' })
    expect(x).toHaveAttribute('title', 'Not now')
    fireEvent.click(x)
    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('has no yellow key: the suggestion’s Add stays the page’s one key', () => {
    const { container } = slip()
    expect(container.querySelector('.is-key')).toBeNull()
  })
})
