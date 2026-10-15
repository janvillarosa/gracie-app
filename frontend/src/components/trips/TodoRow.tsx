import React, { useEffect, useRef } from 'react'
import { Button, Checkbox } from 'antd'
import { ArrowsOutCardinal, DotsSixVertical, Trash } from '@phosphor-icons/react'
import { useDraggable } from '@dnd-kit/core'
import type { TripTodo } from '@api/tripTypes'
import { confettiAt } from '@lib/confetti'
import { useSwipeToDelete } from '@components/ItemRow'
import { categoryLabel } from './tripUi'
import { MoveMenu, type MoveTarget } from './MoveMenu'

export type RowActions = {
  toggle: (todoId: string, done: boolean) => void
  // Opens the item detail (a sheet on the phone, a panel over the map on desktop).
  open: (id: string) => void
  openMove: (id: string | null) => void
  move: (todoId: string, day: string | null) => void
  patch: (todoId: string, patch: Record<string, unknown>) => void
  remove: (todoId: string) => void
  reorder: (todoId: string, dir: -1 | 1) => void
  seeTheirs: (key: string) => void
}

export type RowNote = { text: string }

type Props = {
  todo: TripTodo
  // Number on the map, shown quietly in the time gutter while the map is visible.
  pin?: number
  // Name of a housemate who changed this in the last 24h (their initial shows as a dot).
  changedBy: string
  note?: RowNote
  moveOpen: boolean
  selected: boolean
  // Today, timed, in the past and not ticked.
  overdue: boolean
  // Read-only (a finished trip nobody chose to edit).
  locked: boolean
  // Shown under the title when the row sits outside the trip's dates.
  dayLabel: string
  days: MoveTarget[]
  // True the first time a row appears after it was added here.
  entering: boolean
  actions: RowActions
}

// Memoized so ticking one row or typing in the add bar doesn't re-render the whole spine.
export const TodoRow = React.memo<Props>(function TodoRow({
  todo,
  pin,
  changedBy,
  note,
  moveOpen,
  selected,
  overdue,
  locked,
  dayLabel,
  days,
  entering,
  actions,
}) {
  const id = todo.todo_id
  const boxRef = useRef<HTMLSpanElement>(null)
  const liRef = useRef<HTMLLIElement | null>(null)
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { kind: 'todo' },
    disabled: locked,
  })
  const swipe = useSwipeToDelete(() => actions.remove(id), locked)

  // A row that was just added scrolls into view if it is off screen.
  useEffect(() => {
    if (entering) liRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [entering])

  const onToggle = (e: { target: { checked: boolean } }) => {
    actions.toggle(id, e.target.checked)
    if (e.target.checked && boxRef.current) {
      const r = boxRef.current.getBoundingClientRect()
      // A small burst: the spine is for working, not parties.
      confettiAt(r.left + r.width / 2, r.top + r.height / 2, { count: 10, durationMs: 900 })
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      actions.reorder(id, e.key === 'ArrowUp' ? -1 : 1)
    }
  }

  const sub = todo.place?.name && todo.place.name !== todo.title ? todo.place.name : ''
  const second = [sub, dayLabel].filter(Boolean).join(' · ')

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Alt+arrows reorder from anywhere in the row
    <li
      ref={(el) => {
        liRef.current = el
        setNodeRef(el)
      }}
      id={`row-${id}`}
      data-entry-id={id}
      className={[
        'trip-row',
        todo.done ? 'is-done' : '',
        selected ? 'is-selected' : '',
        isDragging ? 'is-dragging' : '',
        entering ? 'is-entering' : '',
        overdue ? 'is-overdue' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onKeyDown={onKeyDown}
    >
      <div className="item-swipe">
        <div ref={swipe.trayRef} className="swipe-tray" aria-hidden>
          <Trash weight="bold" className="swipe-tray-icon" />
        </div>
        <div ref={swipe.slideRef} className="item-slide" {...swipe.handlers}>
          <div className="trip-row-line" {...listeners}>
            <span className="trip-grip" aria-hidden>
              <DotsSixVertical />
            </span>
            <span ref={boxRef} className="trip-check">
              <Checkbox
                checked={todo.done}
                disabled={locked}
                onChange={onToggle}
                aria-label={`${todo.title}, done`}
              />
            </span>
            <span className="trip-time">
              {todo.start_time ?? ''}
              {pin ? <span className="trip-pinno">{pin}</span> : null}
            </span>
            <button
              type="button"
              className="trip-main"
              aria-haspopup="dialog"
              onClick={() => actions.open(id)}
            >
              <span className="trip-title">{todo.title}</span>
              {second && <span className="trip-sub">{second}</span>}
            </button>
            {changedBy && (
              <span className="trip-whodot" role="img" aria-label={`Changed by ${changedBy}`}>
                {changedBy[0].toUpperCase()}
              </span>
            )}
            <span
              className={`trip-catdot trip-catdot-${todo.category}`}
              role="img"
              aria-label={categoryLabel(todo.category)}
            />
            {!locked && (
              <span className="trip-acts">
                <Button
                  type="text"
                  shape="circle"
                  size="small"
                  aria-label={`Move ${todo.title} to…`}
                  aria-haspopup="menu"
                  aria-expanded={moveOpen}
                  onClick={() => actions.openMove(moveOpen ? null : id)}
                  icon={<ArrowsOutCardinal />}
                />
              </span>
            )}
            {moveOpen && (
              <MoveMenu
                title={todo.title}
                targets={days}
                current={todo.day ?? null}
                onPick={(d) => actions.move(id, d)}
                onClose={() => actions.openMove(null)}
              />
            )}
          </div>
        </div>
      </div>
      {note && (
        <div className="trip-note" role="status">
          <span>{note.text}</span>
          <Button size="small" type="link" onClick={() => actions.seeTheirs(id)}>
            See theirs
          </Button>
        </div>
      )}
    </li>
  )
})
