import { useEffect, useRef } from 'react'
import './ui.css'

type Props = {
  title: string
  lines: string[]
  /** Called once, when the hold ends or on a tap. */
  onDone: () => void
  holdMs?: number
}

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** A moment, not a control: an inked stamp pressed onto the sheet (a shopping run done), held a
 *  beat, then lifted away. It never blocks the page; a tap dismisses it. Screen readers hear it
 *  once, politely. */
export function RubberStamp({ title, lines, onDone, holdMs = 2500 }: Props) {
  const done = useRef(onDone)
  done.current = onDone
  const still = useRef(reducedMotion()).current
  useEffect(() => {
    const id = setTimeout(() => done.current(), holdMs)
    return () => clearTimeout(id)
  }, [holdMs])
  return (
    <div className="ui-rubber-stamp-anchor">
      <div
        role="status"
        aria-live="polite"
        aria-label={[title, ...lines].join('. ')}
        className={`ui-rubber-stamp${still ? ' is-still' : ''}`}
        style={{ '--stamp-hold': `${holdMs}ms` } as React.CSSProperties}
        onClick={() => done.current()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter') done.current()
        }}
      >
        <span className="ui-rubber-stamp-title">{title}</span>
        {lines.map((l) => (
          <span key={l} className="ui-rubber-stamp-line">
            {l}
          </span>
        ))}
      </div>
    </div>
  )
}
