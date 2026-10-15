import React, { useState } from 'react'
import { Button } from '@components/ui'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { addDays, diffDays, localDateKey } from '@lib/trips/schedule'

type Props = {
  start?: string | null
  end?: string | null
  onChange: (start: string | null, end: string | null) => void
  // Shown once a range exists: closes the sheet.
  onDone?: () => void
}

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const FULL = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const firstOf = (key: string) => `${key.slice(0, 7)}-01`
const utc = (key: string) => new Date(`${key}T00:00:00Z`)
const shiftMonth = (key: string, n: number) => {
  const d = utc(firstOf(key))
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

/** One calendar for a date range: tap the first day, then the last. A single day is a trip
 *  too (tap the same day again). Saves as you pick; there is no Done. */
export const RangeCalendar: React.FC<Props> = ({ start, end, onChange, onDone }) => {
  const [month, setMonth] = useState(firstOf(start ?? localDateKey()))
  const first = utc(month)
  // Monday-first offset for the 1st.
  const lead = (first.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const cells: Array<string | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => addDays(month, i)),
  ]
  // Always six weeks, so the sheet never changes height between taps or months.
  while (cells.length < 42) cells.push(null)
  const choosingEnd = !!start && start === end

  const pick = (d: string) => {
    if (choosingEnd) {
      // Second tap: the last day (or the same day again for a single-day trip).
      if (d >= (start as string)) onChange(start as string, d)
      else onChange(d, d)
    } else onChange(d, d)
  }

  return (
    <div className="trip-cal">
      <div className="trip-cal-head">
        <Button
          kind="text"
          iconOnly
          icon={<CaretLeft />}
          aria-label="Previous month"
          onClick={() => setMonth(shiftMonth(month, -1))}
        />
        <strong>{MONTH.format(first)}</strong>
        <Button
          kind="text"
          iconOnly
          icon={<CaretRight />}
          aria-label="Next month"
          onClick={() => setMonth(shiftMonth(month, 1))}
        />
      </div>
      <div className="trip-cal-grid" role="grid" aria-label={MONTH.format(first)}>
        {WEEK.map((w) => (
          <span key={w} className="trip-cal-wd" aria-hidden>
            {w[0]}
          </span>
        ))}
        {cells.map((d, i) =>
          d === null ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: blank leading cells have no identity
            <span key={`b${i}`} />
          ) : (
            <button
              key={d}
              type="button"
              className={[
                'trip-cal-day',
                d === start ? 'is-start' : '',
                d === end ? 'is-end' : '',
                start && end && d > start && d < end ? 'is-in' : '',
                d === localDateKey() ? 'is-today' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label={FULL.format(utc(d))}
              aria-pressed={d === start || d === end}
              onClick={() => pick(d)}
            >
              {Number(d.slice(8))}
            </button>
          ),
        )}
      </div>
      <div className="trip-cal-foot">
        <p className="trip-help" role="status">
          {/* The range and its length are the sheet's context line; this says only what to do next. */}
          {start && choosingEnd ? 'Pick the last day, or keep it to one day.' : ''}
        </p>
        <Button
          kind="text"
          className="trip-cal-clear"
          hidden={!start}
          onClick={() => onChange(null, null)}
        >
          Clear dates
        </Button>
        {onDone && (
          <Button kind="key" hidden={!start} onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </div>
  )
}
