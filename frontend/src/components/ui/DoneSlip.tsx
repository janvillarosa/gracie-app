import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getCategoryClass } from '@lib/category'
import './ui.css'

type Props = {
  title: string
  /** The plain line ("14 items · 22 min"), then an optional word of praise under a dashed tear. */
  lines: string[]
  /** Called once, when the hold ends, on a tap or on Esc. */
  onDone: () => void
  holdMs?: number
  /** What the run got, one tag per category in its own colour (the colours the list rows use). */
  tags?: { label: string; count: number }[]
}

// How long the slip takes to lift away at the end of its hold (matches --dur-fast).
const LEAVE_MS = 160

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** A moment, not a control: a paper slip rises into the middle of the screen with its title
 *  highlighted (a shopping run done), rests a beat, then lifts away. It never blocks the page and has
 *  no scrim; a tap or Esc dismisses it. Screen readers hear it once, politely. */
export function DoneSlip({ title, lines, onDone, holdMs = 2500, tags }: Props) {
  const done = useRef(onDone)
  done.current = onDone
  const finished = useRef(false)
  const finish = () => {
    if (finished.current) return
    finished.current = true
    done.current()
  }
  const still = useRef(reducedMotion()).current
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    const lift = setTimeout(() => setLeaving(true), holdMs)
    const gone = setTimeout(() => {
      if (finished.current) return
      finished.current = true
      done.current()
    }, holdMs + LEAVE_MS)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || finished.current) return
      finished.current = true
      done.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(lift)
      clearTimeout(gone)
      document.removeEventListener('keydown', onKey)
    }
  }, [holdMs])
  const [detail, praise] = lines
  // A portal: a sheet is transformed, which would make `position: fixed` relative to the sheet.
  // On the body it is fixed to the screen.
  return createPortal(
    <div className="ui-done-anchor">
      <div
        role="status"
        aria-live="polite"
        aria-label={[title, ...lines].join('. ')}
        className={`ui-done${still ? ' is-still' : ''}${leaving ? ' is-leaving' : ''}`}
        onClick={finish}
      >
        <span className="ui-done-title">{title}</span>
        {detail && <span className="ui-done-line">{detail}</span>}
        {tags && tags.length > 0 && (
          <span className="ui-done-tags">
            {tags.map((t) => (
              <span
                key={t.label}
                className={`category-tag ui-done-tag ${getCategoryClass(t.label)}`}
              >
                {t.label} ×{t.count}
              </span>
            ))}
          </span>
        )}
        {praise && <span className="ui-done-praise">{praise}</span>}
      </div>
    </div>,
    document.body,
  )
}
