import React, { useEffect, useRef } from 'react'

export type MoveTarget = { value: string | null; label: string }

type Props = {
  // What is being moved, for the menu's accessible name.
  title: string
  targets: MoveTarget[]
  current: string | null
  onPick: (value: string | null) => void
  onClose: () => void
}

/** "Move to…": every day plus Ideas, reachable by keyboard. Rendered under the row's button. */
export const MoveMenu: React.FC<Props> = ({ title, targets, current, onPick, onClose }) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const items = ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')
    const start = Array.from(items ?? []).find((el) => el.getAttribute('aria-current') !== 'true')
    ;(start ?? items?.[0])?.focus()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    const go = (n: number) => {
      e.preventDefault()
      items[(n + items.length) % items.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
    else if (e.key === 'Escape' || e.key === 'Tab') {
      e.stopPropagation()
      if (e.key === 'Escape') e.preventDefault()
      onClose()
    }
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Move ${title} to`}
      className="move-menu"
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onClose()
      }}
    >
      {targets.map((t) => (
        <button
          type="button"
          role="menuitem"
          key={t.value ?? 'ideas'}
          className="move-item"
          aria-current={t.value === current ? 'true' : undefined}
          onClick={() => onPick(t.value)}
        >
          {t.label}
          {t.value === current ? <span className="move-here"> · here</span> : null}
        </button>
      ))}
    </div>
  )
}
