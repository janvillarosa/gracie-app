// What a drag does, as plain data: where an item would land, how fast the page should scroll,
// when a folded day opens under the pointer. No React, no DOM: tested on its own.
import type { Trip, TripTodo } from '@api/tripTypes'
import { orderBetween, orderForDrop, orderForTime } from './schedule'

/** The todos of a day (null: Ideas) in their manual order, without `except`. */
export const todosOf = (trip: Trip, day: string | null, except?: string): TripTodo[] =>
  trip.todos
    .filter((t) => (t.day ?? null) === day && t.todo_id !== except)
    .sort((a, b) => a.order - b.order || (a.todo_id < b.todo_id ? -1 : 1))

const maxOrder = (trip: Trip, day: string | null) =>
  trip.todos.filter((t) => (t.day ?? null) === day).reduce((m, t) => Math.max(m, t.order), 0)

/** Where a drop would land: the day (null: Ideas), the order it gets, and the row the yellow
 *  line sits beside (before or after it; none in an empty day). */
export type DropAnchor = { id: string; before: boolean }
export type DropHint = {
  day: string | null
  order: number
  // The line goes before/after this row.
  anchor?: DropAnchor
  // "at 14:00": a timed item lands at its time, wherever the pointer is.
  label?: string
} | null

const anchorFor = (list: TripTodo[], order: number): DropAnchor | undefined => {
  if (!list.length) return undefined
  const next = list.find((t) => t.order > order)
  return next
    ? { id: next.todo_id, before: true }
    : { id: list[list.length - 1].todo_id, before: false }
}

/** Pure: the landing place for dragging `activeId` over the droppable `over` ("row:<id>",
 *  "day:<date>" or "ideas"). An untimed item lands exactly where the line shows (before or after
 *  the row under the pointer, else the end of the day). A timed item lands at its time-sorted
 *  position in the day, whatever the pointer says. */
export function dropHint(trip: Trip, activeId: string, over: string): DropHint {
  const moving = trip.todos.find((t) => t.todo_id === activeId)
  if (!moving) return null
  let day: string | null
  let hover: DropAnchor | undefined
  if (over.startsWith('row:')) {
    const target = trip.todos.find((t) => t.todo_id === over.slice(4))
    if (!target || target.todo_id === activeId) return null
    day = target.day ?? null
    const full = todosOf(trip, day)
    hover = {
      id: target.todo_id,
      before:
        (moving.day ?? null) !== day ||
        full.findIndex((t) => t.todo_id === activeId) >
          full.findIndex((t) => t.todo_id === target.todo_id),
    }
  } else if (over === 'ideas') day = null
  else if (over.startsWith('day:')) day = over.slice(4)
  // The date rail (long trips) drops on a day like the day itself.
  else if (over.startsWith('rail:')) day = over.slice(5)
  else return null

  const list = todosOf(trip, day, activeId)
  if (day && moving.start_time) {
    const timed = orderForTime(list, day, moving.start_time, moving.tz, trip.tz)
    if (timed !== undefined)
      return { day, order: timed, anchor: anchorFor(list, timed), label: `at ${moving.start_time}` }
  }
  if (hover) {
    const order = orderForDrop(list, hover.id, hover.before)
    if (order === undefined) return null
    return { day, order, anchor: hover }
  }
  const order =
    day === null ? maxOrder(trip, null) + 1 : orderBetween(list[list.length - 1]?.order, undefined)
  return {
    day,
    order,
    anchor: list.length ? { id: list[list.length - 1].todo_id, before: false } : undefined,
  }
}

// ---- auto-scroll --------------------------------------------------------------------------------

export const EDGE_ZONE = 96
export const MIN_SPEED = 2
export const MAX_SPEED = 24

/** Pixels per frame for a pointer `depth` (0..1) into an edge zone: slow at the rim, eased up. */
export function scrollSpeed(depth: number): number {
  const d = Math.min(1, Math.max(0, depth))
  return MIN_SPEED + (MAX_SPEED - MIN_SPEED) * d * d
}

/** Signed pixels to scroll this frame for a pointer at `y`, with the visible area spanning `top`
 *  to `bottom` (the viewport minus any sticky footer). Zero outside the 96px edge zones. */
export function edgeScroll(y: number, top: number, bottom: number, zone = EDGE_ZONE): number {
  if (y < top + zone) return -scrollSpeed((top + zone - y) / zone)
  if (y > bottom - zone) return scrollSpeed((y - (bottom - zone)) / zone)
  return 0
}

// ---- spring-loaded days ---------------------------------------------------------------------

export const SPRING_MS = 600
export const RAIL_MS = 600
export const MAP_DEBOUNCE_MS = 150
