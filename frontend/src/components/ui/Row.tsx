import React from 'react'
import './ui.css'

type Props = {
  // The first column: a checkbox, a kind icon, a dot. 24px wide, then a 12px gap.
  lead?: React.ReactNode
  // The time column (48px): a time, "Tonight". Present only where something in the list has one.
  time?: React.ReactNode
  // After the title: a dot, a stamp, small actions.
  trail?: React.ReactNode
  as?: 'div' | 'li'
  className?: string
  id?: string
  // The title column.
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'id' | 'children'>

/** The one row grid: [lead 24] 12 [time 48] 12 [title 1fr] [trail]. Every list-like line in a
 *  plan, a list of bookings or a sheet is built on it, so lead, time and title always line up.
 *  The columns are CSS variables (--lead, --gap, --time-w); a day that has no times sets
 *  --tcol to 0 for all its lines. */
export const Row = React.forwardRef<HTMLElement, Props>(function Row(
  { lead, time, trail, as = 'div', className, children, ...rest },
  ref,
) {
  const Tag = as as 'div'
  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      className={['ui-row', className ?? ''].filter(Boolean).join(' ')}
      {...rest}
    >
      {lead !== undefined && lead !== null && <span className="ui-row-lead">{lead}</span>}
      {time !== undefined && time !== null && <span className="ui-row-time">{time}</span>}
      <span className="ui-row-title">{children}</span>
      {trail !== undefined && trail !== null && <span className="ui-row-trail">{trail}</span>}
    </Tag>
  )
})
