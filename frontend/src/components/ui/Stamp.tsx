import React from 'react'
import type { TripCategory } from '@api/tripTypes'
import './ui.css'

type Props = {
  // A category (the List's category stamp, in its trip colours), or a state stamp.
  category?: TripCategory
  tone?: 'used' | 'done'
  children: React.ReactNode
  className?: string
}

/** The one stamp: a small uppercase tag on a tinted ground. Categories ("SIGHT"), and the
 *  states "Used" and "Day done". */
export const Stamp: React.FC<Props> = ({ category, tone, children, className }) => (
  <span
    className={[
      'ui-stamp',
      category ? `category-tag trip-cat trip-cat-${category}` : '',
      tone ? `is-${tone}` : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ')}
  >
    {children}
  </span>
)
