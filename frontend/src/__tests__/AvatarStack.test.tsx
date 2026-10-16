import { render, screen } from '@testing-library/react'
import { AvatarStack } from '@components/AvatarStack'

const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `P${i + 1}`,
    avatar_key: `k${i}`,
    user_id: `u${i}`,
  }))

describe('AvatarStack', () => {
  it('is one labelled image with decorative faces and no tab stops', () => {
    const { container } = render(<AvatarStack members={people(2)} label="Members: P1 and P2" />)
    expect(screen.getByRole('img', { name: 'Members: P1 and P2' })).toBeInTheDocument()
    expect(container.querySelectorAll('.avatar-stack-face')).toHaveLength(2)
    expect(container.querySelector('[tabindex]')).toBeNull()
    // Faces are named for a pointer (title), not read out twice.
    expect(container.querySelector('.avatar-stack-face')).toHaveAttribute('title', 'P1')
  })

  it('shows every face up to the limit', () => {
    const { container } = render(<AvatarStack members={people(4)} label="x" />)
    expect(container.querySelectorAll('.avatar-stack-face')).toHaveLength(4)
    expect(container.querySelector('.avatar-stack-more')).toBeNull()
  })

  it('past the limit, one fewer face and a +N chip that counts the rest', () => {
    const { container } = render(<AvatarStack members={people(6)} label="x" />)
    expect(container.querySelectorAll('.avatar-stack-face')).toHaveLength(3)
    expect(container.querySelector('.avatar-stack-more')).toHaveTextContent('+3')
  })

  it('deals faces in order: each carries its place for the stagger', () => {
    const { container } = render(<AvatarStack members={people(3)} label="x" size={24} />)
    const stack = container.querySelector('.avatar-stack') as HTMLElement
    expect(stack.style.getPropertyValue('--face')).toBe('24px')
    const order = [...container.querySelectorAll<HTMLElement>('.avatar-stack-face')].map((f) =>
      f.style.getPropertyValue('--i'),
    )
    expect(order).toEqual(['0', '1', '2'])
  })
})
