import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './ui.css'

type Props = {
  title: string
  lines: string[]
  /** Called once, when the hold ends or on a tap. */
  onDone: () => void
  holdMs?: number
}

// How long the slip takes to lift away at the end of its hold (matches --dur-fast).
const LEAVE_MS = 160

/** The little rubber stamp that comes down on the slip and lifts away (drawn in ink and neutrals;
 *  shown only when motion is allowed). */
function StampTool() {
  return (
    <svg
      className="ui-rubber-stamp-tool"
      viewBox="0 0 56 64"
      role="presentation"
      aria-hidden
      focusable="false"
    >
      <rect className="knob" x="17" y="1" width="22" height="15" rx="7.5" />
      <rect className="neck" x="24" y="14" width="8" height="17" rx="2" />
      <rect className="body" x="5" y="29" width="46" height="16" rx="5" />
      <rect className="plate" x="8" y="45" width="40" height="7" rx="2.5" />
    </svg>
  )
}

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** A moment, not a control: a paper slip pops into the middle of the screen with an inked mark
 *  pressed into it (a shopping run done), rests a beat, then lifts away. It never blocks the page;
 *  a tap or Esc dismisses it. Screen readers hear it once, politely. */
export function RubberStamp({ title, lines, onDone, holdMs = 2500 }: Props) {
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
  // A portal: a sheet is transformed, which would make `position: fixed` relative to the sheet.
  // On the body it is fixed to the screen.
  return createPortal(
    <div className="ui-rubber-stamp-anchor">
      <div
        role="status"
        aria-live="polite"
        aria-label={[title, ...lines].join('. ')}
        className={`ui-rubber-stamp${still ? ' is-still' : ''}${leaving ? ' is-leaving' : ''}`}
        onClick={finish}
      >
        <span className="ui-rubber-stamp-mark">
          <StampTool />
          <span className="ui-rubber-stamp-title">{title}</span>
        </span>
        {lines.map((l) => (
          <span key={l} className="ui-rubber-stamp-line">
            {l}
          </span>
        ))}
      </div>
    </div>,
    document.body,
  )
}
