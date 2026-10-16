import { TransitionLink } from '@components/TransitionLink'
import type React from 'react'
import { useEffect, useState } from 'react'

// The strip at the bottom of the screen that the key takes up, with its padding.
const KEY_BAND = 96

/** Phones only: once the first "Get started free" has scrolled away, a key waits at the bottom of
 *  the screen within thumb reach. It steps aside whenever another way to start is on screen
 *  (`avoid`: the inline keys, the closing sentence, the footer), so two identical keys never stack,
 *  and whenever a product picture (`spare`) reaches the strip it would cover, so it never hides a
 *  row of a demo. Decided from where those parts are on screen at each scroll. */
export const StickyKey: React.FC<{ away: string; avoid: string; spare: string }> = ({
  away,
  avoid,
  spare,
}) => {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const first = document.querySelector(away)
    const ends = Array.from(document.querySelectorAll(avoid))
    const pictures = Array.from(document.querySelectorAll(spare))
    if (!first) return
    // A few rects per scroll event is cheap, and React ignores a state that hasn't changed.
    const update = () => {
      const h = window.innerHeight
      const gone = first.getBoundingClientRect().bottom < 0
      const onScreen = ends.some((el) => {
        const r = el.getBoundingClientRect()
        return r.top < h && r.bottom > 0
      })
      const wouldCover = pictures.some((el) => {
        const r = el.getBoundingClientRect()
        return r.top < h && r.bottom > h - KEY_BAND
      })
      setShow(gone && !onScreen && !wouldCover)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [away, avoid, spare])

  return (
    <div className={show ? 'ld-sticky is-on' : 'ld-sticky'} aria-hidden={!show}>
      <TransitionLink to="/register" className="ld-key is-large is-wide" tabIndex={show ? 0 : -1}>
        Get started free
      </TransitionLink>
    </div>
  )
}
