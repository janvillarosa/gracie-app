import type React from 'react'
import { useEffect } from 'react'

const ROW = '[data-row-id]'

/** The list desk's keyboard for rows (`ItemRow keyNav`): one row is in the tab order, ↑/↓ move
 *  between rows, Space ticks, Delete or Backspace removes (with the usual Undo) and moves on to
 *  the next row, Enter edits the name. Each key presses the row's own control, so the keyboard and
 *  the pointer share one path (the leave animation, the Undo toast, the confetti). Only keys
 *  pressed on the row itself count: typing in the name editor, the composer or the notes is
 *  never a shortcut. */
export function useRowKeys(container: React.RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const root = container.current
    if (!enabled || !root) return
    const rows = () => [...root.querySelectorAll<HTMLElement>(ROW)]
    // Exactly one row is tabbable: the one last focused, else the first.
    const rove = (to?: Element | null) => {
      const all = rows()
      const cur = (to as HTMLElement | null) ?? all.find((r) => r.tabIndex === 0) ?? all[0]
      for (const r of all) r.tabIndex = r === cur ? 0 : -1
    }
    const onFocusIn = (e: FocusEvent) => rove((e.target as HTMLElement).closest(ROW))
    const onKey = (e: KeyboardEvent) => {
      const row = e.target as HTMLElement
      if (!row.matches?.(ROW) || e.metaKey || e.ctrlKey || e.altKey) return
      const all = rows()
      const i = all.indexOf(row)
      if (e.key === 'ArrowDown') all[i + 1]?.focus()
      else if (e.key === 'ArrowUp') all[i - 1]?.focus()
      else if (e.key === ' ') row.querySelector<HTMLElement>('input[type="checkbox"]')?.click()
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        const next = all[i + 1] ?? all[i - 1]
        row.querySelector<HTMLElement>('.item-delete')?.click()
        next?.focus()
      } else if (e.key === 'Enter') row.querySelector<HTMLElement>('.item-text')?.click()
      else return
      e.preventDefault()
    }
    // Rows come and go (adds, deletes, folds): keep one of them tabbable.
    const watch = new MutationObserver(() => rove())
    root.addEventListener('keydown', onKey)
    root.addEventListener('focusin', onFocusIn)
    watch.observe(root, { childList: true, subtree: true })
    rove()
    return () => {
      root.removeEventListener('keydown', onKey)
      root.removeEventListener('focusin', onFocusIn)
      watch.disconnect()
    }
  }, [container, enabled])
}
