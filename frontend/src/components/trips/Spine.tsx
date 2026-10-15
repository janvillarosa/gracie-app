import React, { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { CaretDown, CaretRight, Check } from '@phosphor-icons/react'
import type { Booking, TripTodo } from '@api/tripTypes'
import { shortDay, type DayModel, type Entry } from '@lib/trips/schedule'
import type { ConflictNote } from '@lib/trips/store'
import { memberName, type Member } from '@lib/trips/hooks'
import { BookingLine } from './Bookings'
import type { MoveTarget } from './MoveMenu'
import { TodoRow, type RowActions } from './TodoRow'

const DAY_MS = 86400000

export type Shared = {
  actions: RowActions
  days: MoveTarget[]
  me?: string
  members: Member[]
  notes: Record<string, ConflictNote>
  locked: boolean
  // Map numbers; empty while the map is not on screen (the gutter stays quiet then).
  pins: Map<string, number>
  setDayLabel: (date: string, label: string) => void
}

/** "Added by Mia · Changed by Jan", for the detail. */
export function bylineFor(
  e: Pick<TripTodo | Booking, 'created_by' | 'updated_by'>,
  me: string | undefined,
  members: Member[],
) {
  if (!e.created_by) return ''
  const added = memberName(e.created_by, me, members)
  const changed =
    e.updated_by && e.updated_by !== e.created_by ? memberName(e.updated_by, me, members) : ''
  return `Added by ${added}${changed ? ` · Changed by ${changed}` : ''}`
}

/** A housemate's name when they changed this in the last 24h; otherwise nothing. */
export function recentOther(
  e: Pick<TripTodo | Booking, 'created_by' | 'updated_by' | 'updated_at'>,
  me: string | undefined,
  members: Member[],
  nowMs: number,
) {
  const actor = e.updated_by || e.created_by
  if (!actor || actor === me) return ''
  const at = e.updated_at ? Date.parse(e.updated_at) : Number.NaN
  if (!Number.isFinite(at) || nowMs - at >= DAY_MS) return ''
  const name = memberName(actor, me, members)
  return name === 'a housemate' ? 'A housemate' : name
}

function noteFor(
  todo: TripTodo,
  notes: Record<string, ConflictNote>,
  me: string | undefined,
  members: Member[],
) {
  if (!notes[todo.todo_id]) return undefined
  const who = memberName(todo.updated_by, me, members)
  const name = !who || who === 'you' ? 'Someone' : who === 'a housemate' ? 'A housemate' : who
  return { text: `${name} changed this after your offline edit` }
}

type RowsProps = {
  entries: Entry[]
  shared: Shared
  moveOpenId: string | null
  selectedId: string | null
  enteringId: string | null
  nowMs: number
  today?: string
  showDay?: boolean
  nowIndex?: number
  nowLabel?: string
  stay?: Booking
}

export const EntryRows: React.FC<RowsProps> = ({
  entries,
  shared,
  moveOpenId,
  selectedId,
  enteringId,
  nowMs,
  today,
  showDay,
  nowIndex = -1,
  nowLabel,
  stay,
}) => {
  const out: React.ReactNode[] = []
  const t = Date.now()
  const nowMarker = (
    <li key="now" className="trip-now" aria-label={`Now, ${nowLabel}`}>
      <span>Now · {nowLabel}</span>
    </li>
  )
  entries.forEach((e, i) => {
    if (i === nowIndex) out.push(nowMarker)
    if (e.kind === 'todo') {
      const td = e.todo
      out.push(
        <TodoRow
          key={td.todo_id}
          todo={td}
          pin={shared.pins.get(td.todo_id)}
          changedBy={recentOther(td, shared.me, shared.members, t)}
          note={noteFor(td, shared.notes, shared.me, shared.members)}
          moveOpen={moveOpenId === td.todo_id}
          selected={selectedId === td.todo_id}
          overdue={!!today && e.day === today && !td.done && e.endMs !== null && e.endMs < nowMs}
          locked={shared.locked}
          dayLabel={showDay ? shortDay(e.day) : ''}
          days={shared.days}
          entering={enteringId === td.todo_id}
          actions={shared.actions}
        />,
      )
    } else {
      const b = e.booking
      out.push(
        <BookingLine
          key={b.booking_id}
          booking={b}
          past={(e.endMs ?? e.startMs ?? Number.POSITIVE_INFINITY) < nowMs}
          pin={shared.pins.get(b.booking_id)}
          selected={selectedId === b.booking_id}
          onOpen={shared.actions.open}
        />,
      )
    }
  })
  if (nowIndex >= entries.length) out.push(nowMarker)
  return (
    <ul className="trip-list">
      {stay && (
        <BookingLine
          key={`tonight-${stay.booking_id}`}
          booking={stay}
          past={false}
          selected={false}
          onOpen={shared.actions.open}
          tonight
        />
      )}
      {out}
    </ul>
  )
}

type LabelProps = {
  date: string
  label: string
  suggested: string
  locked: boolean
  onSet: (d: string, l: string) => void
}

// The day's name: yours, or a muted suggestion from where its stops are. Click to accept or edit.
const DayLabel: React.FC<LabelProps> = ({ date, label, suggested, locked, onSet }) => {
  const [editing, setEditing] = useState(false)
  const shown = label || suggested
  if (editing) {
    return (
      <input
        className="trip-daylabel-input"
        aria-label={`Label for ${shortDay(date)}`}
        defaultValue={shown}
        maxLength={40}
        // biome-ignore lint/a11y/noAutofocus: the field opens because the user asked to edit
        autoFocus
        onBlur={(e) => {
          const v = e.target.value.trim()
          if (v !== label) onSet(date, v)
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            e.currentTarget.value = label
            e.currentTarget.blur()
          }
        }}
      />
    )
  }
  if (locked) return shown ? <span className="trip-daylabel">{shown}</span> : null
  return (
    <button
      type="button"
      className={
        label
          ? 'trip-daylabel'
          : suggested
            ? 'trip-daylabel is-suggested'
            : 'trip-daylabel is-empty'
      }
      onClick={() => setEditing(true)}
      aria-label={
        label
          ? `Rename ${shortDay(date)}, now ${label}`
          : suggested
            ? `Label ${shortDay(date)} as ${suggested}, or edit`
            : `Add a label to ${shortDay(date)}`
      }
    >
      {shown || 'Add a label'}
    </button>
  )
}

/** A day is done when it has todos and every one is ticked, whatever its date. */
export const dayDone = (d: DayModel) => {
  const todos = d.entries.filter((e) => e.kind === 'todo')
  return todos.length > 0 && todos.every((e) => e.kind === 'todo' && e.todo.done)
}
const todoCount = (d: DayModel) => d.entries.filter((e) => e.kind === 'todo').length

type DayProps = {
  day: DayModel
  index: number
  shared: Shared
  moveOpenId: string | null
  selectedId: string | null
  enteringId: string | null
  isToday: boolean
  onFold: (date: string) => void
  nowMs: number
  nowIndex: number
  nowLabel: string
  stay?: Booking
  lazy: boolean
  today: string
  // "Day done" shows for a moment after the last item is ticked, then the day folds.
  celebrating: boolean
  // Collapsed to a one-line card (phone: only today and the day you picked are open).
  closed: boolean
}

const dayStyle = (index: number) =>
  ({ '--day-colour': `var(--trip-day-${index % 6})` }) as React.CSSProperties

export const DaySection = React.memo<DayProps>(function DaySection({
  day,
  index,
  shared,
  moveOpenId,
  selectedId,
  enteringId,
  isToday,
  onFold,
  nowMs,
  nowIndex,
  nowLabel,
  stay,
  lazy,
  today,
  celebrating,
  closed,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.date}` })
  const todos = todoCount(day)
  const bookings = day.entries.length - todos
  const doneCount = day.entries.filter((e) => e.kind === 'todo' && e.todo.done).length
  const label = day.label || day.suggested
  const summary = [
    `${todos} ${todos === 1 ? 'stop' : 'stops'}`,
    bookings ? `${bookings} ${bookings === 1 ? 'booking' : 'bookings'}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const cls = [
    'trip-day',
    closed ? 'is-closed' : 'is-open',
    lazy ? 'is-lazy' : '',
    isOver ? 'is-over' : '',
    isToday ? 'is-today' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (closed) {
    return (
      <section
        ref={setNodeRef}
        id={`day-${day.date}`}
        data-day={day.date}
        className={cls}
        style={dayStyle(index)}
        aria-label={shortDay(day.date)}
      >
        <button
          type="button"
          className="trip-day-closed"
          aria-expanded={false}
          aria-label={`Expand ${shortDay(day.date)}`}
          onClick={() => onFold(day.date)}
        >
          <span className="trip-day-dot" aria-hidden />
          <span className="trip-day-closed-text">
            <strong>{shortDay(day.date)}</strong>
            {label ? ` · ${label}` : ''}
            <span className="trip-day-sum">
              {' · '}
              {todos === 0 ? 'Nothing planned' : `${doneCount} of ${todos} done`}
            </span>
          </span>
          <CaretRight aria-hidden />
        </button>
      </section>
    )
  }

  return (
    <section
      ref={setNodeRef}
      id={`day-${day.date}`}
      data-day={day.date}
      className={cls}
      style={dayStyle(index)}
      aria-label={shortDay(day.date)}
    >
      <header className="trip-day-head">
        <div className="trip-day-title">
          <span className="trip-day-dot" aria-hidden />
          <h2 tabIndex={-1} id={`day-${day.date}-title`}>
            {shortDay(day.date)}
          </h2>
          <DayLabel
            date={day.date}
            label={day.label}
            suggested={day.suggested}
            locked={shared.locked}
            onSet={shared.setDayLabel}
          />
          {isToday && <span className="trip-today">Today</span>}
          <button
            type="button"
            className="trip-day-fold"
            aria-expanded
            aria-label={`Collapse ${shortDay(day.date)}`}
            onClick={() => onFold(day.date)}
          >
            <CaretDown aria-hidden />
          </button>
        </div>
        <p className="trip-day-sum">{summary}</p>
        {celebrating && <span className="trip-stamp">Day done</span>}
      </header>
      <div className="trip-day-body">
        {day.entries.length === 0 && !stay ? (
          <p className="trip-empty-row">Nothing planned yet</p>
        ) : (
          <EntryRows
            entries={day.entries}
            shared={shared}
            moveOpenId={moveOpenId}
            selectedId={selectedId}
            enteringId={enteringId}
            nowMs={nowMs}
            today={today}
            nowIndex={isToday ? nowIndex : -1}
            nowLabel={nowLabel}
            stay={isToday ? stay : undefined}
          />
        )}
      </div>
    </section>
  )
})

/** A finished day as a slim muted line, not a card. */
export const DoneLine: React.FC<{
  day: DayModel
  onOpen: (date: string) => void
}> = ({ day, onOpen }) => {
  const n = todoCount(day)
  const label = day.label || day.suggested
  return (
    <section
      id={`day-${day.date}`}
      data-day={day.date}
      className="trip-done"
      aria-label={shortDay(day.date)}
    >
      <button
        type="button"
        className="trip-doneline"
        aria-expanded={false}
        onClick={() => onOpen(day.date)}
      >
        <Check aria-hidden />
        <span>
          {shortDay(day.date)}
          {label ? ` · ${label}` : ''} · {n} done
        </span>
      </button>
    </section>
  )
}

/** Consecutive finished days share one line; opening it lists each day's slim line. */
export const DoneRun: React.FC<{
  days: DayModel[]
  open: boolean
  onToggle: () => void
  onOpenDay: (date: string) => void
}> = ({ days, open, onToggle, onOpenDay }) => {
  const first = days[0]
  const last = days[days.length - 1]
  const items = days.reduce((n, d) => n + todoCount(d), 0)
  if (open)
    return (
      <div className="trip-donerun is-open">
        <button type="button" className="trip-doneline" aria-expanded onClick={onToggle}>
          <Check aria-hidden />
          <span>Fold {days.length} done days</span>
        </button>
        {days.map((d) => (
          <DoneLine key={d.date} day={d} onOpen={onOpenDay} />
        ))}
      </div>
    )
  return (
    <section
      id={`day-${first.date}`}
      data-day={first.date}
      className="trip-done"
      aria-label={`${shortDay(first.date)} to ${shortDay(last.date)}`}
    >
      <button type="button" className="trip-doneline" aria-expanded={false} onClick={onToggle}>
        <Check aria-hidden />
        <span>
          {shortDay(first.date)} – {shortDay(last.date)} · {days.length} days done · {items} items
        </span>
      </button>
    </section>
  )
}
