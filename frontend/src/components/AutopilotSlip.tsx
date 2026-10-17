import { Repeat, X } from '@phosphor-icons/react'
import { Button } from '@components/ui'
import { addedLine } from '@lib/autopilot'

type Props = {
  /** What autopilot put on the list for the run, in list order. */
  names: string[]
  runAt: Date
  now: Date
  undoing?: boolean
  onUndoAll: () => void
  onDismiss: () => void
}

function namesLine(names: string[]): string {
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

/** Once per planned run, in assist mode: what autopilot added and for when, with Undo all. A slip
 *  lying on the list's sheet like the suggestion slip, but with no key: nothing here needs doing. */
export function AutopilotSlip({ names, runAt, now, undoing, onUndoAll, onDismiss }: Props) {
  if (names.length === 0) return null
  return (
    <section className="autopilot-slip" aria-label="Added by autopilot">
      <Repeat className="autopilot-slip-mark" weight="bold" aria-hidden />
      <div className="autopilot-slip-text">
        <span className="autopilot-slip-title">{addedLine(names.length, runAt, now)}</span>
        <span className="autopilot-slip-names">{namesLine(names)}</span>
      </div>
      <Button kind="quiet" className="autopilot-slip-undo" onClick={onUndoAll} disabled={undoing}>
        {undoing ? 'Undoing…' : 'Undo all'}
      </Button>
      <Button iconOnly title="Got it" aria-label="Got it" onClick={onDismiss} disabled={undoing}>
        <X size={18} aria-hidden />
      </Button>
    </section>
  )
}
