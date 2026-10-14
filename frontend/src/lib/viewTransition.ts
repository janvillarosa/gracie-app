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
    return routeSettled()
  })
}

// A lazy route suspends for a tick even when its chunk is cached. Hold the "after" snapshot
// (briefly, never more than maxMs) until the loading fallback gives way, so it shows the
// real page and the crossfade never lands on a blank skeleton.
function routeSettled(maxMs = 250): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now()
    const check = () => {
      const busy = document.querySelector('main > [aria-busy="true"]')
      if (!busy || performance.now() - start > maxMs) resolve()
      // Not rAF: rendering (and so rAF) is paused while the transition waits on us.
      else setTimeout(check, 16)
    }
    check()
  })
}

export function useTransitionNavigate() {
  const navigate = useNavigate()
  return useCallback(
    (to: To, options?: NavigateOptions) => withViewTransition(() => navigate(to, options)),
    [navigate],
  )
}
