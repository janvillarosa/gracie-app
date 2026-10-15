import React, { useEffect, useState } from 'react'
import type { BookingKind } from '@api/tripTypes'
import { Button, Sheet, SheetFooter, SheetIdentity } from '@components/ui'
import { KIND_ICON } from './tripUi'

type Props = {
  code: string
  title: string
  kind?: BookingKind
  // One line: time and place.
  line?: string
  onCopy: (code: string) => void
  // Shows an "Edit" button on the slip (the booking's code can be changed there).
  onEdit?: () => void
}

/** "Show code": a quiet button that opens the ticket slip (the `slip` Sheet: a popover on wide
 *  screens, a small sheet elsewhere). The code is never shown until asked for, and nothing
 *  underneath moves. */
export const CodeReveal: React.FC<Props> = ({ code, title, kind, line, onCopy, onEdit }) => {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <Sheet
      variant="slip"
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      label={`Ticket for ${title}`}
      anchor={<Button kind="quiet">Show code</Button>}
      identity={
        <SheetIdentity
          leading={<span className="trip-kind-tile">{KIND_ICON[kind ?? 'ticket']}</span>}
          title={title}
          context={line}
        />
      }
      footer={<SheetFooter who="Show this at the entrance" />}
    >
      <div className="trip-slip">
        <p className="trip-slip-code" aria-label={`Confirmation code for ${title}`}>
          {code}
        </p>
        <div className="trip-slip-actions">
          <Button
            kind="quiet"
            aria-label={copied ? 'Copied' : `Copy code for ${title}`}
            onClick={() => {
              onCopy(code)
              setCopied(true)
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          {onEdit && (
            <Button
              kind="quiet"
              onClick={() => {
                setOpen(false)
                onEdit()
              }}
            >
              Edit
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
