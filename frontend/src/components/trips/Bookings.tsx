import React, { useState } from 'react'
import { Button } from 'antd'
import { Copy } from '@phosphor-icons/react'
import type { Booking, BookingKind, Place } from '@api/tripTypes'
import { zoneLabel } from '@lib/trips/schedule'
import { BOOKING_KINDS, KIND_ICON } from './tripUi'
import { CodeReveal } from './CodeReveal'
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
  defaultDay?: string
  initialTitle?: string
  onSave: (patch: Record<string, unknown>) => void
  onCancel: () => void
  onDelete?: () => void
}

export const BookingEditor: React.FC<EditorProps> = ({
  booking,
  tripTz,
  bias,
  defaultDay,
  initialTitle,
  onSave,
  onCancel,
  onDelete,
}) => {
  const [kind, setKind] = useState<BookingKind>(booking?.kind ?? 'ticket')
  const [title, setTitle] = useState(booking?.title ?? initialTitle ?? '')
  const [code, setCode] = useState(booking?.confirmation_code ?? '')
  const [startsAt, setStartsAt] = useState(
    booking?.starts_at ?? (defaultDay ? `${defaultDay}T09:00` : ''),
  )
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
  // Map number, shown quietly while the map is visible.
  pin?: number
  tonight?: boolean
  selected: boolean
  clash?: boolean
  onOpen: (id: string) => void
}

// In the plan a booking is one quiet line at its time: icon, time, title. The code, both ends
// and the address live in its detail.
export const BookingLine = React.memo<LineProps>(function BookingLine({
  booking: b,
  past,
  pin,
  tonight,
  selected,
  clash,
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
        {pin ? (
          <span className="trip-pinno" aria-hidden>
            {pin}
          </span>
        ) : null}
        <span className="trip-time">
          {tonight ? 'Tonight' : (b.starts_at?.split('T')[1] ?? '')}
        </span>
        <span className="trip-stub-title">{b.title}</span>
        {past && <span className="trip-used">Used</span>}
      </button>
    </li>
  )
})

type PanelProps = {
  bookings: Booking[]
  nowMs: number
  actions: BookingActions
  startMs: (b: Booking) => number
  onOpen: (id: string) => void
  locked: boolean
}

/** Every booking, grouped by kind, codes one tap from copying. */
export const BookingsPanel: React.FC<PanelProps> = ({
  bookings,
  nowMs,
  actions,
  startMs,
  onOpen,
}) => {
  const groups = BOOKING_KINDS.map((k) => ({
    ...k,
    items: bookings.filter((b) => b.kind === k.value).sort((a, c) => startMs(a) - startMs(c)),
  })).filter((g) => g.items.length)
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
          <ul className="trip-list">
            {g.items.map((b) => {
              const end = b.ends_at ? startMs({ ...b, starts_at: b.ends_at }) : startMs(b)
              return (
                <li
                  key={b.booking_id}
                  className={end < nowMs ? 'trip-bcard is-used' : 'trip-bcard'}
                >
                  <button
                    type="button"
                    className="trip-bcard-main"
                    onClick={() => onOpen(b.booking_id)}
                  >
                    <span className="trip-stub-icon">{KIND_ICON[b.kind]}</span>
                    <span className="trip-bcard-text">
                      <span className="trip-title">{b.title}</span>
                      <span className="trip-sub">
                        {[b.starts_at?.split('T')[0], bookingWhen(b)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                  {b.confirmation_code && (
                    <CodeReveal
                      compact
                      code={b.confirmation_code}
                      title={b.title}
                      kind={b.kind}
                      line={[b.starts_at?.split('T')[1], b.place?.name].filter(Boolean).join(' · ')}
                      onCopy={actions.copy}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </section>
  )
}
