import React, { useEffect, useRef, useState } from 'react'
import { Button } from '@components/ui'
import { Checkbox } from 'antd'
import { CalendarPlus, DotsSixVertical, Trash, Warning } from '@phosphor-icons/react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
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
  // Overlaps another row: a thin amber rule on the left.
  clash?: boolean
  // An idea is not a task: a category dot instead of a checkbox, and a key to add it to a day.
  idea?: boolean
  // Long trips: the drag and drop handles arrive when the row is first touched or focused.
  lazyDnd?: boolean
  // A drag is under way: every row is a drop target.
  dragging?: boolean
  actions: RowActions
}

type DndListeners = ReturnType<typeof useDraggable>['listeners']

/** Registers the row with dnd-kit (drag source and drop target) without owning any markup, so
 *  the row itself can render before, and without, it. */
const DndBridge: React.FC<{
  id: string
  disabled: boolean
  node: React.MutableRefObject<HTMLLIElement | null>
  onChange: (v: { listeners?: DndListeners; dragging: boolean }) => void
}> = ({ id, disabled, node, onChange }) => {
  const drag = useDraggable({ id, data: { kind: 'todo' }, disabled })
  // Rows are drop targets too: dropping a row on another places it before or after it.
  const drop = useDroppable({ id: `row:${id}`, disabled })
  const { setNodeRef } = drag
  const setDrop = drop.setNodeRef
  useEffect(() => {
    setNodeRef(node.current)
    setDrop(node.current)
    return () => {
      setNodeRef(null)
      setDrop(null)
    }
  }, [node, setNodeRef, setDrop])
  const { listeners, isDragging } = drag
  useEffect(() => onChange({ listeners, dragging: isDragging }), [listeners, isDragging, onChange])
  return null
}

// Memoized so ticking one row or typing in the add bar doesn't re-render the whole spine.
export const TodoRow = React.memo<Props>(function TodoRow({
  todo,
  changedBy,
  note,
  moveOpen,
  selected,
  overdue,
  locked,
  dayLabel,
  days,
  entering,
  clash,
  idea,
  lazyDnd,
  dragging,
  actions,
}) {
  const id = todo.todo_id
  const boxRef = useRef<HTMLSpanElement>(null)
  const liRef = useRef<HTMLLIElement | null>(null)
  // Mounting drag and drop hooks for 150 rows is real work on an old phone: with many rows they
  // mount on first touch, focus or pointer-over (or when any drag starts).
  const [armed, setArmed] = useState(!lazyDnd)
  const [dnd, setDnd] = useState<{ listeners?: DndListeners; dragging: boolean } | null>(null)
  useEffect(() => {
    if (dragging) setArmed(true)
  }, [dragging])
  const isDragging = !!dnd?.dragging
  const listeners = dnd?.listeners
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
      ref={liRef}
      data-dnd={armed ? 'on' : 'off'}
      onPointerEnter={armed ? undefined : () => setArmed(true)}
      onFocusCapture={armed ? undefined : () => setArmed(true)}
      onTouchStartCapture={armed ? undefined : () => setArmed(true)}
      id={`row-${id}`}
      data-entry-id={id}
      className={[
        'trip-row',
        todo.done ? 'is-done' : '',
        selected ? 'is-selected' : '',
        isDragging ? 'is-dragging' : '',
        entering ? 'is-entering' : '',
        overdue ? 'is-overdue' : '',
        clash ? 'is-clash' : '',
        idea ? 'is-idea' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onKeyDown={onKeyDown}
    >
      {armed && <DndBridge id={id} disabled={locked} node={liRef} onChange={setDnd} />}
      <div className="item-swipe">
        <div ref={swipe.trayRef} className="swipe-tray" aria-hidden>
          <Trash weight="bold" className="swipe-tray-icon" />
        </div>
        <div ref={swipe.slideRef} className="item-slide" {...swipe.handlers}>
          <div className="trip-row-line" {...listeners}>
            {idea ? (
              <span className="trip-check trip-idea-dot">
                <span
                  className={`trip-catdot trip-catdot-${todo.category}`}
                  role="img"
                  aria-label={categoryLabel(todo.category)}
                />
              </span>
            ) : (
              <span ref={boxRef} className="trip-check">
                <Checkbox
                  checked={todo.done}
                  disabled={locked}
                  onChange={onToggle}
                  aria-label={`${todo.title}, done`}
                />
              </span>
            )}
            {todo.start_time && (
              <span className="trip-time">
                {clash && <Warning className="trip-time-flag" weight="bold" aria-hidden />}
                {todo.start_time}
              </span>
            )}
            <button
              type="button"
              className="trip-main"
              aria-haspopup="dialog"
              onClick={() => actions.open(id)}
            >
              <span className="trip-titleline">
                <span className="trip-title">{todo.title}</span>
              </span>
              {second && <span className="trip-sub">{second}</span>}
            </button>
            <span className="trip-trail">
              {changedBy && (
                <span className="trip-whodot" role="img" aria-label={`Changed by ${changedBy}`}>
                  {changedBy[0].toUpperCase()}
                </span>
              )}
              {!changedBy && !idea && (
                <span
                  className={`trip-catdot trip-catdot-${todo.category}`}
                  role="img"
                  aria-label={categoryLabel(todo.category)}
                />
              )}
              {!locked && (
                <span className="trip-acts">
                  <Button
                    kind="text"
                    iconOnly
                    aria-label={`Delete ${todo.title}`}
                    onClick={() => actions.remove(id)}
                    icon={<Trash />}
                  />
                </span>
              )}
              {idea && !locked && (
                <Button
                  kind="text"
                  iconOnly
                  className="trip-addday"
                  aria-label={`Add ${todo.title} to a day`}
                  aria-haspopup="menu"
                  aria-expanded={moveOpen}
                  onClick={() => actions.openMove(moveOpen ? null : id)}
                  icon={<CalendarPlus />}
                />
              )}
              <span className="trip-grip" aria-hidden>
                <DotsSixVertical />
              </span>
            </span>
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
          <Button kind="text" onClick={() => actions.seeTheirs(id)}>
            See theirs
          </Button>
        </div>
      )}
    </li>
  )
})
