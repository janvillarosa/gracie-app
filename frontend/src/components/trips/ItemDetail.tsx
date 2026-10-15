import React, { useState } from 'react'
import { Button, Checkbox } from 'antd'
import { CaretLeft, CaretRight, MapPin, Ticket } from '@phosphor-icons/react'
import type { Booking, TripCategory, TripTodo } from '@api/tripTypes'
import { mapsUrl } from '@lib/trips/schedule'
import { LIMITS, notesProblem, titleProblem } from '@lib/trips/limits'
import { CodeReveal } from './CodeReveal'
import type { MoveTarget } from './MoveMenu'
import { PlacePicker } from './PlacePicker'
import { DayChip, LengthChip, StampChip, TimeChip } from './Chips'
import { KIND_ICON } from './tripUi'

type Bias = { lat: number; lng: number } | null

/** The title as a large borderless heading you can type into; saves on blur or Enter. */
export const SheetTitle: React.FC<{
  value: string
  onCommit: (v: string) => void
  autoFocus?: boolean
  disabled?: boolean
  // Something small before the title (a booking's kind icon).
  leading?: React.ReactNode
  placeholder?: string
}> = ({ value, onCommit, autoFocus, disabled, leading, placeholder }) => {
  const [problem, setProblem] = useState('')
  return (
    <div className="trip-sheet-titlewrap">
      {leading}
      <input
        key={value}
        className="trip-sheet-title"
        aria-label="Title"
        defaultValue={value}
        placeholder={placeholder}
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

export const Row: React.FC<{
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

export const BackBar: React.FC<{ onBack: () => void; title: string }> = ({ onBack, title }) => (
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
