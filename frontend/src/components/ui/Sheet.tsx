import React, { useCallback, useEffect, useRef, useState } from 'react'
// Ant stays here as an internal primitive only: nothing else in the trip screens or the
// House's overlays imports Modal, Drawer or Popover.
import { Drawer, Modal, Popover } from 'antd'
import { X } from '@phosphor-icons/react'
import { Button } from './Button'
import { SheetActions } from './SheetActions'
import { SheetIdentity } from './SheetIdentity'
import { useMedia, WIDE } from './useMedia'
import './ui.css'

export type SheetVariant = 'sheet' | 'panel' | 'slip' | 'confirm' | 'chips'

type Props = {
  // sheet: the default. panel: the editor docked over the map (wide screens). slip: a ticket
  // code. confirm: a small destructive question. chips: a picker (a popover on wide screens,
  // a small sheet elsewhere, hanging from `anchor`).
  variant?: SheetVariant
  // Controlled: closing (not unmounting) lets focus return to what opened it.
  open?: boolean
  onClose: () => void
  // The accessible name when it is not the visible title (an editable title, say).
  label?: string
  // Shorthand for <SheetIdentity title={title} /> when there is nothing else in the identity.
  title?: string
  // The four tiers, always in this order whatever the order of the props: identity, then do,
  // then details, then footer. `children` is a free body (a calendar) between do and details.
  identity?: React.ReactNode
  actions?: React.ReactNode
  details?: React.ReactNode
  footer?: React.ReactNode
  children?: React.ReactNode
  // chips and slip on wide screens hang from this element; `onOpen` is asked when it is pressed.
  anchor?: React.ReactElement
  onOpen?: () => void
  // Anything entered that closing would lose: ask first ("Discard this?").
  dirty?: boolean
  discardTitle?: string
  // Something small beside the close key (a "more" menu).
  menu?: React.ReactNode
  className?: string
}

const SWIPE_PX = 60

type BodyProps = Pick<
  Props,
  'identity' | 'actions' | 'details' | 'footer' | 'children' | 'title' | 'className' | 'menu'
> & {
  variant: SheetVariant
  name: string
  handle: boolean
  onRequestClose: () => void
  role?: 'dialog'
}

const SheetBody: React.FC<BodyProps> = ({
  variant,
  name,
  handle,
  onRequestClose,
  identity,
  actions,
  details,
  footer,
  children,
  title,
  className,
  menu,
  role,
}) => {
  const root = useRef<HTMLDivElement>(null)
  const swipe = useRef<number | null>(null)
  // Focus goes to the first field (or the title), unless something inside already has it.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = root.current
      if (!el || el.contains(document.activeElement)) return
      ;(
        el.querySelector<HTMLElement>('input, textarea, [autofocus]') ??
        el.querySelector<HTMLElement>('.ui-sheet-x')
      )?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div
      ref={root}
      className={['ui-sheet', `is-${variant}`, className ?? ''].filter(Boolean).join(' ')}
      role={role}
      aria-label={role ? name : undefined}
    >
      <header
        className="ui-sheet-header"
        // A swipe down on the header closes (phones).
        onPointerDown={handle ? (e) => (swipe.current = e.clientY) : undefined}
        onPointerUp={
          handle
            ? (e) => {
                if (swipe.current !== null && e.clientY - swipe.current > SWIPE_PX) onRequestClose()
                swipe.current = null
              }
            : undefined
        }
      >
        {handle && <span className="ui-sheet-handle" aria-hidden />}
        {menu}
        <Button
          kind="text"
          className="ui-sheet-x"
          aria-label="Close"
          icon={<X aria-hidden />}
          onClick={onRequestClose}
        />
      </header>
      <div className="ui-sheet-scroll">
        {identity ?? (title ? <SheetIdentity title={title} /> : null)}
        {actions}
        {children}
        {details}
        {footer}
      </div>
    </div>
  )
}

// Open overlays, innermost last: only the top one answers Esc.
const openStack: symbol[] = []

/** The one overlay of the trip screens (and the House's New list / Rename list). Header: a drag
 *  handle on phones and a close key on every variant. Body: the four tiers, in order. It closes
 *  with the key, Esc, the scrim and a swipe down; asks before throwing away `dirty` work; keeps
 *  focus inside and gives it back to the opener. */
export const Sheet: React.FC<Props> = ({
  variant = 'sheet',
  open = true,
  onClose,
  label,
  title,
  identity,
  actions,
  details,
  footer,
  children,
  anchor,
  onOpen,
  dirty,
  discardTitle = 'Discard this?',
  menu,
  className,
}) => {
  const wide = useMedia(WIDE)
  const [asking, setAsking] = useState(false)
  const name = label ?? title ?? 'Dialog'
  const requestClose = useCallback(() => {
    if (dirty) setAsking(true)
    else onClose()
  }, [dirty, onClose])

  // Esc closes the topmost open overlay (and only that), before anything underneath hears it.
  const docked = wide && variant === 'panel'
  const id = useRef(Symbol('sheet')).current
  useEffect(() => {
    if (!open || docked) return
    openStack.push(id)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || openStack[openStack.length - 1] !== id) return
      e.preventDefault()
      e.stopPropagation()
      requestClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      const at = openStack.indexOf(id)
      if (at >= 0) openStack.splice(at, 1)
    }
  }, [open, docked, id, requestClose])

  // The docked panel: Esc closes it wherever focus has gone, unless something inside took Esc.
  const closeRef = useRef(requestClose)
  closeRef.current = requestClose
  useEffect(() => {
    if (!open || !docked) return
    const opener = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.({ preventScroll: true })
    }
  }, [open, docked])

  const body = (handle: boolean, role?: 'dialog') => (
    <SheetBody
      variant={variant}
      name={name}
      handle={handle}
      role={role}
      onRequestClose={requestClose}
      identity={identity}
      actions={actions}
      details={details}
      footer={footer}
      title={title}
      menu={menu}
    >
      {children}
    </SheetBody>
  )

  const confirm = dirty ? (
    <Sheet
      variant="confirm"
      open={asking}
      label={discardTitle}
      onClose={() => setAsking(false)}
      identity={<SheetIdentity title={discardTitle} context="What you entered will be lost." />}
      actions={
        <SheetActions>
          <Button kind="quiet" onClick={() => setAsking(false)}>
            Keep editing
          </Button>
          <Button
            kind="key"
            danger
            onClick={() => {
              setAsking(false)
              onClose()
            }}
          >
            Discard
          </Button>
        </SheetActions>
      }
    />
  ) : null

  if (docked) {
    return open ? (
      <>
        <div className="ui-sheet-panel" role="dialog" aria-label={name}>
          {body(false)}
        </div>
        {confirm}
      </>
    ) : null
  }

  const hiddenTitle = <span className="sr-only">{name}</span>

  if (wide && (variant === 'chips' || variant === 'slip')) {
    return (
      <>
        <Popover
          trigger="click"
          placement="bottomLeft"
          open={open}
          onOpenChange={(o) => (o ? onOpen?.() : requestClose())}
          overlayClassName={`ui-popover is-${variant}`}
          destroyOnHidden
          content={body(false, 'dialog')}
        >
          {anchor ?? <span />}
        </Popover>
        {confirm}
      </>
    )
  }

  const trigger = anchor
    ? React.cloneElement(anchor as React.ReactElement<Record<string, unknown>>, {
        onClick: () => onOpen?.(),
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
      })
    : null

  if (wide && (variant === 'sheet' || variant === 'confirm')) {
    return (
      <>
        {trigger}
        <Modal
          open={open}
          centered
          footer={null}
          closable={false}
          title={hiddenTitle}
          width={variant === 'confirm' ? 380 : 440}
          className={`ui-dialog is-${variant}`}
          onCancel={requestClose}
          destroyOnHidden
          styles={{ mask: { background: 'var(--sheet-scrim)' } }}
        >
          {open ? body(false) : null}
        </Modal>
        {confirm}
      </>
    )
  }

  // Phones (and tablets): a bottom sheet, content height up to 90% of the screen.
  return (
    <>
      {trigger}
      <Drawer
        open={open}
        placement="bottom"
        height="auto"
        closable={false}
        title={hiddenTitle}
        onClose={requestClose}
        destroyOnHidden
        className={`ui-drawer is-${variant} ${className ?? ''}`}
        styles={{ body: { padding: 0 }, mask: { background: 'var(--sheet-scrim)' } }}
      >
        {open ? body(true) : null}
      </Drawer>
      {confirm}
    </>
  )
}
