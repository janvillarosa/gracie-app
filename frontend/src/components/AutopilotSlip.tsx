import { useEffect, useRef, useState } from 'react'
import { Repeat, X } from '@phosphor-icons/react'
import { Button } from '@components/ui'
import { addedLine } from '@lib/autopilot'

/** How long the slip takes to fold away (styles.css, .autopilot-reveal.is-leaving). */
export const AUTOPILOT_SLIP_EXIT_MS = 240

type Props = {
  /** What autopilot put on the list for the run, in list order. */
  names: string[]
  runAt: Date
  now: Date
  /** Takes every one of the run's adds off the list; resolves true when it worked. */
  onUndoAll: () => Promise<boolean>
  /** The slip has gone (after Got it, or after Undo all worked): remember the run as seen. */
  onDismiss: () => void
}

function namesLine(names: string[]): string {
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

const reduced = () =>
  !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Once per planned run, in assist mode: what autopilot added and for when, with Undo all. A slip
 *  lying on the list's sheet like the suggestion slip, but with no key: nothing here needs doing.
 *  It settles in once, and folds its space away when it goes so the list closes up smoothly. */
export function AutopilotSlip({ names, runAt, now, onUndoAll, onDismiss }: Props) {
  const [undoing, setUndoing] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])

  const leave = () => {
    if (leaving) return
    setLeaving(true)
    timer.current = setTimeout(onDismiss, reduced() ? 0 : AUTOPILOT_SLIP_EXIT_MS)
  }
  const undoAll = async () => {
    setUndoing(true)
    const ok = await onUndoAll()
    setUndoing(false)
    if (ok) leave()
  }

  if (names.length === 0) return null
  const busy = undoing || leaving
  return (
    <div className={leaving ? 'autopilot-reveal is-leaving' : 'autopilot-reveal'}>
      <div className="autopilot-clip">
        <section className="autopilot-slip" aria-label="Added by autopilot">
          <span className="autopilot-slip-mark" aria-hidden>
            <Repeat weight="bold" />
          </span>
          <div className="autopilot-slip-text">
            <span className="autopilot-slip-title">{addedLine(names.length, runAt, now)}</span>
            <span className="autopilot-slip-names" title={names.join(', ')}>
              {namesLine(names)}
            </span>
          </div>
          <Button
            kind="quiet"
            className="autopilot-slip-undo"
            onClick={() => void undoAll()}
            disabled={busy}
          >
            {undoing ? 'Undoing…' : 'Undo all'}
          </Button>
          <Button iconOnly title="Got it" aria-label="Got it" onClick={leave} disabled={busy}>
            <X size={18} aria-hidden />
          </Button>
        </section>
      </div>
    </div>
  )
}
