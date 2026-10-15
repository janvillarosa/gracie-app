import React, { useEffect, useRef, useState } from 'react'
import { parseClock, stepClock } from '@lib/trips/clock'
import { InlineSelect } from './InlineSelect'
import './ui.css'

type Day = { value: string | null; label: string }

type Props = {
  // The row's label ("When", "Starts", "Ends").
  label?: string
  days: Day[]
  day: string | null
  time: string | null
  length?: number | null
  // A todo can sit in the Ideas (no day); a booking cannot.
  allowIdeas?: boolean
  // Offer a length once there is a time (todos only).
  withLength?: boolean
  clearableTime?: boolean
  disabled?: boolean
  // Opened from an overlap line to change the time: the time field takes focus.
  autoFocusTime?: boolean
  // A zone note after the time ("WET"), when it differs from the trip's.
  suffix?: string
  // Names the controls for screen readers: "Day", "Start time".
  dayLabel?: string
  timeLabel?: string
  onDay: (day: string | null) => void
  onTime: (time: string | null) => void
  onLength?: (min: number | null) => void
}

const IDEAS = '__ideas__'
const LENGTHS = [
  { value: 0, label: 'None' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 h' },
  { value: 120, label: '2 h' },
  { value: 240, label: 'Half day' },
]

/** Day, time and length in one place, with no picker: a day select, a time you type (or nudge by
 *  15 minutes with ↑/↓), and the length as a row of segments. Rows of a detail group. */
export const InlineWhen: React.FC<Props> = ({
  label = 'When',
  days,
  day,
  time,
  length,
  allowIdeas,
  withLength,
  clearableTime,
  disabled,
  autoFocusTime,
  suffix,
  dayLabel = 'Day',
  timeLabel = 'Time',
  onDay,
  onTime,
  onLength,
}) => {
  const [text, setText] = useState(time ?? '')
  const [bad, setBad] = useState(false)
  const timeRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (autoFocusTime) timeRef.current?.focus({ preventScroll: true })
  }, [autoFocusTime])
  // A change from elsewhere (an undo, another device) replaces what is shown.
  useEffect(() => {
    setText(time ?? '')
    setBad(false)
  }, [time])

  const options = [
    ...(allowIdeas ? [{ value: IDEAS, label: 'Ideas (no day yet)' }] : []),
    ...days
      .filter((d) => d.value !== null)
      .map((d) => ({ value: d.value as string, label: d.label })),
    ...(day && !days.some((d) => d.value === day) ? [{ value: day, label: day }] : []),
  ]

  const commit = (raw: string) => {
    const v = raw.trim()
    if (!v) {
      if (clearableTime || !time) {
        setBad(false)
        if (time) onTime(null)
      } else {
        setText(time)
      }
      return
    }
    const p = parseClock(v)
    if (!p) {
      setBad(true)
      return
    }
    setBad(false)
    setText(p)
    if (p !== time) onTime(p)
  }

  const presets = LENGTHS.some((l) => l.value === (length ?? 0))
  const lengths = presets
    ? LENGTHS
    : [...LENGTHS, { value: length as number, label: `${length} min` }]

  return (
    <>
      <div className="ui-inline-row">
        <span className="ui-navrow-label" aria-hidden>
          {label}
        </span>
        <div className="ui-inlinewhen">
          <InlineSelect
            label={dayLabel}
            value={day ?? IDEAS}
            options={options}
            disabled={disabled}
            className="is-day"
            onChange={(v) => onDay(v === IDEAS ? null : v)}
          />
          <input
            ref={timeRef}
            type="text"
            className={['ui-timefield', bad ? 'has-error' : ''].filter(Boolean).join(' ')}
            inputMode="numeric"
            autoComplete="off"
            maxLength={7}
            aria-label={timeLabel}
            aria-invalid={bad}
            placeholder="No time"
            value={text}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value)
              setBad(false)
            }}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit(e.currentTarget.value)
              } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                // Shift moves by an hour, plain by a quarter.
                const step = (e.shiftKey ? 60 : 15) * (e.key === 'ArrowUp' ? 1 : -1)
                const next = stepClock(parseClock(e.currentTarget.value) ?? time, step)
                setText(next)
                setBad(false)
                if (next !== time) onTime(next)
              }
            }}
          />
          {suffix && <span className="ui-inline-suffix">{suffix}</span>}
        </div>
      </div>
      {bad && (
        <div className="ui-inline-hint" role="alert">
          Try a time like 14:30.
        </div>
      )}
      {withLength && time && onLength && (
        <div className="ui-inline-row">
          <span className="ui-navrow-label" aria-hidden>
            Length
          </span>
          <div className="ui-segments" role="group" aria-label="Length">
            {lengths.map((l) => (
              <button
                key={l.value}
                type="button"
                className="ui-segment"
                aria-pressed={(length ?? 0) === l.value}
                disabled={disabled}
                onClick={() => onLength(l.value || null)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
