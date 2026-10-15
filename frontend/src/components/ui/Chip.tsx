import React, { useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { Sheet } from './Sheet'
import './ui.css'

type Props = {
  // Names the chip for screen readers: "Day", "Adding to".
  label: string
  // Its value in words ("Thu 15"): the accessible name is "Day, Thu 15".
  value: string
  // What shows in the chip (a stamp, an icon and text); defaults to the value.
  display?: React.ReactNode
  // Nothing chosen yet: muted ("+ Time").
  empty?: boolean
  // The picker's heading.
  title?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
  // The picker: a popover on wide screens, a small sheet elsewhere. Receives `close`.
  children: (close: () => void) => React.ReactNode
}

/** A pill that opens a picker (36px, paper fill, a caret). The open one takes the yellow key
 *  fill. Day, time, length, kind, category. */
export const Chip: React.FC<Props> = ({
  label,
  value,
  display,
  empty,
  title,
  disabled,
  autoFocus,
  className,
  children,
}) => {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const anchor = (
    <button
      type="button"
      className={['ui-chip', empty ? 'is-empty' : '', open ? 'is-open' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      disabled={disabled}
      aria-label={`${label}, ${value}`}
      // biome-ignore lint/a11y/noAutofocus: opened from an overlap line to change this time
      autoFocus={autoFocus}
    >
      {display ?? value}
      <CaretDown aria-hidden />
    </button>
  )
  return (
    <Sheet
      variant="chips"
      open={open}
      onOpen={() => setOpen(true)}
      onClose={close}
      label={title ?? label}
      title={title}
      anchor={anchor}
    >
      {open ? children(close) : null}
    </Sheet>
  )
}
