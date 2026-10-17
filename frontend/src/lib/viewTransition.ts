import { useCallback } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import type { NavigateOptions, To } from 'react-router-dom'
import { isLiteMotion } from './motion'

type ViewTransitionDoc = Document & { startViewTransition?: (update: () => void) => unknown }

// Runs a DOM-changing update inside a View Transition so the browser cross-fades the
// old and new page and morphs elements that share a `view-transition-name` (the logo).
// Falls back to a plain update where the API is missing, motion is reduced, or the device is on
// the lite motion tier (two full-screen snapshots, re-captured every frame while the new page's
// own entrance plays, is the heaviest thing the app asks of a phone).
export function withViewTransition(update: () => void) {
  const doc = document as ViewTransitionDoc
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!doc.startViewTransition || reduce || isLiteMotion()) {
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
// (briefly, never more than maxMs) until that route fallback gives way, so the crossfade
// lands on the real page. A page waiting on data is not held: its own loading state is
// the right thing to show, and holding would freeze the old page for nothing.
function routeSettled(maxMs = 250): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now()
    const check = () => {
      const busy = document.querySelector('[data-route-fallback]')
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
