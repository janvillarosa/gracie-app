import React from 'react'
import './ui.css'

export type PaperLift = 0 | 1 | 2 | 3

type Props = {
  // How high the sheet sits: 0 resting on the desk, 1 on top of a stack, 2 an overlay, 3 a
  // popover. Inside a PaperStack the stack decides (bottom sheets rest, the top one is lifted).
  lift?: PaperLift
  // paper: white. tint: the faint grey of a detail group or the add bar's well.
  tone?: 'paper' | 'tint'
  // sheet: the standard inside margin (24px). flush: none, for a sheet that lays out its own.
  inset?: 'sheet' | 'flush'
  as?: 'div' | 'section' | 'article' | 'aside' | 'header'
  className?: string
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'children'>

/** One sheet of paper: the 1px edge, the white top highlight, the 16px squircle and one of the
 *  four paper heights. Every panel in the app is one of these (or a stack of them); nothing
 *  draws its own card. */
export const Paper = React.forwardRef<HTMLElement, Props>(function Paper(
  { lift = 0, tone = 'paper', inset = 'sheet', as = 'div', className, children, ...rest },
  ref,
) {
  const Tag = as as React.ElementType
  return (
    <Tag
      ref={ref}
      className={[
        'paper',
        `is-lift-${lift}`,
        tone === 'tint' ? 'is-tint' : '',
        inset === 'flush' ? 'is-flush' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      <div className="paper-body">{children}</div>
    </Tag>
  )
})
