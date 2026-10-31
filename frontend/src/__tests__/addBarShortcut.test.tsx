import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useAddBarShortcut } from '@lib/useAddBarShortcut'

function Harness({ enabled }: { enabled: boolean }) {
  useAddBarShortcut(enabled, 'x-add')
  return (
    <>
      <input id="x-add" aria-label="add" />
      <textarea aria-label="notes" />
    </>
  )
}

describe('useAddBarShortcut', () => {
  it('focuses the given input on "/" and "n"', async () => {
    const user = userEvent.setup()
    render(<Harness enabled />)
    await user.keyboard('/')
    expect(document.activeElement?.id).toBe('x-add')
    ;(document.activeElement as HTMLElement).blur()
    await user.keyboard('n')
    expect(document.activeElement?.id).toBe('x-add')
  })

  it('types instead when focus is in a text field', async () => {
    const user = userEvent.setup()
    render(<Harness enabled />)
    const notes = screen.getByLabelText('notes')
    await user.click(notes)
    await user.keyboard('/n')
    expect(notes).toHaveValue('/n')
    expect(document.activeElement).toBe(notes)
  })

  it('does nothing when disabled', async () => {
    const user = userEvent.setup()
    render(<Harness enabled={false} />)
    await user.keyboard('/')
    expect(document.activeElement).toBe(document.body)
  })
})
