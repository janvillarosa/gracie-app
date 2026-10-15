import { useEffect, useRef } from 'react'

// The rows an inspector can switch between: the ones in the same pane as the open item (the day
// list or the Ideas list), in the order you read them. "Tonight" repeats are not separate rows.
export function neighbourIds(selected: string): string[] {
  const current = document.getElementById(`row-${selected}`)
  const pane = current?.closest('.trip-days-col, .trip-ideas-col')
  if (!pane) return []
  const ids: string[] = []
  for (const el of pane.querySelectorAll<HTMLElement>('li[id^="row-"]')) {
    if (el.id.startsWith('row-tonight-') || el.closest('[hidden]')) continue
    const id = el.id.slice(4)
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

const editable = (el: Element | null) =>
  !!el &&
  (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ||
    (el as HTMLElement).isContentEditable ||
    el.getAttribute('role') === 'combobox')

/** Master-detail on a desk: with an item open in the inspector, Alt+Down / Alt+Up (anywhere,
 *  fields included) or J / K (when you are not typing) open the next or previous item in its
 *  list. The Days pane stays put except to bring the new row into view, and focus ends up in the
 *  inspector so the next key goes there. */
export function useInspectorKeys(
  enabled: boolean,
  selected: string | null,
  open: (id: string, position: number, total: number) => void,
) {
  const openRef = useRef(open)
  openRef.current = open
  useEffect(() => {
    if (!enabled || !selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey) return
      let dir = 0
      if (e.altKey && !e.shiftKey) {
        if (e.key === 'ArrowDown') dir = 1
        else if (e.key === 'ArrowUp') dir = -1
      } else if (!e.altKey && !e.shiftKey && !editable(document.activeElement)) {
        if (e.key === 'j') dir = 1
        else if (e.key === 'k') dir = -1
      }
      if (!dir) return
      // Not while another overlay (a picker, the discard question) is in front of the inspector.
      const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]')
      if (dialogs.length > 1) return
      const ids = neighbourIds(selected)
      const at = ids.indexOf(selected)
      const next = ids[at + dir]
      e.preventDefault()
      if (at < 0 || next === undefined) return
      openRef.current(next, at + dir + 1, ids.length)
      requestAnimationFrame(() => {
        const panel = document.querySelector<HTMLElement>(
          '.trip-side [role="dialog"], .trip-inspector-overlay [role="dialog"]',
        )
        if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true })
      })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [enabled, selected])
}
