import { useClientLayoutEffect } from '@lib/useClientLayoutEffect'
import { useEffect, useRef, useState } from 'react'

// "Manage your ___ together.": the blank cycles through what a House keeps, and the highlighter
// swipes across each new word the way it marks a new line on a list.
export const HEADLINE_WORDS = ['life', 'groceries', 'chores', 'trips', 'shopping', 'lists'] as const
const HOLD_MS = 2800
const OUT_MS = 200

type Phase = 'in' | 'out'

/** The visible, cycling word. It sits in the text like any other word, so the line's spacing is
 *  the font's own. When it changes, the words before it glide from where they were to where the
 *  new layout puts them (measured, never hardcoded). Hidden from screen readers: the heading
 *  carries a plain "life" for them, so its name never changes under a listener. */
export const HeadlineWord: React.FC<{ lead: React.RefObject<HTMLElement | null> }> = ({ lead }) => {
  const [at, setAt] = useState(0)
  const [phase, setPhase] = useState<Phase>('in')
  const from = useRef<number | null>(null)

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let swap = 0
    const id = window.setInterval(() => {
      if (document.hidden) return
      setPhase('out')
      swap = window.setTimeout(() => {
        from.current = lead.current?.getBoundingClientRect().left ?? null
        setAt((n) => (n + 1) % HEADLINE_WORDS.length)
        setPhase('in')
      }, OUT_MS)
    }, HOLD_MS)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(swap)
    }
  }, [lead])

  // FLIP: the new word changed the line's width; slide the lead words from their old place.
  useClientLayoutEffect(() => {
    const el = lead.current
    const before = from.current
    from.current = null
    if (!el || before === null || !el.animate) return
    const dx = before - el.getBoundingClientRect().left
    if (Math.abs(dx) < 0.5) return
    el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], {
      duration: 380,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    })
  }, [at])

  return (
    <span key={HEADLINE_WORDS[at]} className={`ld-rotor is-${phase}`} aria-hidden="true">
      {HEADLINE_WORDS[at]}
    </span>
  )
}
