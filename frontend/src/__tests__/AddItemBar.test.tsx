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
