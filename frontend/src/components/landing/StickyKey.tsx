import { TransitionLink } from '@components/TransitionLink'
import type React from 'react'
import { useEffect, useState } from 'react'

/** Phones only: once the first "Try Bauhouse free" has scrolled away, a key stays at the bottom
 *  of the screen within thumb reach, and steps aside for the closing sentence and the footer,
 *  where the page asks again. Decided from where those parts are on screen at each scroll. */
export const StickyKey: React.FC<{ away: string; until: string }> = ({ away, until }) => {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const first = document.querySelector(away)
    const ends = Array.from(document.querySelectorAll(until))
    if (!first || ends.length === 0) return
    // Three measurements per scroll event is cheap, and React ignores a state that hasn't changed.
    const update = () => {
      const gone = first.getBoundingClientRect().bottom < 0
      const atEnd = ends.some((el) => {
        const r = el.getBoundingClientRect()
        return r.top < window.innerHeight && r.bottom > 0
      })
      setShow(gone && !atEnd)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [away, until])

  return (
    <div className={show ? 'ld-sticky is-on' : 'ld-sticky'} aria-hidden={!show}>
      <TransitionLink to="/register" className="ld-key is-large is-wide" tabIndex={show ? 0 : -1}>
        Try Bauhouse free
      </TransitionLink>
    </div>
  )
}
