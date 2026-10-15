// What opens from a row of a sheet: day, time, length, category, kind, a linked booking, a note.
// Each is built from the UI primitives and applies its choice at once (sheets autosave).
import React, { useEffect, useRef, useState } from 'react'
import type { Booking, BookingKind, TripCategory } from '@api/tripTypes'
import { notesProblem } from '@lib/trips/limits'
import { shortDay } from '@lib/trips/schedule'
import { Button, ChipGroup, DetailGroup, Field, NavRow, SectionLabel } from '@components/ui'
import type { MoveTarget } from './MoveMenu'
import { BOOKING_KINDS, CATEGORIES, KIND_ICON } from './tripUi'

// ---- day ----------------------------------------------------------------------------------
const IDEAS = '__ideas__'

export type DayRowInfo = { value: string; label: string; note?: string }

/** The days (and Ideas), as rows in one group. */
export const DayPick: React.FC<{
  days: MoveTarget[]
  value: string | null
  allowIdeas?: boolean
  onPick: (day: string | null) => void
  // Extra info per day ("Sintra", "All done"), by date.
  notes?: Record<string, string>
}> = ({ days, value, allowIdeas, onPick, notes }) => {
  const real = days.filter((d) => d.value !== null)
  return (
    <DetailGroup label="Days">
      {real.map((d) => (
        <NavRow
          key={d.value as string}
          label={shortDay(d.value as string)}
          value={notes?.[d.value as string] ?? ''}
          current={d.value === value}
          onClick={() => onPick(d.value)}
        />
      ))}
      {value && !real.some((d) => d.value === value) && (
        <NavRow label={shortDay(value)} value="" current onClick={() => onPick(value)} />
      )}
      {allowIdeas && (
        <NavRow
          label="Ideas"
          value="No day yet"
          current={value === null}
          aria-label="Ideas"
          onClick={() => onPick(null)}
        />
      )}
    </DetailGroup>
  )
}
export { IDEAS }

// ---- time ---------------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0')
const STEPS = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`)

/** Times in 15-minute steps, 24-hour, in a grid; "No time" first when a time can be cleared. */
export const TimePick: React.FC<{
  value: string | null
  clearable?: boolean
  label?: string
  onPick: (time: string | null) => void
}> = ({ value, clearable, label = 'Time', onPick }) => {
  const have = value ?? ''
  const options = [
    ...(clearable ? [{ value: '', label: 'No time' }] : []),
    ...(have && !STEPS.includes(have) ? [{ value: have, label: have }] : []),
    ...STEPS.map((t) => ({ value: t, label: t })),
  ].sort((a, b) => (a.value === '' ? -1 : b.value === '' ? 1 : a.value < b.value ? -1 : 1))
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView?.({ block: 'center' })
  }, [])
  return (
    <div ref={ref} className="trip-timegrid">
      <ChipGroup
        label={`${label} options`}
        value={have}
        options={options}
        columns={4}
        onChange={(v) => onPick(v || null)}
      />
    </div>
  )
}

// ---- length -------------------------------------------------------------------------------
const DURATIONS = [
  { value: '', label: 'No length' },
  { value: '30', label: '30 min' },
  { value: '60', label: '1 h' },
  { value: '120', label: '2 h' },
  { value: '240', label: 'Half day' },
  { value: 'custom', label: 'Custom' },
]

export const lengthText = (min?: number | null) =>
  !min ? '' : (DURATIONS.find((d) => d.value === String(min))?.label ?? `${min} min`)

export const LengthPick: React.FC<{
  value?: number | null
  onPick: (min: number | null) => void
}> = ({ value, onPick }) => {
  const [custom, setCustom] = useState(false)
  const preset = value && DURATIONS.some((d) => d.value === String(value))
  const current = value ? (preset ? String(value) : 'custom') : ''
  if (custom)
    return (
      <form
        className="trip-custom-length"
        onSubmit={(e) => {
          e.preventDefault()
          const v = (e.currentTarget.elements.namedItem('minutes') as HTMLInputElement).value
          const n = v ? Number(v) : null
          if (n === null || (n >= 1 && n <= 1440)) {
            setCustom(false)
            onPick(n)
          }
        }}
      >
        <Field
          name="minutes"
          type="number"
          min={1}
          max={1440}
          inputMode="numeric"
          aria-label="Duration in minutes"
          defaultValue={value ?? ''}
          // biome-ignore lint/a11y/noAutofocus: the field opens because "Custom" was chosen
          autoFocus
        />
        <Button kind="quiet" type="submit">
          Set
        </Button>
      </form>
    )
  return (
    <ChipGroup
      label="Length options"
      value={current}
      options={DURATIONS}
      columns={3}
      onChange={(v) => (v === 'custom' ? setCustom(true) : onPick(v ? Number(v) : null))}
    />
  )
}

// ---- when (day, time and length together) ---------------------------------------------------
export const WhenPick: React.FC<{
  days: MoveTarget[]
  day: string | null
  time: string | null
  length?: number | null
  allowIdeas?: boolean
  // A booking's start or end: no length, no Ideas.
  withLength?: boolean
  clearableTime?: boolean
  timeLabel?: string
  dayNotes?: Record<string, string>
  onDay: (day: string | null) => void
  onTime: (time: string | null) => void
  onLength?: (min: number | null) => void
}> = ({
  days,
  day,
  time,
  length,
  allowIdeas,
  withLength,
  clearableTime,
  timeLabel,
  dayNotes,
  onDay,
  onTime,
  onLength,
}) => (
  <div className="trip-when-pick">
    <SectionLabel>Day</SectionLabel>
    <DayPick days={days} value={day} allowIdeas={allowIdeas} notes={dayNotes} onPick={onDay} />
    <SectionLabel>Time</SectionLabel>
    <TimePick value={time} clearable={clearableTime} label={timeLabel} onPick={onTime} />
    {withLength && time && onLength && (
      <>
        <SectionLabel>Length</SectionLabel>
        <LengthPick value={length} onPick={onLength} />
      </>
    )}
  </div>
)

// ---- category and kind ----------------------------------------------------------------------
export const CategoryPick: React.FC<{
  value: TripCategory
  onPick: (c: TripCategory) => void
}> = ({ value, onPick }) => (
  <ChipGroup
    label="Category"
    value={value}
    options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
    columns={4}
    onChange={onPick}
  />
)

export const KindPick: React.FC<{
  value?: BookingKind
  onPick: (k: BookingKind) => void
}> = ({ value, onPick }) => (
  <ChipGroup
    label="Kind of booking"
    value={value}
    options={BOOKING_KINDS.map((k) => ({
      value: k.value,
      label: k.label,
      icon: KIND_ICON[k.value],
    }))}
    columns={6}
    onChange={onPick}
  />
)

// ---- a linked booking ------------------------------------------------------------------------
export const BookingPick: React.FC<{
  bookings: Booking[]
  value?: string | null
  onPick: (id: string | null) => void
}> = ({ bookings, value, onPick }) => (
  <DetailGroup label="Bookings">
    <NavRow label="None" value="" current={!value} onClick={() => onPick(null)} />
    {bookings.map((b) => (
      <NavRow
        key={b.booking_id}
        label={b.kind}
        value={b.title}
        current={b.booking_id === value}
        aria-label={b.title}
        onClick={() => onPick(b.booking_id)}
      />
    ))}
  </DetailGroup>
)

// ---- a note -----------------------------------------------------------------------------------
/** A note: saved when you leave the field, or when the picker closes with it still open. A note
 *  over the server's byte limit is said inline and not sent. */
export const NotePick: React.FC<{
  value: string
  max: number
  onCommit: (v: string) => void
  label?: string
  placeholder?: string
  // The picker opens to type in it; an inline note is just there, so it does not take focus.
  autoFocus?: boolean
}> = ({ value, max, onCommit, label = 'Notes', placeholder = 'Add a note', autoFocus = true }) => {
  const [problem, setProblem] = useState('')
  const latest = useRef(value)
  const saved = useRef(value)
  const commit = useRef(onCommit)
  commit.current = onCommit
  useEffect(
    () => () => {
      // Closed while typing: keep what was typed (unless it was too long).
      if (latest.current !== saved.current && !notesProblem(latest.current, max))
        commit.current(latest.current)
    },
    [max],
  )
  return (
    <Field
      multiline
      rows={4}
      aria-label={label}
      placeholder={placeholder}
      defaultValue={value}
      error={problem}
      // biome-ignore lint/a11y/noAutofocus: the picker opens to type in it
      autoFocus={autoFocus}
      onChange={(e) => {
        latest.current = e.target.value
        setProblem(notesProblem(e.target.value, max))
      }}
      onBlur={(e) => {
        const p = notesProblem(e.target.value, max)
        setProblem(p)
        if (!p && e.target.value !== saved.current) {
          saved.current = e.target.value
          onCommit(e.target.value)
        }
      }}
    />
  )
}
