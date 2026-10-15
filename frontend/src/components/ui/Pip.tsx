import React from 'react'
import type { TripCategory } from '@api/tripTypes'
import './ui.css'

type Props = {
  // A category colour, or a day colour (0 to 5), or the muted "done" grey.
  category?: TripCategory
  day?: number
  done?: boolean
  // Hollow: white fill with a coloured ring (an idea).
  hollow?: boolean
  // For a screen reader when the dot carries meaning; otherwise it is decoration.
  label?: string
}

/** The small colour dot: a category on a row, a day on the map legend. */
export const Pip: React.FC<Props> = ({ category = 'other', day, done, hollow, label }) => {
  const colour = done
    ? 'var(--pip-done)'
    : day !== undefined
      ? `var(--trip-day-${day % 6})`
      : `var(--pip-${category})`
  return (
    <span
      className={hollow ? 'ui-pip is-hollow' : 'ui-pip'}
      style={{ '--pip': colour } as React.CSSProperties}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
