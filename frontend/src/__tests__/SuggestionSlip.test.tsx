import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { SuggestionSlip } from '@components/SuggestionSlip'
import type { ListSuggestion } from '@api/types'

const milk: ListSuggestion = {
  key: 'whole milk',
  description: 'Whole milk',
  quantity: '2',
  unit: 'l',
  every_days: 7,
  score: 0.8,
}

describe('SuggestionSlip', () => {
  it('names the item and how often the house usually adds it', () => {
    render(<SuggestionSlip suggestion={milk} onAdd={vi.fn()} onIgnore={vi.fn()} />)
    expect(screen.getByRole('region', { name: 'Suggested' })).toBeInTheDocument()
    expect(screen.getByText('Whole milk (2 l)')).toBeInTheDocument()
    expect(screen.getByText('usually every week')).toBeInTheDocument()
  })

  it('describes other rhythms in days', () => {
    render(
      <SuggestionSlip
        suggestion={{ ...milk, quantity: undefined, unit: undefined, every_days: 21 }}
        onAdd={vi.fn()}
        onIgnore={vi.fn()}
      />,
    )
    expect(screen.getByText('Whole milk')).toBeInTheDocument()
    expect(screen.getByText('usually every 21 days')).toBeInTheDocument()
  })

  it('adds and ignores through real, named buttons', async () => {
    const onAdd = vi.fn()
    const onIgnore = vi.fn()
    render(<SuggestionSlip suggestion={milk} onAdd={onAdd} onIgnore={onIgnore} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add Whole milk' }))
    expect(onAdd).toHaveBeenCalledWith(milk)
    await userEvent.click(screen.getByRole('button', { name: 'Ignore suggestion: Whole milk' }))
    expect(onIgnore).toHaveBeenCalledWith(milk)
  })
})
