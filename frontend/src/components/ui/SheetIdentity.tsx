import React from 'react'
import { SheetTitle } from './SheetTitle'
import './ui.css'

type Props = {
  // A checkbox (a todo), a kind icon tile (a booking) or nothing.
  leading?: React.ReactNode
  title: string
  // Editable title; leave out for a plain heading ("Days").
  onTitle?: (v: string) => void
  // One line, 15px muted: the key facts ("Thu 15 · 14:00–16:00 · Sintra"). Inline extras (a
  // Stamp) go in `children`.
  context?: React.ReactNode
  children?: React.ReactNode
  autoFocus?: boolean
  disabled?: boolean
  placeholder?: string
  titleLabel?: string
}

/** Tier 1 of a sheet: what this is, big. A leading mark, the title, and one context line. */
export const SheetIdentity: React.FC<Props> = ({
  leading,
  title,
  onTitle,
  context,
  children,
  autoFocus,
  disabled,
  placeholder,
  titleLabel,
}) => (
  <div className={leading ? 'ui-sheet-identity has-lead' : 'ui-sheet-identity'}>
    {leading && <span className="ui-sheet-lead">{leading}</span>}
    <div className="ui-sheet-identity-text">
      <SheetTitle
        value={title}
        onCommit={onTitle}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        label={titleLabel}
      />
      {(context || children) && (
        <p className="ui-sheet-context">
          {context}
          {children}
        </p>
      )}
    </div>
  </div>
)
