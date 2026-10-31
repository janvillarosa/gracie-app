import React from 'react'
import './ui.css'

type Props = {
  children?: React.ReactNode
  /** `pile` (default, the phone's): one slip in front, edges peeking. `column` (the list desk's
   *  Butler pane): every slip at once, one under the other. */
  layout?: 'pile' | 'column'
}

/** Autopilot floats one slip at a time. Its slips are a pile on the Z axis, never a column down
 *  the page: the first child is in full, and one or two more sheets peek out beneath its foot to
 *  say something else is waiting. Only the front slip is rendered; closing it is the page's job
 *  (it drops the slip, and the next one comes forward). The peeks are display-only: hidden from
 *  assistive tech, never focusable, never tappable. On the list desk there is room, so the
 *  `column` layout lays every slip out in order instead. */
export const SlipStack: React.FC<Props> = ({ children, layout = 'pile' }) => {
  const slips = React.Children.toArray(children)
  if (slips.length === 0) return null
  if (layout === 'column') return <div className="slip-stack is-column">{slips}</div>
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
