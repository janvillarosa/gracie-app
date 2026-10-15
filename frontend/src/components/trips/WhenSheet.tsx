import React from 'react'
import { RangeCalendar } from './RangeCalendar'
import { Sheet } from './Sheet'

type Props = {
  start?: string | null
  end?: string | null
  onChange: (start: string | null, end: string | null) => void
  onClose: () => void
}

/** "When": the one range calendar in a sheet. Used by Trip settings and by the empty trip. */
export const WhenSheet: React.FC<Props> = ({ start, end, onChange, onClose }) => (
  <Sheet title="When" onClose={onClose}>
    <div className="trip-sheet-pad">
      <RangeCalendar start={start} end={end} onChange={onChange} onDone={onClose} />
    </div>
  </Sheet>
)
