import React from 'react'
import { PencilSimple } from '@phosphor-icons/react'
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
  // The leading mark is a 44px tile (an icon button), not a 28px checkbox or kind tile.
  tile?: boolean
  // Show a small pencil after the title on hover and focus: this title can be renamed here.
  editHint?: boolean
  // The title's own rule (a House name), instead of the trip title limit.
  validate?: (v: string) => string
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
  tile,
  editHint,
  validate,
}) => (
  <div
    className={
      leading ? `ui-sheet-identity has-lead${tile ? ' has-tile' : ''}` : 'ui-sheet-identity'
    }
  >
    {leading && <span className="ui-sheet-lead">{leading}</span>}
    <div className="ui-sheet-identity-text">
      <div className="ui-sheet-titlerow">
        <SheetTitle
          value={title}
          onCommit={onTitle}
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={placeholder}
          label={titleLabel}
          validate={validate}
        />
        {editHint && onTitle && <PencilSimple className="ui-sheet-pencil" aria-hidden />}
      </div>
      {(context || children) && (
        <p className="ui-sheet-context">
          {context}
          {children}
        </p>
      )}
    </div>
  </div>
)
