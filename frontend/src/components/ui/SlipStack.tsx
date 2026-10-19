import React from 'react'
import './ui.css'

type Props = {
  children?: React.ReactNode
}

/** Autopilot floats one slip at a time. Its slips are a pile on the Z axis, never a column down
 *  the page: the first child is in full, and one or two more sheets peek out beneath its foot to
 *  say something else is waiting. Only the front slip is rendered; closing it is the page's job
 *  (it drops the slip, and the next one comes forward). The peeks are display-only: hidden from
 *  assistive tech, never focusable, never tappable. */
export const SlipStack: React.FC<Props> = ({ children }) => {
  const slips = React.Children.toArray(children)
  if (slips.length === 0) return null
  const peeks = Math.min(2, slips.length - 1)
  return (
    <div className="slip-stack">
      {slips[0]}
      {Array.from({ length: peeks }, (_, i) => (
        <span key={i} className={`slip-stack-peek is-${i + 1}`} aria-hidden="true" />
      ))}
    </div>
  )
}
