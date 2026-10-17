import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { NARROW_SLIP, SuggestionSlip, SuggestionStack } from '@components/SuggestionSlip'
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
    expect(screen.getByText('Whole milk (2 l)')).toBeInTheDocument()
    expect(screen.getByText('You add it weekly')).toBeInTheDocument()
  })

  it('describes other rhythms in days', () => {
    render(
      <SuggestionSlip
        suggestion={{ ...milk, quantity: undefined, unit: undefined, every_days: 10 }}
        onAdd={vi.fn()}
        onIgnore={vi.fn()}
      />,
    )
    expect(screen.getByText('Whole milk')).toBeInTheDocument()
    expect(screen.getByText('You add it every 10 days')).toBeInTheDocument()
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

  it('turns Add into a round plus on a narrow phone, keeping its name', () => {
    const real = window.matchMedia
    window.matchMedia = ((query: string) => ({
      ...real(query),
      matches: query === NARROW_SLIP,
    })) as typeof window.matchMedia
    try {
      render(<SuggestionSlip suggestion={milk} onAdd={vi.fn()} onIgnore={vi.fn()} />)
      const add = screen.getByRole('button', { name: 'Add Whole milk' })
      expect(add).not.toHaveTextContent('Add')
      expect(add).toHaveClass('is-key', 'is-icon')
    } finally {
      window.matchMedia = real
    }
  })

  it('stacks several slips in one labelled region, each with its own buttons', async () => {
    const onAdd = vi.fn()
    const eggs: ListSuggestion = { ...milk, key: 'eggs', description: 'Eggs', every_days: 14 }
    render(<SuggestionStack suggestions={[milk, eggs]} onAdd={onAdd} onIgnore={vi.fn()} />)
    const region = screen.getByRole('region', { name: 'Suggestion' })
    expect(region).toHaveTextContent('Whole milk')
    expect(region).toHaveTextContent('Eggs')
    await userEvent.click(screen.getByRole('button', { name: 'Add Eggs' }))
    expect(onAdd).toHaveBeenCalledWith(eggs)
  })

  it('renders nothing for an empty stack', () => {
    render(<SuggestionStack suggestions={[]} onAdd={vi.fn()} onIgnore={vi.fn()} />)
    expect(screen.queryByRole('region', { name: 'Suggestion' })).not.toBeInTheDocument()
  })
})
