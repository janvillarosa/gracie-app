import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddItemBar } from '@components/AddItemBar'

describe('AddItemBar', () => {
  it('parses quantity and clears the input on submit', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<AddItemBar onCreate={onCreate} />)
    const input = screen.getByPlaceholderText('Add an item')
    await userEvent.type(input, '2 kg rice{enter}')
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      description: 'rice',
      quantity: '2',
      unit: 'kg',
    })
    expect(input).toHaveValue('')
  })

  it('restores the typed text when creation fails', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('boom'))
    render(<AddItemBar onCreate={onCreate} />)
    const input = screen.getByPlaceholderText('Add an item')
    await userEvent.type(input, 'Milk{enter}')
    await waitFor(() => expect(input).toHaveValue('Milk'))
  })

  it('ignores blank input', async () => {
    const onCreate = vi.fn()
    render(<AddItemBar onCreate={onCreate} />)
    await userEvent.type(screen.getByPlaceholderText('Add an item'), '   {enter}')
    expect(onCreate).not.toHaveBeenCalled()
  })
})

describe('AddItemBar suggestions', () => {
  const pantry = [
    {
      description: 'Basmati rice',
      category: 'Grains & Bakery',
      quantity: '1',
      unit: 'kg',
      times_added: 4,
      last_added_at: '2026-01-01T00:00:00Z',
      common: false,
    },
    {
      description: 'Bananas',
      category: 'Produce',
      quantity: '',
      unit: '',
      times_added: 2,
      last_added_at: '2026-01-01T00:00:00Z',
      common: false,
    },
  ]

  it('offers matching items and adds the picked one with its usual quantity', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<AddItemBar onCreate={onCreate} pantry={pantry} />)
    const input = screen.getByRole('combobox')
    await userEvent.type(input, 'bas')
    await userEvent.click(await screen.findByRole('option', { name: /Basmati rice/ }))
    expect(onCreate).toHaveBeenCalledWith({
      description: 'Basmati rice',
      quantity: '1',
      unit: 'kg',
    })
    expect(input).toHaveValue('')
  })

  it('keeps a typed quantity over the usual one', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<AddItemBar onCreate={onCreate} pantry={pantry} />)
    await userEvent.type(screen.getByRole('combobox'), '3 bag bas')
    await userEvent.click(await screen.findByRole('option', { name: /Basmati rice/ }))
    expect(onCreate).toHaveBeenCalledWith({
      description: 'Basmati rice',
      quantity: '3',
      unit: 'bag',
    })
  })

  it('never hijacks Enter: with no slip highlighted it adds exactly what was typed', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<AddItemBar onCreate={onCreate} pantry={pantry} />)
    await userEvent.type(screen.getByRole('combobox'), 'bas{enter}')
    expect(onCreate).toHaveBeenCalledWith({ description: 'bas', quantity: '', unit: '' })
  })

  it('shows at most three slips, so they fit above the bar on a small screen', async () => {
    const many = ['Cheddar', 'Cherries', 'Chervil', 'Chestnuts', 'Chickpeas'].map(
      (description) => ({
        description,
        category: 'Other',
        quantity: '',
        unit: '',
        times_added: 1,
        last_added_at: '2026-01-01T00:00:00Z',
        common: false,
      }),
    )
    render(<AddItemBar onCreate={vi.fn()} pantry={many} />)
    await userEvent.type(screen.getByRole('combobox'), 'ch')
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('moves through slips with the arrow keys and adds the highlighted one on Enter', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<AddItemBar onCreate={onCreate} pantry={pantry} />)
    const input = screen.getByRole('combobox')
    await userEvent.type(input, 'ba')
    expect(screen.getAllByRole('option')).toHaveLength(2)
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{Enter}')
    expect(onCreate.mock.calls[0][0].description).toBe('Bananas')
  })

  it('Escape closes the suggestions; Tab completes the ghost text', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<AddItemBar onCreate={onCreate} pantry={pantry} />)
    const input = screen.getByRole('combobox')
    await userEvent.type(input, 'bas')
    await userEvent.keyboard('{Tab}')
    expect(input).toHaveValue('Basmati rice'.replace(/^Bas/, 'bas'))
    await userEvent.clear(input)
    await userEvent.type(input, 'ban')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })
})
