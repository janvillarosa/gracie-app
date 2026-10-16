import React, { useState } from 'react'
import { Button, Sheet, SheetActions, SheetIdentity } from '@components/ui'

type Props = {
  open: boolean
  onClose: () => void
  onConfirm: () => Promise<void> | void
  // What is being deleted, as the House calls it: "Elm Street", "Groceries".
  name: string
  kind: 'house' | 'list'
  // Current members, and how many of the others have already voted.
  members: number
  othersVoted: number
}

/** Deleting a House or a list takes everyone's vote. Before a vote is cast this says what it
 *  does: the last vote deletes at once (and in a House of one, the first vote is the last). */
export const DeleteVoteSheet: React.FC<Props> = ({
  open,
  onClose,
  onConfirm,
  name,
  kind,
  members,
  othersVoted,
}) => {
  const [busy, setBusy] = useState(false)
  const total = Math.max(members, 1)
  const after = Math.min(othersVoted + 1, total)
  const final = after >= total
  const title = final ? `Delete ${name}?` : `Vote to delete ${name}?`
  const context = final
    ? kind === 'house'
      ? 'Its lists and trips go with it, for everyone. This can’t be undone.'
      : 'It goes for everyone in the House. This can’t be undone.'
    : `It’s deleted once everyone in the House votes. Yours makes ${after} of ${total}.`

  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      variant="confirm"
      open={open}
      onClose={onClose}
      label={title}
      identity={<SheetIdentity title={title} context={context} />}
      actions={
        <SheetActions>
          <Button kind="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="key" danger disabled={busy} onClick={() => void confirm()}>
            {final ? 'Delete' : 'Vote to delete'}
          </Button>
        </SheetActions>
      }
    />
  )
}

export default DeleteVoteSheet
