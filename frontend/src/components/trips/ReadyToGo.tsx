import React, { useState } from 'react'
import { Check, Circle } from '@phosphor-icons/react'
import { Button, SectionLabel } from '@components/ui'
import type { CheckLine } from '@lib/trips/readiness'

type Props = {
  lines: CheckLine[]
  locked?: boolean
  onFix: (line: CheckLine) => void
}

const Line: React.FC<{ line: CheckLine; locked?: boolean; onFix: (l: CheckLine) => void }> = ({
  line,
  locked,
  onFix,
}) => (
  <li className={line.ok ? 'trip-ready-line is-ok' : 'trip-ready-line is-todo'}>
    {line.ok ? (
      <Check className="trip-ready-mark" weight="bold" aria-label="Done" />
    ) : (
      <Circle className="trip-ready-mark" weight="bold" aria-label="Still to do" />
    )}
    <span className="trip-ready-text">{line.text}</span>
    {line.fix && !locked && (
      <Button kind="text" onClick={() => onFix(line)}>
        {line.fix.label}
      </Button>
    )}
  </li>
)

/** "Ready to go?": before the trip, what is still missing, one line each with its fix. Packing
 *  sits to the right of the others. When every line is done it folds to one line. */
export const ReadyToGo: React.FC<Props> = ({ lines, locked, onFix }) => {
  const [open, setOpen] = useState(false)
  const allOk = lines.every((l) => l.ok)
  if (allOk && !open)
    return (
      <section className="trip-ready is-done" aria-label="Ready to go?">
        <p className="trip-ready-all">
          <Check className="trip-ready-mark" weight="bold" aria-hidden />
          Ready to go
        </p>
        <Button kind="text" aria-expanded={false} onClick={() => setOpen(true)}>
          Details
        </Button>
      </section>
    )
  const main = lines.filter((l) => l.key !== 'packing')
  const packing = lines.find((l) => l.key === 'packing')
  return (
    <section className="trip-ready" aria-label="Ready to go?">
      <div className="trip-ready-main">
        <SectionLabel>Ready to go?</SectionLabel>
        <ul className="trip-ready-list">
          {main.map((l) => (
            <Line key={l.key} line={l} locked={locked} onFix={onFix} />
          ))}
        </ul>
        {allOk && (
          <Button kind="text" aria-expanded onClick={() => setOpen(false)}>
            Hide details
          </Button>
        )}
      </div>
      {packing && (
        <div className="trip-ready-side">
          <SectionLabel>Packing</SectionLabel>
          <ul className="trip-ready-list">
            <Line line={packing} locked={locked} onFix={onFix} />
          </ul>
        </div>
      )}
    </section>
  )
}
