import React, { useState } from 'react'
import { Button } from 'antd'
import { Copy, Trash } from '@phosphor-icons/react'
import type { Booking, BookingKind, Place, TripCategory, TripTodo } from '@api/tripTypes'
import { mapsUrl } from '@lib/trips/schedule'
import { bookingWhen, type BookingActions } from './Bookings'
import { MoveMenu, type MoveTarget } from './MoveMenu'
import { PlacePicker } from './PlacePicker'
import { BOOKING_KINDS, CATEGORIES } from './tripUi'

type Bias = { lat: number; lng: number } | null

type TodoDetailProps = {
  todo: TripTodo
  days: MoveTarget[]
  tripTz?: string
  bias: Bias
  byline: string
  locked: boolean
  onPatch: (patch: Record<string, unknown>) => void
  onMove: (day: string | null) => void
  onDelete: () => void
}

// Every field commits on blur or change as one small op: there is no Save button.
export const TodoDetail: React.FC<TodoDetailProps> = ({
  todo,
  days,
  tripTz,
  bias,
  byline,
  locked,
  onPatch,
  onMove,
  onDelete,
}) => {
  const [moving, setMoving] = useState(false)
  const pin = todo.place && todo.place.source !== 'manual' ? todo.place : null
  const dayOptions = days.filter((d) => d.value !== null)
  return (
    <div className="trip-detail">
      <fieldset className="trip-fieldset" disabled={locked}>
        <label className="trip-label">
          Title
          <input
            className="trip-field"
            key={String(todo.title)}
            defaultValue={todo.title}
            maxLength={200}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (!v) e.target.value = todo.title
              else if (v !== todo.title) onPatch({ title: v })
            }}
          />
        </label>
        <div className="trip-editor-pair">
          <label className="trip-label">
            Day
            <select
              className="trip-field"
              value={todo.day ?? ''}
              onChange={(e) => onMove(e.target.value || null)}
            >
              <option value="">Ideas (no day)</option>
              {dayOptions.map((d) => (
                <option key={d.value} value={d.value as string}>
                  {d.label}
                </option>
              ))}
              {todo.day && !dayOptions.some((d) => d.value === todo.day) && (
                <option value={todo.day}>{todo.day}</option>
              )}
            </select>
          </label>
          <label className="trip-label">
            Time
            <input
              className="trip-field"
              type="time"
              key={String(todo.start_time ?? '')}
              defaultValue={todo.start_time ?? ''}
              onBlur={(e) => {
                const v = e.target.value || null
                if (v !== (todo.start_time ?? null)) onPatch({ start_time: v })
              }}
            />
          </label>
        </div>
        <div className="trip-editor-pair">
          <label className="trip-label">
            Minutes
            <input
              className="trip-field"
              type="number"
              min={1}
              max={1440}
              inputMode="numeric"
              key={String(todo.duration_min ?? '')}
              defaultValue={todo.duration_min ?? ''}
              onBlur={(e) => {
                const n = e.target.value ? Number(e.target.value) : null
                const ok = n === null || (n >= 1 && n <= 1440)
                if (ok && n !== (todo.duration_min ?? null)) onPatch({ duration_min: n })
              }}
            />
          </label>
          <label className="trip-label">
            Category
            <select
              className="trip-field"
              value={todo.category}
              onChange={(e) => onPatch({ category: e.target.value as TripCategory })}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="trip-label">
          Place
          <PlacePicker
            label="Place"
            value={todo.place}
            bias={bias}
            tz={tripTz}
            onChange={(p: Place | null) => onPatch({ place: p })}
          />
        </div>
        <label className="trip-label">
          Notes
          <textarea
            className="trip-field"
            rows={3}
            maxLength={2000}
            key={String(todo.notes ?? '')}
            defaultValue={todo.notes ?? ''}
            onBlur={(e) => {
              if (e.target.value !== (todo.notes ?? '')) onPatch({ notes: e.target.value })
            }}
          />
        </label>
      </fieldset>
      {byline && <p className="trip-byline">{byline}</p>}
      <div className="trip-detail-actions">
        {pin ? (
          <a
            className="trip-link"
            href={mapsUrl(pin.lat, pin.lng)}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open in Maps
          </a>
        ) : (
          <span />
        )}
        {!locked && (
          <span className="trip-editor-btns">
            <span className="trip-move-anchor">
              <Button
                size="small"
                aria-haspopup="menu"
                aria-expanded={moving}
                onClick={() => setMoving((m) => !m)}
              >
                Move to…
              </Button>
              {moving && (
                <MoveMenu
                  title={todo.title}
                  targets={days}
                  current={todo.day ?? null}
                  onPick={(d) => {
                    setMoving(false)
                    onMove(d)
                  }}
                  onClose={() => setMoving(false)}
                />
              )}
            </span>
            <Button size="small" danger icon={<Trash />} onClick={onDelete}>
              Delete
            </Button>
          </span>
        )}
      </div>
    </div>
  )
}

type BookingDetailProps = {
  booking: Booking
  tripTz?: string
  bias: Bias
  byline: string
  locked: boolean
  actions: BookingActions
}

const validZone = (z: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: z })
    return true
  } catch {
    return false
  }
}

const dateOnly = (dt?: string | null) => (dt ? dt.split('T')[0] : '')

// The counter-friendly view: the code first and large, then both ends with their zones.
export const BookingDetail: React.FC<BookingDetailProps> = ({
  booking: b,
  tripTz,
  bias,
  byline,
  locked,
  actions,
}) => {
  const pin = b.place && b.place.source !== 'manual' ? b.place : null
  const save = (patch: Record<string, unknown>) => actions.save(b.booking_id, patch)
  const [zoneError, setZoneError] = useState('')
  const commitZone = (field: 'start_tz' | 'end_tz', v: string, cur?: string | null) => {
    if (v && !validZone(v)) return setZoneError('Time zones look like Europe/Lisbon.')
    setZoneError('')
    if ((v || null) !== (cur ?? null)) save({ [field]: v || null })
  }
  return (
    <div className="trip-detail">
      {b.confirmation_code ? (
        <div className="trip-bigcode">
          <span className="trip-bigcode-label">Confirmation code</span>
          <span className="trip-bigcode-value">{b.confirmation_code}</span>
          <Button
            icon={<Copy />}
            onClick={() => actions.copy(b.confirmation_code as string)}
            aria-label={`Copy code for ${b.title}`}
          >
            Copy code
          </Button>
        </div>
      ) : null}
      <dl className="trip-facts">
        {b.starts_at && (
          <>
            <dt>When</dt>
            <dd>
              {dateOnly(b.starts_at)} · {bookingWhen(b)}
              {b.ends_at && b.kind !== 'flight'
                ? ` to ${dateOnly(b.ends_at)} ${b.ends_at.split('T')[1] ?? ''}`
                : ''}
            </dd>
          </>
        )}
        {b.place && (
          <>
            <dt>Where</dt>
            <dd>
              {b.place.name}
              {b.place.address && b.place.address !== b.place.name ? `, ${b.place.address}` : ''}
            </dd>
          </>
        )}
      </dl>
      <fieldset className="trip-fieldset" disabled={locked}>
        <label className="trip-label">
          Title
          <input
            className="trip-field"
            key={String(b.title)}
            defaultValue={b.title}
            maxLength={200}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (!v) e.target.value = b.title
              else if (v !== b.title) save({ title: v })
            }}
          />
        </label>
        <div className="trip-editor-pair">
          <label className="trip-label">
            Kind
            <select
              className="trip-field"
              value={b.kind}
              onChange={(e) => save({ kind: e.target.value as BookingKind })}
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
              key={String(b.confirmation_code ?? '')}
              defaultValue={b.confirmation_code ?? ''}
              maxLength={64}
              onBlur={(e) => {
                if (e.target.value.trim() !== (b.confirmation_code ?? ''))
                  save({ confirmation_code: e.target.value.trim() })
              }}
            />
          </label>
        </div>
        <div className="trip-editor-pair">
          <label className="trip-label">
            Starts
            <input
              className="trip-field"
              type="datetime-local"
              key={String(b.starts_at ?? '')}
              defaultValue={b.starts_at ?? ''}
              onBlur={(e) => {
                if ((e.target.value || null) !== (b.starts_at ?? null))
                  save({ starts_at: e.target.value || null })
              }}
            />
          </label>
          <label className="trip-label">
            Start time zone
            <input
              className="trip-field"
              list="trip-zones"
              key={String(b.start_tz ?? tripTz ?? '')}
              defaultValue={b.start_tz ?? tripTz ?? ''}
              onBlur={(e) => commitZone('start_tz', e.target.value.trim(), b.start_tz)}
            />
          </label>
        </div>
        <div className="trip-editor-pair">
          <label className="trip-label">
            Ends
            <input
              className="trip-field"
              type="datetime-local"
              key={String(b.ends_at ?? '')}
              defaultValue={b.ends_at ?? ''}
              onBlur={(e) => {
                if ((e.target.value || null) !== (b.ends_at ?? null))
                  save({ ends_at: e.target.value || null })
              }}
            />
          </label>
          <label className="trip-label">
            End time zone
            <input
              className="trip-field"
              list="trip-zones"
              key={String(b.end_tz ?? '')}
              defaultValue={b.end_tz ?? ''}
              placeholder="Same as start"
              onBlur={(e) => commitZone('end_tz', e.target.value.trim(), b.end_tz)}
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
        {zoneError && (
          <div role="alert" className="trip-error">
            {zoneError}
          </div>
        )}
        <div className="trip-label">
          Place
          <PlacePicker
            label="Booking place"
            value={b.place}
            bias={bias}
            tz={tripTz}
            onChange={(p) => save({ place: p })}
          />
        </div>
        <label className="trip-label">
          Notes
          <textarea
            className="trip-field"
            rows={3}
            maxLength={2000}
            key={String(b.notes ?? '')}
            defaultValue={b.notes ?? ''}
            onBlur={(e) => {
              if (e.target.value !== (b.notes ?? '')) save({ notes: e.target.value })
            }}
          />
        </label>
      </fieldset>
      {byline && <p className="trip-byline">{byline}</p>}
      <div className="trip-detail-actions">
        {pin ? (
          <a
            className="trip-link"
            href={mapsUrl(pin.lat, pin.lng)}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open in Maps
          </a>
        ) : (
          <span />
        )}
        {!locked && (
          <Button size="small" danger icon={<Trash />} onClick={() => actions.remove(b.booking_id)}>
            Delete booking
          </Button>
        )}
      </div>
    </div>
  )
}
