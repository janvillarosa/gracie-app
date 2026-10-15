import React, { useState } from 'react'
import { Button, Checkbox } from 'antd'
import { CaretLeft, CaretRight, MapPin, Ticket } from '@phosphor-icons/react'
import type { Booking, BookingKind, TripCategory, TripTodo } from '@api/tripTypes'
import { mapsUrl } from '@lib/trips/schedule'
import { type BookingActions } from './Bookings'
import { CodeReveal } from './CodeReveal'
import type { MoveTarget } from './MoveMenu'
import { PlacePicker } from './PlacePicker'
import { BOOKING_KINDS, CATEGORIES, KIND_ICON, categoryLabel } from './tripUi'

type Bias = { lat: number; lng: number } | null

/** The title as a large borderless heading you can type into; saves on blur or Enter. */
const SheetTitle: React.FC<{
  value: string
  onCommit: (v: string) => void
  autoFocus?: boolean
  disabled?: boolean
}> = ({ value, onCommit, autoFocus, disabled }) => (
  <input
    key={value}
    className="trip-sheet-title"
    aria-label="Title"
    defaultValue={value}
    maxLength={200}
    disabled={disabled}
    // biome-ignore lint/a11y/noAutofocus: a new item opens with its title ready to type
    autoFocus={autoFocus}
    onFocus={(e) => autoFocus && e.target.select()}
    onKeyDown={(e) => {
      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
    }}
    onBlur={(e) => {
      const v = e.target.value.trim()
      if (!v) e.target.value = value
      else if (v !== value) onCommit(v)
    }}
  />
)

const Row: React.FC<{
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  label?: string
}> = ({ icon, children, onClick, disabled, label }) => (
  <button
    type="button"
    className="trip-sheet-row"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
  >
    <span className="trip-sheet-row-icon">{icon}</span>
    <span className="trip-sheet-row-text">{children}</span>
    <CaretRight aria-hidden />
  </button>
)

const BackBar: React.FC<{ onBack: () => void; title: string }> = ({ onBack, title }) => (
  <div className="trip-sheet-back">
    <Button type="text" icon={<CaretLeft />} onClick={onBack} aria-label={`Back from ${title}`}>
      Back
    </Button>
    <span>{title}</span>
  </div>
)

const DURATIONS: Array<{ value: number; label: string }> = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 h' },
  { value: 120, label: '2 h' },
  { value: 240, label: 'Half day' },
]

type TodoDetailProps = {
  todo: TripTodo
  bookings: Booking[]
  days: MoveTarget[]
  tripTz?: string
  bias: Bias
  byline: string
  locked: boolean
  fresh?: boolean
  onPatch: (patch: Record<string, unknown>) => void
  onMove: (day: string | null) => void
  onDelete: () => void
  onCopy: (code: string) => void
}

// One editor for add and edit. Everything saves as it changes; there is no Save button.
export const TodoDetail: React.FC<TodoDetailProps> = ({
  todo,
  bookings,
  days,
  tripTz,
  bias,
  byline,
  locked,
  fresh,
  onPatch,
  onMove,
  onDelete,
  onCopy,
}) => {
  const [view, setView] = useState<'main' | 'place' | 'booking'>('main')
  const [timing, setTiming] = useState(false)
  const [custom, setCustom] = useState(false)
  const pin = todo.place && todo.place.source !== 'manual' ? todo.place : null
  const linked = bookings.find((b) => b.booking_id === todo.booking_id)
  const preset = DURATIONS.some((d) => d.value === todo.duration_min)
  const placeText = todo.place
    ? [todo.place.name, todo.place.locality]
        .filter((x, i, a) => x && a.indexOf(x) === i)
        .join(' · ')
    : ''

  if (view === 'place') {
    return (
      <div className="trip-sheet">
        <BackBar onBack={() => setView('main')} title="Place" />
        <PlacePicker
          label="Place"
          value={todo.place}
          bias={bias}
          tz={tripTz}
          onChange={(p) => {
            onPatch({ place: p })
            if (p) setView('main')
          }}
        />
      </div>
    )
  }
  if (view === 'booking') {
    return (
      <div className="trip-sheet">
        <BackBar onBack={() => setView('main')} title="Linked booking" />
        <ul className="trip-pick">
          <li>
            <button
              type="button"
              className="trip-pick-row"
              aria-pressed={!todo.booking_id}
              onClick={() => {
                onPatch({ booking_id: null })
                setView('main')
              }}
            >
              None
            </button>
          </li>
          {bookings.map((b) => (
            <li key={b.booking_id}>
              <button
                type="button"
                className="trip-pick-row"
                aria-pressed={b.booking_id === todo.booking_id}
                onClick={() => {
                  onPatch({ booking_id: b.booking_id })
                  setView('main')
                }}
              >
                <span className="trip-stub-icon">{KIND_ICON[b.kind]}</span>
                {b.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="trip-sheet">
      <div className="trip-sheet-headline">
        <span className="trip-check">
          <Checkbox
            checked={todo.done}
            disabled={locked}
            onChange={(e) => onPatch({ done: e.target.checked })}
            aria-label={`${todo.title}, done`}
          />
        </span>
        <SheetTitle
          value={todo.title}
          onCommit={(v) => onPatch({ title: v })}
          autoFocus={fresh}
          disabled={locked}
        />
      </div>

      <Row icon={<MapPin aria-hidden />} onClick={() => setView('place')} disabled={locked}>
        {placeText || <span className="trip-muted">Add a place</span>}
      </Row>

      <div className="trip-sheet-chips">
        <select
          className="trip-chip"
          aria-label="Day"
          value={todo.day ?? ''}
          disabled={locked}
          onChange={(e) => onMove(e.target.value || null)}
        >
          <option value="">Ideas (no day)</option>
          {days
            .filter((d) => d.value !== null)
            .map((d) => (
              <option key={d.value} value={d.value as string}>
                {d.label}
              </option>
            ))}
          {todo.day && !days.some((d) => d.value === todo.day) && (
            <option value={todo.day}>{todo.day}</option>
          )}
        </select>
        {todo.start_time || timing ? (
          <input
            key={todo.start_time ?? 'new'}
            className="trip-chip"
            type="time"
            aria-label="Time"
            defaultValue={todo.start_time ?? ''}
            disabled={locked}
            // biome-ignore lint/a11y/noAutofocus: the time field opens because "+ Time" was pressed
            autoFocus={timing && !todo.start_time}
            onBlur={(e) => {
              const v = e.target.value || null
              setTiming(false)
              if (v !== (todo.start_time ?? null)) onPatch({ start_time: v })
            }}
          />
        ) : (
          <button
            type="button"
            className="trip-chip is-add"
            disabled={locked}
            onClick={() => setTiming(true)}
          >
            + Time
          </button>
        )}
        {todo.start_time &&
          (custom || (todo.duration_min && !preset) ? (
            <input
              className="trip-chip"
              type="number"
              min={1}
              max={1440}
              inputMode="numeric"
              aria-label="Duration in minutes"
              key={String(todo.duration_min ?? '')}
              defaultValue={todo.duration_min ?? ''}
              disabled={locked}
              onBlur={(e) => {
                const n = e.target.value ? Number(e.target.value) : null
                if ((n === null || (n >= 1 && n <= 1440)) && n !== (todo.duration_min ?? null))
                  onPatch({ duration_min: n })
              }}
            />
          ) : (
            <select
              className="trip-chip"
              aria-label="Duration"
              value={todo.duration_min ?? ''}
              disabled={locked}
              onChange={(e) => {
                if (e.target.value === 'custom') return setCustom(true)
                onPatch({ duration_min: e.target.value ? Number(e.target.value) : null })
              }}
            >
              <option value="">+ Length</option>
              {DURATIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          ))}
      </div>

      <div className="trip-sheet-stamps" role="group" aria-label="Category">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            disabled={locked}
            aria-pressed={todo.category === c.value}
            aria-label={`Category: ${categoryLabel(c.value)}`}
            className={`category-tag trip-cat trip-cat-${c.value} trip-stamp-btn${todo.category === c.value ? ' is-on' : ''}`}
            onClick={() => onPatch({ category: c.value as TripCategory })}
          >
            {c.label}
          </button>
        ))}
      </div>

      {(bookings.length > 0 || linked) && (
        <>
          <Row icon={<Ticket aria-hidden />} onClick={() => setView('booking')} disabled={locked}>
            {linked ? linked.title : <span className="trip-muted">Link a booking</span>}
          </Row>
          {linked?.confirmation_code && (
            <div className="trip-sheet-sub">
              <CodeReveal
                compact
                code={linked.confirmation_code}
                title={linked.title}
                kind={linked.kind}
                line={[linked.starts_at?.split('T')[1], linked.place?.name]
                  .filter(Boolean)
                  .join(' · ')}
                onCopy={onCopy}
              />
            </div>
          )}
        </>
      )}

      <textarea
        key={String(todo.notes ?? '')}
        className="trip-sheet-notes"
        aria-label="Notes"
        placeholder="Add a note"
        rows={2}
        maxLength={2000}
        defaultValue={todo.notes ?? ''}
        disabled={locked}
        onBlur={(e) => {
          if (e.target.value !== (todo.notes ?? '')) onPatch({ notes: e.target.value })
        }}
      />

      <div className="trip-sheet-foot">
        {pin && (
          <a
            className="ant-btn ant-btn-primary ant-btn-round ant-btn-lg trip-go"
            href={mapsUrl(pin.lat, pin.lng)}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open in Maps
          </a>
        )}
        {byline && <p className="trip-byline">{byline}</p>}
        {!locked && (
          <button type="button" className="trip-delete" onClick={onDelete}>
            Delete
          </button>
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

// The same anatomy as a todo: a heading, a from → to block, the code behind a button.
export const BookingDetail: React.FC<BookingDetailProps> = ({
  booking: b,
  tripTz,
  bias,
  byline,
  locked,
  actions,
}) => {
  const [view, setView] = useState<'main' | 'place'>('main')
  const [zoneError, setZoneError] = useState('')
  const pin = b.place && b.place.source !== 'manual' ? b.place : null
  const save = (patch: Record<string, unknown>) => actions.save(b.booking_id, patch)
  const commitZone = (field: 'start_tz' | 'end_tz', v: string, cur?: string | null) => {
    if (v && !validZone(v)) return setZoneError('Time zones look like Europe/Lisbon.')
    setZoneError('')
    if ((v || null) !== (cur ?? null)) save({ [field]: v || null })
  }

  if (view === 'place') {
    return (
      <div className="trip-sheet">
        <BackBar onBack={() => setView('main')} title="Place" />
        <PlacePicker
          label="Booking place"
          value={b.place}
          bias={bias}
          tz={tripTz}
          onChange={(p) => {
            save({ place: p })
            if (p) setView('main')
          }}
        />
      </div>
    )
  }

  return (
    <div className="trip-sheet">
      <div className="trip-sheet-headline">
        <span className="trip-stub-icon is-big">{KIND_ICON[b.kind]}</span>
        <SheetTitle value={b.title} onCommit={(v) => save({ title: v })} disabled={locked} />
      </div>
      <div className="trip-sheet-chips">
        <select
          className="trip-chip"
          aria-label="Kind"
          value={b.kind}
          disabled={locked}
          onChange={(e) => save({ kind: e.target.value as BookingKind })}
        >
          {BOOKING_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        {b.confirmation_code ? (
          <CodeReveal
            code={b.confirmation_code}
            title={b.title}
            kind={b.kind}
            line={[b.starts_at?.split('T')[1], b.place?.name].filter(Boolean).join(' · ')}
            onCopy={actions.copy}
          />
        ) : null}
      </div>

      <div className="trip-fromto">
        <div className="trip-fromto-row">
          <span className="trip-fromto-label">From</span>
          <input
            className="trip-chip"
            type="datetime-local"
            aria-label="Starts"
            key={b.starts_at ?? 's'}
            defaultValue={b.starts_at ?? ''}
            disabled={locked}
            onBlur={(e) => {
              if ((e.target.value || null) !== (b.starts_at ?? null))
                save({ starts_at: e.target.value || null })
            }}
          />
          <input
            className="trip-chip"
            list="trip-zones"
            aria-label="Start time zone"
            key={b.start_tz ?? 'stz'}
            defaultValue={b.start_tz ?? tripTz ?? ''}
            disabled={locked}
            onBlur={(e) => commitZone('start_tz', e.target.value.trim(), b.start_tz)}
          />
        </div>
        <div className="trip-fromto-row">
          <span className="trip-fromto-label">To</span>
          <input
            className="trip-chip"
            type="datetime-local"
            aria-label="Ends"
            key={b.ends_at ?? 'e'}
            defaultValue={b.ends_at ?? ''}
            disabled={locked}
            onBlur={(e) => {
              if ((e.target.value || null) !== (b.ends_at ?? null))
                save({ ends_at: e.target.value || null })
            }}
          />
          <input
            className="trip-chip"
            list="trip-zones"
            aria-label="End time zone"
            placeholder="Same as start"
            key={b.end_tz ?? 'etz'}
            defaultValue={b.end_tz ?? ''}
            disabled={locked}
            onBlur={(e) => commitZone('end_tz', e.target.value.trim(), b.end_tz)}
          />
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
      </div>

      <Row icon={<MapPin aria-hidden />} onClick={() => setView('place')} disabled={locked}>
        {b.place ? b.place.name : <span className="trip-muted">Add a place</span>}
      </Row>

      <label className="trip-sheet-codefield">
        <span className="sr-only">Confirmation code</span>
        <input
          className="trip-sheet-line"
          aria-label="Confirmation code"
          placeholder={b.confirmation_code ? 'Change the code' : 'Add a confirmation code'}
          key={b.confirmation_code ?? 'c'}
          defaultValue=""
          maxLength={64}
          disabled={locked}
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v && v !== (b.confirmation_code ?? '')) save({ confirmation_code: v })
          }}
        />
      </label>

      <textarea
        key={String(b.notes ?? '')}
        className="trip-sheet-notes"
        aria-label="Notes"
        placeholder="Add a note"
        rows={2}
        maxLength={2000}
        defaultValue={b.notes ?? ''}
        disabled={locked}
        onBlur={(e) => {
          if (e.target.value !== (b.notes ?? '')) save({ notes: e.target.value })
        }}
      />

      <div className="trip-sheet-foot">
        {pin && (
          <a
            className="ant-btn ant-btn-primary ant-btn-round ant-btn-lg trip-go"
            href={mapsUrl(pin.lat, pin.lng)}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open in Maps
          </a>
        )}
        {byline && <p className="trip-byline">{byline}</p>}
        {!locked && (
          <button
            type="button"
            className="trip-delete"
            onClick={() => actions.remove(b.booking_id)}
          >
            Delete booking
          </button>
        )}
      </div>
    </div>
  )
}
