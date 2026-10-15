import React, { useState } from 'react'
import { CaretRight } from '@phosphor-icons/react'
import { TransitionLink } from '@components/TransitionLink'
import { Sheet } from './Sheet'
import './ui.css'

type Picker = {
  // The picker's heading.
  title: string
  // What opens: its content, given `close`.
  content: (close: () => void) => React.ReactNode
}

type Props = {
  label: string
  // The value, in ink; or muted text when `empty` ("None", "Add a note").
  value?: React.ReactNode
  empty?: boolean
  // A mark before the label (list layout).
  icon?: React.ReactNode
  // detail: a short muted label on the left, the value right (the details group). list: the
  // label is the text, the value a muted note (days, settings).
  layout?: 'detail' | 'list'
  disabled?: boolean
  // What it does: open a picker, run something, or go to a page.
  picker?: Picker
  onClick?: () => void
  to?: string
  // A current choice in a list (a day): aria-current.
  current?: boolean
  // The picker starts open (an overlap line sends you straight to the time).
  defaultOpen?: boolean
  // Or the caller holds it open or shut (the ticket slip's Edit opens the code row).
  open?: boolean
  onOpenChange?: (open: boolean) => void
  // Passed to the row's control when its text is not the whole story.
  'aria-label'?: string
  state?: unknown
}

/** A row that goes somewhere or opens something: its label, its value in muted ink, a yellow
 *  chevron. Where, When, Packing list, a place, a booking link, a day in a list, a setting. */
export const NavRow: React.FC<Props> = ({
  label,
  value,
  empty,
  icon,
  layout = 'detail',
  disabled,
  picker,
  onClick,
  to,
  current,
  defaultOpen,
  open: openProp,
  onOpenChange,
  'aria-label': aria,
  state,
}) => {
  const [own, setOwn] = useState(!!defaultOpen)
  const open = openProp ?? own
  const setOpen = (o: boolean) => {
    setOwn(o)
    onOpenChange?.(o)
  }
  const inner = (
    <>
      {icon && <span className="ui-navrow-icon">{icon}</span>}
      <span className="ui-navrow-label">{label}</span>
      <span className={empty ? 'ui-navrow-value is-empty' : 'ui-navrow-value'}>{value}</span>
      <CaretRight className="ui-navrow-chev" weight="bold" aria-hidden />
    </>
  )
  const cls = ['ui-navrow', layout === 'list' ? 'is-list' : '', current ? 'is-current' : '']
    .filter(Boolean)
    .join(' ')
  if (to)
    return (
      <TransitionLink to={to} state={state} className={cls} aria-label={aria}>
        {inner}
      </TransitionLink>
    )
  const button = (
    <button
      type="button"
      className={cls}
      disabled={disabled}
      aria-label={aria}
      aria-current={current ? 'true' : undefined}
      onClick={picker ? undefined : onClick}
    >
      {inner}
    </button>
  )
  if (!picker) return button
  return (
    <Sheet
      variant="chips"
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      label={picker.title}
      title={picker.title}
      anchor={button}
    >
      {open ? picker.content(() => setOpen(false)) : null}
    </Sheet>
  )
}
