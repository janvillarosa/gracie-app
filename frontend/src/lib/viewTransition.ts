import { useCallback } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import type { NavigateOptions, To } from 'react-router-dom'

type ViewTransitionDoc = Document & { startViewTransition?: (update: () => void) => unknown }

// Runs a DOM-changing update inside a View Transition so the browser cross-fades the
// old and new page and morphs elements that share a `view-transition-name` (the logo).
// Falls back to a plain update where the API is missing or motion is reduced.
export function withViewTransition(update: () => void) {
  const doc = document as ViewTransitionDoc
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!doc.startViewTransition || reduce) {
    update()
    return
  }
  doc.startViewTransition(() => {
    // React must commit the new route before the browser snapshots the "after" state.
    flushSync(update)
  })
}

export function useTransitionNavigate() {
  const navigate = useNavigate()
  return useCallback(
    (to: To, options?: NavigateOptions) => withViewTransition(() => navigate(to, options)),
    [navigate],
  )
}
