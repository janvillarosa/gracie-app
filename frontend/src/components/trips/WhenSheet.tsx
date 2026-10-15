import React from 'react'
import { Sheet, SheetIdentity } from '@components/ui'
import { diffDays, shortRange } from '@lib/trips/schedule'
import { RangeCalendar } from './RangeCalendar'

type Props = {
  start?: string | null
  end?: string | null
  onChange: (start: string | null, end: string | null) => void
  open?: boolean
  onClose: () => void
}

/** "When": the one range calendar in a sheet. Used by Trip settings and by the empty trip. */
export const WhenSheet: React.FC<Props> = ({ start, end, onChange, open = true, onClose }) => {
  const days = start && end ? diffDays(end, start) + 1 : 0
  return (
    <Sheet
      open={open}
      label="When"
      onClose={onClose}
      identity={
        <SheetIdentity
          title="When"
          context={
            start
              ? `${shortRange(start, end)} · ${days} ${days === 1 ? 'day' : 'days'}`
              : 'Pick the first day.'
          }
        />
      }
    >
      <RangeCalendar start={start} end={end} onChange={onChange} onDone={onClose} />
    </Sheet>
  )
}
