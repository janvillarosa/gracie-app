import { useEffect } from 'react'
import { isLiteMotion } from '@lib/motion'

const clamp = (n: number) => Math.min(1, Math.max(0, n))

/** Writes `--p` (0 to 1) on the element as the page scrolls, for CSS to move things with, so motion
 *  never re-renders React. `leave`: 0 while the element's top is at or below the top of the
 *  screen, 1 once it has scrolled fully past it (the hero coming apart). `through`: 0 as the
 *  element enters at the bottom, 1 as it leaves at the top. One write per frame, and only while
 *  the element is on screen. Nothing runs with reduced motion or on the lite motion tier, so CSS falls back
 *  to its resting value. */
export function useScrollProgress(
  ref: React.RefObject<HTMLElement | null>,
  mode: 'leave' | 'through',
) {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    // Lite tier: a style write on every scroll frame is the cost being saved; rest as above.
    if (isLiteMotion()) return
    let frame = 0
    let onScreen = false
    const write = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight
      const p = mode === 'leave' ? clamp(-r.top / r.height) : clamp((vh - r.top) / (vh + r.height))
      el.style.setProperty('--p', p.toFixed(3))
    }
    const queue = () => {
      if (onScreen && !frame) frame = requestAnimationFrame(write)
    }
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting
      queue()
    })
    io.observe(el)
    window.addEventListener('scroll', queue, { passive: true })
    window.addEventListener('resize', queue)
    return () => {
      io.disconnect()
      window.removeEventListener('scroll', queue)
      window.removeEventListener('resize', queue)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ref, mode])
}
