import { InkStamp } from '@components/ui'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('InkStamp', () => {
  it('reads as its words, the note first, like a dated stamp', () => {
    render(<InkStamp note="Sat 17 Oct">Run done</InkStamp>)
    const stamp = screen.getByText('Run done').closest('.ui-ink-stamp')
    expect(stamp).not.toBeNull()
    expect(stamp).toHaveTextContent(/Sat 17 Oct\s*Run done/)
  })

  it('needs no note', () => {
    render(<InkStamp>Packed</InkStamp>)
    expect(screen.getByText('Packed')).toBeInTheDocument()
  })
})
