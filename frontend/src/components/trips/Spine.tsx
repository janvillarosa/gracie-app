import React, { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { CaretDown, CaretRight } from '@phosphor-icons/react'
import type { Booking, TripTodo } from '@api/tripTypes'
import { shortDay, type Clash, type DayModel, type Entry } from '@lib/trips/schedule'
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
  setDayLabel: (date: string, label: string) => void
  // Opens an item's sheet with its time ready to change (from the overlap line).
  onClash: (id: string) => void
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

// Notes are cached per row so a row's memoised props stay equal while nothing changed.
const noteCache = new Map<string, { text: string }>()
const stable = (key: string, text: string) => {
  const have = noteCache.get(key)
  if (have && have.text === text) return have
  const next = { text }
  noteCache.set(key, next)
  return next
}

/** A row's own note: "Mia changed this after your offline edit" (todos and bookings). */
function entityNote(
  key: string,
  updatedBy: string | undefined,
  notes: Record<string, ConflictNote>,
  me: string | undefined,
  members: Member[],
) {
  if (!notes[key]) return undefined
  const who = memberName(updatedBy, me, members)
  const name = !who || who === 'you' ? 'Someone' : who === 'a housemate' ? 'A housemate' : who
  return stable(key, `${name} changed this after your offline edit`)
}

const FIELD_WORDS: Record<string, string> = {
  title: 'the name',
  notes: 'the notes',
  start_date: 'the dates',
  end_date: 'the dates',
  stops: 'the route',
  destination: 'the route',
  icon: 'the icon',
  tz: 'the time zone',
}
/** "the name", "the day label for Tue 20": a trip field in words. */
export function fieldPhrase(f: string): string {
  if (f.startsWith('days.')) return `the day label for ${shortDay(f.slice(5))}`
  return FIELD_WORDS[f] ?? f.replace(/_/g, ' ')
}

/** Notes about the trip itself (not a row): shown in the header. */
export function tripNoteList(notes: Record<string, ConflictNote>, tripId: string) {
  return Object.values(notes)
    .filter((n) => n.tripId === tripId && n.kind === 'trip')
    .map((n) => {
      const what = [...new Set(n.fields.map(fieldPhrase))]
      return {
        key: n.key,
        text: `A housemate changed ${what.length ? what.join(' and ') : 'this'} after your offline edit`,
      }
    })
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
  // Ids of the two rows that overlap: a thin amber rule on the left.
  clashIds?: readonly string[]
  // The Ideas list: rows without checkboxes.
  ideas?: boolean
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
  clashIds,
  ideas,
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
          changedBy={recentOther(td, shared.me, shared.members, t)}
          note={entityNote(td.todo_id, td.updated_by, shared.notes, shared.me, shared.members)}
          moveOpen={moveOpenId === td.todo_id}
          selected={selectedId === td.todo_id}
          overdue={!!today && e.day === today && !td.done && e.endMs !== null && e.endMs < nowMs}
          locked={shared.locked}
          dayLabel={showDay ? shortDay(e.day) : ''}
          days={shared.days}
          entering={enteringId === td.todo_id}
          clash={!!clashIds?.includes(td.todo_id)}
          idea={ideas}
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
          selected={selectedId === b.booking_id}
          clash={!!clashIds?.includes(b.booking_id)}
          note={entityNote(b.booking_id, b.updated_by, shared.notes, shared.me, shared.members)}
          onSeeTheirs={shared.actions.seeTheirs}
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
  prefix?: string
  onSet: (d: string, l: string) => void
}

// The day's name: yours, or a muted suggestion from where its stops are. Click to accept or edit.
const DayLabel: React.FC<LabelProps> = ({ date, label, suggested, locked, prefix, onSet }) => {
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
      {shown ? `${prefix ?? ''}${shown}` : 'Add a label'}
    </button>
  )
}

/** A day is done when it has todos and every one is ticked, whatever its date. */
export const dayDone = (d: DayModel) => {
  const todos = d.entries.filter((e) => e.kind === 'todo')
  return todos.length > 0 && todos.every((e) => e.kind === 'todo' && e.todo.done)
}

type DayProps = {
  day: DayModel
  shared: Shared
  moveOpenId: string | null
  selectedId: string | null
  enteringId: string | null
  isToday: boolean
  // Replaces the date as the heading ("Later today" under the next-stop deck).
  heading?: string
  onFold: (date: string) => void
  nowMs: number
  nowIndex: number
  nowLabel: string
  stay?: Booking
  lazy: boolean
  today: string
  // "Day done" shows for a moment after the last item is ticked, then the day leaves the plan.
  celebrating: boolean
  // Collapsed to one line (phone: only today and the day you picked are open).
  closed: boolean
  // Today and later days only: the pair that runs into each other.
  clash?: Clash
  // Which of the day colours this day wears (the map pin's colour, and the number badge).
  colourIndex?: number
}

/** One day: a section of the plan sheet, divided the way a list divides its groups. */
export const DaySection = React.memo<DayProps>(function DaySection({
  day,
  shared,
  moveOpenId,
  selectedId,
  enteringId,
  isToday,
  heading,
  onFold,
  nowMs,
  nowIndex,
  nowLabel,
  stay,
  lazy,
  today,
  celebrating,
  closed,
  clash,
  colourIndex = 0,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.date}` })
  const label = day.label || day.suggested
  // One row grid for the whole day: a time column only when something in it has a time.
  const hasTime = day.entries.some((e) => e.startMs !== null) || (isToday && !!stay)
  const cls = [
    'trip-day',
    hasTime ? 'has-time' : '',
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
        aria-label={shortDay(day.date)}
      >
        <button
          type="button"
          className="trip-day-closed"
          aria-expanded={false}
          aria-label={`Show ${shortDay(day.date)}`}
          onClick={() => onFold(day.date)}
        >
          <span className="trip-day-closed-text">
            <strong>{shortDay(day.date)}</strong>
            {label ? ` · ${label}` : ''}
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
      style={{ '--day-colour': `var(--trip-day-${colourIndex % 6})` } as React.CSSProperties}
      aria-label={shortDay(day.date)}
    >
      <header className="trip-day-head">
        <h3 tabIndex={-1} id={`day-${day.date}-title`}>
          {heading ?? (isToday ? 'Today' : shortDay(day.date))}
        </h3>
        <DayLabel
          date={day.date}
          label={day.label}
          suggested={day.suggested}
          locked={shared.locked}
          prefix={isToday && !heading ? 'in ' : undefined}
          onSet={shared.setDayLabel}
        />
        <button
          type="button"
          className="trip-day-fold"
          aria-expanded
          aria-label={`Hide ${shortDay(day.date)}`}
          onClick={() => onFold(day.date)}
        >
          <CaretDown aria-hidden />
        </button>
        {celebrating && <span className="trip-stamp">Day done</span>}
      </header>
      {clash && (
        <button type="button" className="trip-clash" onClick={() => shared.onClash(clash.laterId)}>
          {clash.text}
        </button>
      )}
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
          clashIds={clash?.ids}
        />
      )}
    </section>
  )
})
