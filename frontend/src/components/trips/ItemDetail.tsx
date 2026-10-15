import React, { useState } from 'react'
import { Button, Checkbox } from 'antd'
import { CaretLeft, CaretRight, MapPin, Ticket } from '@phosphor-icons/react'
import type { Booking, BookingKind, TripCategory, TripTodo } from '@api/tripTypes'
import { mapsUrl } from '@lib/trips/schedule'
import { LIMITS, notesProblem, titleProblem } from '@lib/trips/limits'
import { type BookingActions } from './Bookings'
import { CodeReveal } from './CodeReveal'
import type { MoveTarget } from './MoveMenu'
import { PlacePicker } from './PlacePicker'
import { DayChip, LengthChip, StampChip, TimeChip } from './Chips'
import { BOOKING_KINDS, KIND_ICON } from './tripUi'

type Bias = { lat: number; lng: number } | null

/** The title as a large borderless heading you can type into; saves on blur or Enter. */
const SheetTitle: React.FC<{
  value: string
  onCommit: (v: string) => void
  autoFocus?: boolean
  disabled?: boolean
}> = ({ value, onCommit, autoFocus, disabled }) => {
  const [problem, setProblem] = useState('')
  return (
    <div className="trip-sheet-titlewrap">
      <input
        key={value}
        className="trip-sheet-title"
        aria-label="Title"
        defaultValue={value}
        disabled={disabled}
        aria-invalid={!!problem}
        // biome-ignore lint/a11y/noAutofocus: a new item opens with its title ready to type
        autoFocus={autoFocus}
        onFocus={(e) => autoFocus && e.target.select()}
        onChange={(e) => setProblem(titleProblem(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        onBlur={(e) => {
          const v = e.target.value.trim()
          if (!v) {
            e.target.value = value
            setProblem('')
          } else if (titleProblem(v)) setProblem(titleProblem(v))
          else if (v !== value) onCommit(v)
        }}
      />
      {problem && (
        <p role="alert" className="trip-error">
          {problem}
        </p>
      )}
    </div>
  )
}

/** Notes: saved on blur unless they are over the server's byte limit, which is said inline. */
export const NotesField: React.FC<{
  value: string
  max: number
  disabled?: boolean
  onCommit: (v: string) => void
}> = ({ value, max, disabled, onCommit }) => {
  const [problem, setProblem] = useState('')
  return (
    <>
      <textarea
        key={value}
        className="trip-sheet-notes"
        aria-label="Notes"
        placeholder="Add a note"
        rows={2}
        defaultValue={value}
        disabled={disabled}
        aria-invalid={!!problem}
        onChange={(e) => setProblem(notesProblem(e.target.value, max))}
        onBlur={(e) => {
          const p = notesProblem(e.target.value, max)
          setProblem(p)
          if (!p && e.target.value !== value) onCommit(e.target.value)
        }}
      />
      {problem && (
        <p role="alert" className="trip-error">
          {problem}
        </p>
      )}
    </>
  )
}

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

type TodoDetailProps = {
  todo: TripTodo
  bookings: Booking[]
  days: MoveTarget[]
  tripTz?: string
  bias: Bias
  byline: string
  locked: boolean
  fresh?: boolean
  // Open with the time field ready (from an overlap line).
  focusTime?: boolean
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
  focusTime,
  onPatch,
  onMove,
  onDelete,
  onCopy,
}) => {
  const [view, setView] = useState<'main' | 'place' | 'booking'>('main')
  const pin = todo.place && todo.place.source !== 'manual' ? todo.place : null
  const linked = bookings.find((b) => b.booking_id === todo.booking_id)
  // A place named like the item says only where it is: "Sintra", not the name twice.
  const sameName =
    !!todo.place && todo.place.name.trim().toLowerCase() === todo.title.trim().toLowerCase()
  const placeText = todo.place
    ? sameName
      ? (todo.place.locality ?? todo.place.name)
      : [todo.place.name, todo.place.locality]
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
        <DayChip
          value={todo.day ?? null}
          days={days}
          allowIdeas
          disabled={locked}
          onPick={onMove}
        />
        <TimeChip
          value={todo.start_time ?? null}
          clearable
          disabled={locked}
          autoFocus={focusTime}
          onPick={(t) => onPatch({ start_time: t })}
        />
        {todo.start_time && (
          <LengthChip
            value={todo.duration_min}
            disabled={locked}
            onPick={(n) => onPatch({ duration_min: n })}
          />
        )}
        <StampChip
          value={todo.category}
          disabled={locked}
          onPick={(c: TripCategory) => onPatch({ category: c })}
        />
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

      <NotesField
        value={todo.notes ?? ''}
        max={LIMITS.itemNotesBytes}
        disabled={locked}
        onCommit={(v) => onPatch({ notes: v })}
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
  focusTime?: boolean
  days: MoveTarget[]
  // Set when someone changed this after our offline edit.
  note?: string
  onDismissNote?: () => void
  actions: BookingActions
}

const split = (dt?: string | null) => {
  const [d = '', t = ''] = (dt ?? '').split('T')
  return { d, t }
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
  focusTime,
  days,
  note,
  onDismissNote,
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
      {note && (
        <div className="trip-note trip-note-sheet" role="status">
          <span>{note}</span>
          <Button size="small" type="link" onClick={onDismissNote}>
            Got it
          </Button>
        </div>
      )}
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
          <DayChip
            value={split(b.starts_at).d || null}
            days={days}
            placeholder="Add a day"
            disabled={locked}
            onPick={(d) => d && save({ starts_at: `${d}T${split(b.starts_at).t || '09:00'}` })}
          />
          <TimeChip
            label="Starts"
            value={split(b.starts_at).t || null}
            disabled={locked}
            autoFocus={focusTime}
            onPick={(t) => {
              const d = split(b.starts_at).d || (days.find((x) => x.value)?.value as string)
              if (t && d) save({ starts_at: `${d}T${t}` })
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
          <DayChip
            value={split(b.ends_at).d || null}
            days={days}
            placeholder="Add a day"
            disabled={locked}
            onPick={(d) => d && save({ ends_at: `${d}T${split(b.ends_at).t || '12:00'}` })}
          />
          <TimeChip
            label="Ends"
            value={split(b.ends_at).t || null}
            clearable
            disabled={locked}
            onPick={(t) => {
              const d = split(b.ends_at).d || split(b.starts_at).d
              if (!t) save({ ends_at: null })
              else if (d) save({ ends_at: `${d}T${t}` })
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

      <NotesField
        value={b.notes ?? ''}
        max={LIMITS.itemNotesBytes}
        disabled={locked}
        onCommit={(v) => save({ notes: v })}
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
