import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { CreateHouseModal } from '@components/CreateHouseModal'

describe('CreateHouseModal', () => {
  it('validates name rules and submits values', () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    render(<CreateHouseModal open onClose={onClose} onSubmit={onSubmit} />)
    const name = screen.getByPlaceholderText('e.g., Our Little Mansion')
    const desc = screen.getByPlaceholderText('Add a short description')
    const btn = screen.getByRole('button', { name: 'Create' })
    // name optional: enabled even when empty
    expect(btn).toBeEnabled()
    fireEvent.change(name, { target: { value: 'Bad!@#' } })
    expect(screen.getByText(/only letters, numbers and spaces/i)).toBeInTheDocument()
    expect(btn).toBeDisabled()
    fireEvent.change(name, { target: { value: 'My House' } })
    fireEvent.change(desc, { target: { value: 'Cozy' } })
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    expect(onSubmit).toHaveBeenCalledWith({ display_name: 'My House', description: 'Cozy' })
  })
})

