import React, { useState } from 'react'
import { Button } from 'antd'
import { CaretDown, CaretRight } from '@phosphor-icons/react'
import type { Booking, BookingKind, Place } from '@api/tripTypes'
import { shortDay, zoneLabel } from '@lib/trips/schedule'
import { BOOKING_KINDS, KIND_ICON } from './tripUi'
import { PlacePicker } from './PlacePicker'

export type BookingActions = {
  save: (id: string | null, patch: Record<string, unknown>) => void
  remove: (id: string) => void
  copy: (code: string) => void
}

const kindLabel = (k: BookingKind) => BOOKING_KINDS.find((x) => x.value === k)?.label ?? 'Other'
const clock = (dt?: string | null) => (dt ? dt.split('T')[1] || '' : '')

/** "07:05 London → 09:40 Lisbon" for a flight; the start time for everything else. */
export function bookingWhen(b: Booking): string {
  const start = clock(b.starts_at)
  if (b.kind === 'flight' && b.ends_at) {
    const from = zoneLabel(b.start_tz)
    const to = zoneLabel(b.end_tz || b.start_tz)
    return `${start}${from ? ` ${from}` : ''} → ${clock(b.ends_at)}${to ? ` ${to}` : ''}`
  }
  return start
}

/** One line for a row: "London → Lisbon" for "London to Lisbon"; other titles as they are. */
export function bookingHeadline(b: Booking): string {
  const m = /^(.+?) to (.+)$/.exec(b.title)
  return m && (b.kind === 'flight' || b.kind === 'train') ? `${m[1]} → ${m[2]}` : b.title
}

/** Muted second line: "Tue 13 · 07:05 → 09:40" (a stay across days: "Tue 13 → Fri 16"). */
export function bookingSub(b: Booking): string {
  if (!b.starts_at) return ''
  const [sd, st = ''] = b.starts_at.split('T')
  const [ed, et = ''] = (b.ends_at ?? '').split('T')
  if (ed && ed !== sd) return `${shortDay(sd)} → ${shortDay(ed)}`
  return [shortDay(sd), [st, et].filter(Boolean).join(' → ')].filter(Boolean).join(' · ')
}

const validZone = (z: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: z })
    return true
  } catch {
    return false
  }
}

type EditorProps = {
  booking?: Booking
  tripTz?: string
  bias: { lat: number; lng: number } | null
  // A starting time for a new booking, as a datetime-local value.
  defaultStart?: string
  initialTitle?: string
  onSave: (patch: Record<string, unknown>) => void
  onCancel: () => void
  onDelete?: () => void
}

export const BookingEditor: React.FC<EditorProps> = ({
  booking,
  tripTz,
  bias,
  defaultStart,
  initialTitle,
  onSave,
  onCancel,
  onDelete,
}) => {
  const [kind, setKind] = useState<BookingKind>(booking?.kind ?? 'ticket')
  const [title, setTitle] = useState(booking?.title ?? initialTitle ?? '')
  const [code, setCode] = useState(booking?.confirmation_code ?? '')
  const [startsAt, setStartsAt] = useState(booking?.starts_at ?? defaultStart ?? '')
  const [endsAt, setEndsAt] = useState(booking?.ends_at ?? '')
  const [startTz, setStartTz] = useState(booking?.start_tz ?? tripTz ?? '')
  const [endTz, setEndTz] = useState(booking?.end_tz ?? '')
  const [place, setPlace] = useState<Place | null>(booking?.place ?? null)
  const [notes, setNotes] = useState(booking?.notes ?? '')
  const [error, setError] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return setError('Give the booking a title.')
    if ((startTz && !validZone(startTz)) || (endTz && !validZone(endTz)))
      return setError('Time zones look like Europe/Lisbon.')
    if (startsAt && endsAt && endsAt < startsAt && !endTz && !startTz)
      return setError('The end is before the start.')
    onSave({
      kind,
      title: title.trim(),
      confirmation_code: code.trim(),
      starts_at: startsAt || null,
      ends_at: endsAt || null,
      start_tz: startTz || null,
      end_tz: endTz || null,
      place,
      notes,
    })
  }

  return (
    <form
      className="trip-editor"
      onSubmit={submit}
      aria-label={booking ? 'Edit booking' : 'New booking'}
    >
      <div className="trip-editor-pair">
        <label className="trip-label">
          Kind
          <select
            className="trip-field"
            value={kind}
            onChange={(e) => setKind(e.target.value as BookingKind)}
          >
            {BOOKING_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="trip-label">
          Confirmation code
          <input
            className="trip-field trip-mono"
            value={code}
            maxLength={64}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
      </div>
      <label className="trip-label">
        Title
        <input
          className="trip-field"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <div className="trip-editor-pair">
        <label className="trip-label">
          Starts
          <input
            className="trip-field"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </label>
        <label className="trip-label">
          Start time zone
          <input
            className="trip-field"
            list="trip-zones"
            value={startTz}
            placeholder="Europe/Lisbon"
            onChange={(e) => setStartTz(e.target.value)}
          />
        </label>
      </div>
      <div className="trip-editor-pair">
        <label className="trip-label">
          Ends
          <input
            className="trip-field"
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </label>
        <label className="trip-label">
          End time zone
          <input
            className="trip-field"
            list="trip-zones"
            value={endTz}
            placeholder="Same as start"
            onChange={(e) => setEndTz(e.target.value)}
          />
        </label>
      </div>
      <datalist id="trip-zones">
        {(Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
          .supportedValuesOf?.('timeZone')
          .map((z) => (
            <option key={z} value={z} />
          ))}
      </datalist>
      <div className="trip-label">
        Place
        <PlacePicker
          label="Booking place"
          value={place}
          onChange={setPlace}
          bias={bias}
          tz={tripTz}
        />
      </div>
      <label className="trip-label">
        Notes
        <textarea
          className="trip-field"
          rows={3}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      {error && (
        <div role="alert" className="trip-error">
          {error}
        </div>
      )}
      <div className="trip-editor-foot">
        {onDelete ? (
          <Button size="small" danger onClick={onDelete}>
            Delete booking
          </Button>
        ) : (
          <span />
        )}
        <span className="trip-editor-btns">
          <Button size="small" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="small" type="primary" htmlType="submit">
            Save booking
          </Button>
        </span>
      </div>
    </form>
  )
}

type LineProps = {
  booking: Booking
  past: boolean
  tonight?: boolean
  selected: boolean
  clash?: boolean
  // "Mia changed this after your offline edit", with a way to see theirs.
  note?: { text: string }
  onSeeTheirs?: (id: string) => void
  onOpen: (id: string) => void
}

// In the plan a booking is one quiet line at its time: icon, time, title. The code, both ends
// and the address live in its detail.
export const BookingLine = React.memo<LineProps>(function BookingLine({
  booking: b,
  past,
  tonight,
  selected,
  clash,
  note,
  onSeeTheirs,
  onOpen,
}) {
  const open = tonight ? `tonight-${b.booking_id}` : b.booking_id
  return (
    <li
      id={`row-${open}`}
      data-entry-id={b.booking_id}
      className={[
        'trip-stub',
        past ? 'is-used' : '',
        tonight ? 'is-tonight' : '',
        selected ? 'is-selected' : '',
        clash ? 'is-clash' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        className="trip-stubline"
        aria-haspopup="dialog"
        onClick={() => onOpen(b.booking_id)}
      >
        <span className="trip-stub-icon">{KIND_ICON[b.kind]}</span>
        <span className="trip-time">
          {tonight ? 'Tonight' : (b.starts_at?.split('T')[1] ?? '')}
        </span>
        <span className="trip-stub-title">{b.title}</span>
        {past && <span className="trip-used">Used</span>}
      </button>
      {note && (
        <div className="trip-note" role="status">
          <span>{note.text}</span>
          <Button size="small" type="link" onClick={() => onSeeTheirs?.(b.booking_id)}>
            See theirs
          </Button>
        </div>
      )}
    </li>
  )
})

type PanelProps = {
  bookings: Booking[]
  nowMs: number
  startMs: (b: Booking) => number
  onOpen: (id: string) => void
  locked: boolean
}

/** Every booking, grouped by kind. A row is just the trip: tap it for the sheet, where the
 *  code lives. Bookings that are over fold into one "used" line. */
export const BookingsPanel: React.FC<PanelProps> = ({ bookings, nowMs, startMs, onOpen }) => {
  const [showUsed, setShowUsed] = useState(false)
  const isUsed = (b: Booking) =>
    (b.ends_at ? startMs({ ...b, starts_at: b.ends_at }) : startMs(b)) < nowMs
  const upcoming = bookings.filter((b) => !isUsed(b))
  const used = bookings.filter(isUsed).sort((a, c) => startMs(a) - startMs(c))
  const groups = BOOKING_KINDS.map((k) => ({
    ...k,
    items: upcoming.filter((b) => b.kind === k.value).sort((a, c) => startMs(a) - startMs(c)),
  })).filter((g) => g.items.length)
  const row = (b: Booking, stamp: boolean) => (
    <li key={b.booking_id} className={stamp ? 'trip-bcard is-used' : 'trip-bcard'}>
      <button type="button" className="trip-bcard-main" onClick={() => onOpen(b.booking_id)}>
        <span className="trip-stub-icon">{KIND_ICON[b.kind]}</span>
        <span className="trip-bcard-text">
          <span className="trip-title">{bookingHeadline(b)}</span>
          <span className="trip-sub">{bookingSub(b)}</span>
        </span>
        {stamp && <span className="trip-used">Used</span>}
      </button>
    </li>
  )
  return (
    <section className="trip-pane-body" aria-label="Bookings">
      {!bookings.length && (
        <p className="trip-empty-text">
          No bookings yet. Add flights, stays and tickets with their confirmation codes.
        </p>
      )}
      {groups.map((g) => (
        <div key={g.value} className="trip-group">
          <h3>{g.label}s</h3>
          <ul className="trip-list">{g.items.map((b) => row(b, false))}</ul>
        </div>
      ))}
      {used.length > 0 && (
        <div className="trip-group">
          <button
            type="button"
            className="completed-toggle trip-donetoggle"
            aria-expanded={showUsed}
            onClick={() => setShowUsed((v) => !v)}
          >
            {showUsed ? <CaretDown aria-hidden /> : <CaretRight aria-hidden />} {used.length} used ·{' '}
            {showUsed ? 'Hide' : 'Show'}
          </button>
          {showUsed && <ul className="trip-list">{used.map((b) => row(b, true))}</ul>}
        </div>
      )}
    </section>
  )
}
