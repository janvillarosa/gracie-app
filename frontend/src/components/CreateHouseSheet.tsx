import React, { useEffect, useState } from 'react'
import { takePendingHouse } from '@lib/pendingHouse'
import { DESCRIPTION_RULE, isValidDisplayName, MAX_DESCRIPTION, NAME_RULE } from '@lib/validation'
import { Button, DetailGroup, Field, Sheet, SheetActions } from '@components/ui'

type Values = { display_name?: string; description?: string }

type Props = {
  open: boolean
  onClose: () => void
  onSubmit: (values: Values) => Promise<void> | void
  submitting?: boolean
}

/** Create a House: the name is the sheet's title, typed in place (like New list and New trip),
 *  a description underneath, and one key. Both are optional and can change later. */
export const CreateHouseSheet: React.FC<Props> = ({ open, onClose, onSubmit, submitting }) => {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const nameError = name && !isValidDisplayName(name) ? NAME_RULE : undefined
  const descError = description.length > MAX_DESCRIPTION ? DESCRIPTION_RULE : undefined

  useEffect(() => {
    if (!open) {
      setName('')
      setDescription('')
      return
    }
    // A name typed on the landing page ("Call your House ___ and start.") fills the field once.
    const pending = takePendingHouse()
    if (pending) setName(pending)
  }, [open])

  const canSubmit = !submitting && !nameError && !descError
  const submit = () => {
    if (!canSubmit) return
    void onSubmit({ display_name: name || undefined, description: description || undefined })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      label="Create a House"
      dirty={!submitting && (!!name || !!description)}
      identity={
        <div className="ui-sheet-identity">
          <div className="ui-sheet-identity-text">
            <Field
              className="ui-sheet-title"
              aria-label="House name"
              placeholder="Our Little Mansion"
              value={name}
              maxLength={64}
              error={nameError}
              // biome-ignore lint/a11y/noAutofocus: the sheet opens because the user asked for it
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
            <p className="ui-sheet-context">You can change this later in House settings.</p>
          </div>
        </div>
      }
      actions={
        <SheetActions>
          <Button kind="key" disabled={!canSubmit} onClick={submit}>
            {submitting ? 'Creating…' : 'Create House'}
          </Button>
        </SheetActions>
      }
      details={
        <DetailGroup label="Details">
          <div className="ui-fieldrow">
            <span className="ui-navrow-label">Description</span>
            <Field
              aria-label="Description"
              placeholder="Optional"
              value={description}
              error={descError}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </DetailGroup>
      }
    />
  )
}

export default CreateHouseSheet
