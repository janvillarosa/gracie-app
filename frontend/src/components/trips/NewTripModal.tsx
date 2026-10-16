import React, { useState } from 'react'
import { Button, Field, Sheet, SheetActions } from '@components/ui'

type Props = {
  title: string
  cta: string
  initial?: string
  onSubmit: (name: string) => void
  onCancel: () => void
  // The muted line under the name; the title (the sheet's purpose) is the accessible name.
  context?: string
}

// Asks one thing: the name. Dates, a destination and the route come later, from the trip's
// settings or from the nudge in an empty plan. The identity is the field itself; the key is
// the one action.
export const TripNameModal: React.FC<Props> = ({
  title,
  cta,
  initial = '',
  context,
  onSubmit,
  onCancel,
}) => {
  const [name, setName] = useState(initial)
  const submit = () => {
    if (name.trim()) onSubmit(name.trim())
  }
  return (
    <Sheet
      open
      label={title}
      onClose={onCancel}
      identity={
        <div className="ui-sheet-identity">
          <div className="ui-sheet-identity-text">
            <Field
              className="ui-sheet-title"
              aria-label="Trip name"
              placeholder="Autumn in Lisbon"
              value={name}
              maxLength={120}
              // biome-ignore lint/a11y/noAutofocus: the sheet opens because the user asked for it
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
            <p className="ui-sheet-context">{context ?? title}</p>
          </div>
        </div>
      }
      actions={
        <SheetActions>
          <Button kind="key" disabled={!name.trim()} onClick={submit}>
            {cta}
          </Button>
        </SheetActions>
      }
    />
  )
}
