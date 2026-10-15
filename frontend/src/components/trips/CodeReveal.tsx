import React, { useEffect, useRef, useState } from 'react'
import { Button, Popover } from 'antd'
import type { BookingKind } from '@api/tripTypes'
import { KIND_ICON } from './tripUi'
import { useMedia } from './Phone'
import { Sheet } from './Sheet'

type Props = {
  code: string
  title: string
  kind?: BookingKind
  // One line: time and place.
  line?: string
  onCopy: (code: string) => void
  // Shows an "Edit" button on the slip (the booking's code can be changed there).
  onEdit?: () => void
  compact?: boolean
}

const Slip: React.FC<
  Pick<Props, 'code' | 'title' | 'kind' | 'line' | 'onCopy'> & { onEdit?: () => void }
> = ({ code, title, kind, line, onCopy, onEdit }) => {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])
  const root = useRef<HTMLDivElement>(null)
  // The slip is a dialog: focus moves into it when it opens.
  useEffect(() => {
    // After the popover is in the page (its portal attaches a frame later).
    const id = requestAnimationFrame(() => root.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    // biome-ignore lint/a11y/useSemanticElements: a popover dialog anchored to its button
    <div
      ref={root}
      className="trip-slip"
      role="dialog"
      aria-label={`Ticket for ${title}`}
      tabIndex={-1}
    >
      <p className="trip-slip-title">
        <span className="trip-slip-icon">{KIND_ICON[kind ?? 'ticket']}</span>
        {title}
      </p>
      {line && <p className="trip-slip-line">{line}</p>}
      <p className="trip-slip-code" aria-label={`Confirmation code for ${title}`}>
        {code}
      </p>
      <Button
        shape="round"
        size="small"
        className="trip-slip-copy"
        onClick={() => {
          onCopy(code)
          setCopied(true)
        }}
        aria-label={copied ? 'Copied' : `Copy code for ${title}`}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
      {onEdit && (
        <Button type="link" size="small" onClick={onEdit}>
          Edit
        </Button>
      )}
    </div>
  )
}

/** "Show code" opens a ticket slip: a popover on desktop, a small bottom sheet on the phone.
 *  The code is never shown until asked for, and nothing underneath moves. */
export const CodeReveal: React.FC<Props> = ({ compact, onEdit, ...slip }) => {
  const [open, setOpen] = useState(false)
  const desktop = useMedia('(min-width: 1024px)')
  // Esc closes the slip, and only the slip (not the sheet it was opened from).
  useEffect(() => {
    if (!open || !desktop) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, desktop])
  const edit = onEdit
    ? () => {
        setOpen(false)
        onEdit()
      }
    : undefined
  const button = (
    <Button
      size={compact ? 'small' : 'middle'}
      shape="round"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={desktop ? undefined : () => setOpen(true)}
    >
      Show code
    </Button>
  )
  if (desktop) {
    return (
      <Popover
        trigger="click"
        placement="bottomLeft"
        open={open}
        onOpenChange={setOpen}
        overlayClassName="trip-gaps-pop trip-slip-pop"
        destroyTooltipOnHide
        content={<Slip {...slip} onEdit={edit} />}
      >
        {button}
      </Popover>
    )
  }
  return (
    <>
      {button}
      <Sheet
        bare
        open={open}
        title={`Ticket for ${slip.title}`}
        className="trip-slip-drawer"
        onClose={() => setOpen(false)}
      >
        {open ? <Slip {...slip} onEdit={edit} /> : null}
      </Sheet>
    </>
  )
}
