import React from 'react'
import { Warning } from '@phosphor-icons/react'
import './ui.css'

type Props = {
  // muted: a quiet explainer. warn: amber, for something worth a look (an overlap).
  tone?: 'muted' | 'warn'
  // With onClick the whole line is a button (the overlap line opens the item).
  onClick?: () => void
  // Something small on the right ("Got it", "See theirs").
  action?: React.ReactNode
  role?: 'status' | 'alert'
  className?: string
  children: React.ReactNode
}

/** One line of explanation. Muted by default; amber (never red: it is not an error) for a
 *  warning. */
export const Note: React.FC<Props> = ({
  tone = 'muted',
  onClick,
  action,
  role,
  className,
  children,
}) => {
  const c = ['ui-note', `is-${tone}`, className ?? ''].filter(Boolean).join(' ')
  const flag =
    tone === 'warn' ? <Warning className="ui-note-flag" weight="bold" aria-hidden /> : null
  if (onClick)
    return (
      <button type="button" className={c} onClick={onClick}>
        {flag}
        <span>{children}</span>
      </button>
    )
  return (
    <p className={c} role={role}>
      {flag}
      <span>{children}</span>
      {action}
    </p>
  )
}
