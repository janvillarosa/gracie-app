import { render, screen, fireEvent } from '@testing-library/react'
import { CreateHouseSheet } from '@components/CreateHouseSheet'

describe('CreateHouseSheet', () => {
  it('validates the name rule inline and submits the values', () => {
    const onSubmit = vi.fn()
    render(<CreateHouseSheet open onClose={vi.fn()} onSubmit={onSubmit} />)
    const name = screen.getByRole('textbox', { name: 'House name' })
    const desc = screen.getByRole('textbox', { name: 'Description' })
    const key = screen.getByRole('button', { name: 'Create House' })
    // The name is optional: the key works with nothing typed.
    expect(key).toBeEnabled()
    fireEvent.change(name, { target: { value: 'Bad!@#' } })
    expect(screen.getByRole('alert')).toHaveTextContent(/up to 64 letters, numbers or spaces/i)
    expect(key).toBeDisabled()
    fireEvent.change(name, { target: { value: 'My House' } })
    fireEvent.change(desc, { target: { value: 'Cozy' } })
    expect(key).toBeEnabled()
    fireEvent.click(key)
    expect(onSubmit).toHaveBeenCalledWith({ display_name: 'My House', description: 'Cozy' })
  })

  it('creates on Enter in the name', () => {
    const onSubmit = vi.fn()
    render(<CreateHouseSheet open onClose={vi.fn()} onSubmit={onSubmit} />)
    const name = screen.getByRole('textbox', { name: 'House name' })
    fireEvent.change(name, { target: { value: 'Elm Street' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith({ display_name: 'Elm Street', description: undefined })
  })
})
