import React from 'react'
import { Drawer } from 'antd'

type Props = {
  title: string
  onClose: () => void
  // No visible title: the content carries its own heading (the item sheets).
  bare?: boolean
  // Content height by default (never taller than 90% of the screen).
  height?: string | number
  className?: string
  children: React.ReactNode
}

/** The one bottom sheet on the trip screens: a drag-handle bar, an optional title in Outfit,
 *  no divider. The X shows only where a pointer is likely (desktop widths); on touch the mask
 *  and Esc close it. Rendered only while open. */
export const Sheet: React.FC<Props> = ({
  title,
  onClose,
  bare,
  height = 'auto',
  className,
  children,
}) => (
  <Drawer
    open
    placement="bottom"
    height={height}
    title={bare ? <span className="sr-only">{title}</span> : title}
    onClose={onClose}
    destroyOnClose
    className={['trip-sheet-drawer', bare ? 'is-bare' : '', className ?? '']
      .filter(Boolean)
      .join(' ')}
    styles={{ body: { padding: 0 } }}
  >
    {children}
  </Drawer>
)
