import React from 'react'
import './ui.css'

type Props = {
  // How many sheets peek out beneath the stack: none, one (the usual), or two (more to come,
  // the next-stop deck).
  peek?: 0 | 1 | 2
  // Off for a stack that animates its own cards (the next-stop deck deals and flips them).
  arrive?: boolean
  className?: string
  children?: React.ReactNode
}

/** The stack of paper, as one thing. Children are sheets from the bottom up: each one after
 *  the first is slid 20px over the one before and lifted, the sheets beneath lose their bottom
 *  edge under it, and one or two more sheets peek out at the foot (14px and 28px in). On arrival
 *  the stack assembles bottom-up: the bottom sheet sets down, each next one settles a beat
 *  later, the peeking edges drop in last. With reduced motion it is simply there. */
export const PaperStack: React.FC<Props> = ({ peek = 1, arrive = true, className, children }) => (
  <div
    className={['paper-stack', `has-peek-${peek}`, arrive ? '' : 'is-still', className ?? '']
      .filter(Boolean)
      .join(' ')}
  >
    {children}
  </div>
)
