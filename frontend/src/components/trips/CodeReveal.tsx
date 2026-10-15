import React, { useEffect, useState } from 'react'
import { Button, Drawer, Popover } from 'antd'
import type { BookingKind } from '@api/tripTypes'
import { KIND_ICON } from './tripUi'
import { useMedia } from './Phone'

type Props = {
  code: string
  title: string
  kind?: BookingKind
  // One line: time and place.
  line?: string
  onCopy: (code: string) => void
  compact?: boolean
}

const Slip: React.FC<Pick<Props, 'code' | 'title' | 'kind' | 'line' | 'onCopy'>> = ({
  code,
  title,
  kind,
  line,
  onCopy,
}) => {
  const [copied, setCopied] = useState(false)
  return (
    <div className="trip-slip">
      <p className="trip-slip-title">
        <span className="trip-slip-icon">{KIND_ICON[kind ?? 'ticket']}</span>
        {title}
      </p>
      {line && <p className="trip-slip-line">{line}</p>}
      <p className="trip-slip-code" aria-label={`Confirmation code for ${title}`}>
        {code}
      </p>
      <Button
        type="text"
        onClick={() => {
          onCopy(code)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
        aria-label={copied ? 'Copied' : `Copy code for ${title}`}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

/** "Show code" opens a ticket slip: a popover on desktop, a small bottom sheet on the phone.
 *  The code is never shown until asked for, and nothing underneath moves. */
export const CodeReveal: React.FC<Props> = ({ compact, ...slip }) => {
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
        content={<Slip {...slip} />}
      >
        {button}
      </Popover>
    )
  }
  return (
    <>
      {button}
      {open && (
        <Drawer
          open
          placement="bottom"
          height="auto"
          onClose={() => setOpen(false)}
          title={<span className="sr-only">Ticket for {slip.title}</span>}
          className="trip-sheet-drawer trip-slip-drawer"
          destroyOnClose
        >
          <Slip {...slip} />
        </Drawer>
      )}
    </>
  )
}
