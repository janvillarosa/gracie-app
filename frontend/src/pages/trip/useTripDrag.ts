import { useState } from 'react'
import {
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import type { Trip } from '@api/tripTypes'
import { reorderLock } from '@components/ItemRow'
import type { RowActions } from '@components/trips/TodoRow'
import type { TripStore } from '@lib/trips/store'
import { orderForDrop } from '@lib/trips/schedule'
import { listFor, type Ctx } from './useScreenActions'

type Args = {
  trip: Trip
  store: TripStore
  ctx: React.MutableRefObject<Ctx>
  rowActions: RowActions
  announce: (t: string) => void
}

/** Dragging a row onto another row (reorder), a day or Ideas (move). Mouse after 8px, touch
 *  after a 350ms hold. */
export function useTripDrag({ trip, store, ctx, rowActions, announce }: Args) {
  const [dragging, setDragging] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 8 } }),
  )
  const onDragStart = (e: DragStartEvent) => {
    reorderLock.active = true
    setDragging(String(e.active.id))
  }
  const onDragEnd = (e: DragEndEvent) => {
    reorderLock.active = false
    setDragging(null)
    const over = e.over ? String(e.over.id) : ''
    if (!over) return
    const activeId = String(e.active.id)
    if (over.startsWith('row:')) {
      // Dropped on another row: it goes before or after it, wherever the user put it.
      const overId = over.slice(4)
      const moving = trip.todos.find((t) => t.todo_id === activeId)
      const target = trip.todos.find((t) => t.todo_id === overId)
      if (!moving || !target || overId === activeId) return
      const day = target.day ?? null
      const full = listFor(trip, day)
      const before =
        (moving.day ?? null) !== day ||
        full.findIndex((t) => t.todo_id === activeId) > full.findIndex((t) => t.todo_id === overId)
      const order = orderForDrop(listFor(trip, day, activeId), overId, before)
      if (order === undefined) return
      store.updateTodo(trip.trip_id, activeId, { day, order })
      if (day) ctx.current.showDay(day)
      announce(`Moved ${moving.title} ${before ? 'before' : 'after'} ${target.title}`)
      return
    }
    const target = over === 'ideas' ? null : over.startsWith('day:') ? over.slice(4) : undefined
    if (target !== undefined) rowActions.move(activeId, target)
  }
  const dragTitle = dragging ? trip.todos.find((t) => t.todo_id === dragging)?.title : ''

  return { dragging, sensors, onDragStart, onDragEnd, dragTitle }
}
