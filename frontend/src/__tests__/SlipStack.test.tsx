import { render, screen } from '@testing-library/react'
import { SlipStack } from '@components/ui'

const slips = (n: number) =>
  Array.from({ length: n }, (_, i) => <section key={i}>slip {i + 1}</section>)

describe('SlipStack', () => {
  it('shows the front slip in full and nothing of the rest', () => {
    render(<SlipStack>{slips(3)}</SlipStack>)
    expect(screen.getByText('slip 1')).toBeInTheDocument()
    expect(screen.queryByText('slip 2')).toBeNull()
    expect(screen.queryByText('slip 3')).toBeNull()
  })

  it.each([
    [1, 0],
    [2, 1],
    [3, 2],
    [4, 2],
  ])('with %i slips, %i peek edges', (count, peeks) => {
    const { container } = render(<SlipStack>{slips(count)}</SlipStack>)
    expect(container.querySelectorAll('.slip-stack-peek')).toHaveLength(peeks)
  })

  it('keeps the peeks out of reach: hidden from assistive tech and never focusable', () => {
    const { container } = render(<SlipStack>{slips(3)}</SlipStack>)
    for (const el of container.querySelectorAll('.slip-stack-peek')) {
      expect(el.getAttribute('aria-hidden')).toBe('true')
      expect(el.hasAttribute('tabindex')).toBe(false)
      expect(el.querySelector('button, a, input, [tabindex]')).toBeNull()
    }
  })

  it('renders nothing for no slips', () => {
    const { container } = render(<SlipStack>{[]}</SlipStack>)
    expect(container).toBeEmptyDOMElement()
  })
})
