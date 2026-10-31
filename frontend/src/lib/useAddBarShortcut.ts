import { useEffect } from 'react'

/** n or / jumps to the add bar (wide screens), unless you are typing somewhere. */
export function useAddBarShortcut(enabled: boolean, inputId: string) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== 'n' && e.key !== '/')) return
      const el = document.activeElement as HTMLElement | null
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return
      e.preventDefault()
      document.getElementById(inputId)?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [enabled, inputId])
}
