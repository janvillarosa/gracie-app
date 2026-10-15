import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { message } from 'antd'
import type { Trip } from '@api/tripTypes'
import { LIMITS } from '@lib/trips/limits'
import type { TripStore } from '@lib/trips/store'
import { fullDay, orderBetween, orderForTime, type Schedule } from '@lib/trips/schedule'
import type { BookingActions } from '@components/trips/Bookings'
import type { QuickAddItem } from '@components/trips/QuickAdd'
import type { RowActions } from '@components/trips/TodoRow'
import { Button } from '@components/ui'

const UNDO_MS = 5000

export type Ctx = {
  trip: Trip
  schedule: Schedule
  store: TripStore
  announce: (t: string) => void
  openItem: (id: string | null) => void
  setMoveOpen: (id: string | null) => void
  hide: (id: string, on: boolean) => void
  entered: (id: string) => void
  showDay: (date: string) => void
}

const maxOrder = (trip: Trip, day: string | null) =>
  trip.todos.filter((t) => (t.day ?? null) === day).reduce((m, t) => Math.max(m, t.order), 0)

/** A day's (or the Ideas) todos in their manual order. */
export const listFor = (trip: Trip, day: string | null, except?: string) =>
  trip.todos
    .filter((t) => (t.day ?? null) === day && t.todo_id !== except)
    .sort((a, b) => a.order - b.order || (a.todo_id < b.todo_id ? -1 : 1))

/** Where a todo with this time goes in its day: by time among the timed ones, else at the end. */
const slotOrder = (trip: Trip, day: string, time: string, tz: string | undefined, id?: string) =>
  orderForTime(listFor(trip, day, id), day, time, tz, trip.tz) ?? maxOrder(trip, day) + 1

/** What the screen does to the trip: add, move, edit, delete (with Undo), reorder. Reads the live
 *  trip through `ctx`, so the returned handlers stay stable across renders. */
export function useScreenActions(ctx: React.MutableRefObject<Ctx>) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const commitDelete = useCallback(
    (id: string) => {
      const t = timers.current.get(id)
      if (t) clearTimeout(t)
      timers.current.delete(id)
      const { store, trip } = ctx.current
      store.deleteTodo(trip.trip_id, id)
      ctx.current.hide(id, false)
    },
    [ctx],
  )

  // Anything still waiting behind an Undo is deleted when the screen goes away.
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const id of [...pending.keys()]) commitDelete(id)
    }
  }, [commitDelete])

  return useMemo(() => {
    const c = () => ctx.current
    const add = (day: string | null, item: QuickAddItem): string | undefined => {
      const { trip, store, announce, entered, showDay } = c()
      if (trip.todos.length >= LIMITS.todos) {
        message.error('This trip is full (150 todos). Remove something before adding more.')
        return undefined
      }
      // A gentle word before the wall.
      if (trip.todos.length + 1 >= LIMITS.todosWarnAt && trip.todos.length + 1 < LIMITS.todos)
        message.warning(`${LIMITS.todos - trip.todos.length - 1} left before this trip is full.`)
      const order =
        day && item.start_time
          ? slotOrder(trip, day, item.start_time, item.place?.tz)
          : maxOrder(trip, day) + 1
      const id = store.createTodo(trip.trip_id, {
        title: item.title,
        day,
        order,
        category: 'other',
        ...(item.start_time ? { start_time: item.start_time } : {}),
        ...(item.place ? { place: item.place } : {}),
      })
      if (day) showDay(day)
      entered(id)
      announce(`Added ${item.title} to ${day ? fullDay(day) : 'Ideas'}`)
      return id
    }

    const rowActions: RowActions = {
      toggle: (id, done) => c().store.updateTodo(c().trip.trip_id, id, { done }),
      open: (id) => c().openItem(id),
      openMove: (id) => c().setMoveOpen(id),
      move: (id, day) => {
        const { trip, store, announce, setMoveOpen } = c()
        const td = trip.todos.find((t) => t.todo_id === id)
        if (!td) return
        setMoveOpen(null)
        if ((td.day ?? null) === day) return
        const order =
          day && td.start_time
            ? slotOrder(trip, day, td.start_time, td.tz, id)
            : maxOrder(trip, day) + 1
        store.updateTodo(trip.trip_id, id, { day, order })
        if (day) c().showDay(day)
        announce(`Moved ${td.title} to ${day ? fullDay(day) : 'Ideas'}`)
      },
      patch: (id, patch) => {
        const { trip, store } = c()
        const td = trip.todos.find((t) => t.todo_id === id)
        // Setting or changing a time places the todo by time among the timed ones; clearing
        // it leaves the todo where it is.
        if (td?.day && typeof patch.start_time === 'string' && patch.start_time) {
          const order = slotOrder(trip, td.day, patch.start_time, td.tz, id)
          store.updateTodo(trip.trip_id, id, { ...patch, order })
        } else store.updateTodo(trip.trip_id, id, patch)
      },
      remove: (id) => {
        const { trip, hide, openItem } = c()
        const td = trip.todos.find((t) => t.todo_id === id)
        if (!td || timers.current.has(id)) return
        openItem(null)
        hide(id, true)
        timers.current.set(
          id,
          setTimeout(() => commitDelete(id), UNDO_MS),
        )
        message.open({
          key: `del-${id}`,
          duration: UNDO_MS / 1000,
          content: (
            <span>
              Deleted {td.title}.{' '}
              <Button
                kind="text"
                onClick={() => {
                  const t = timers.current.get(id)
                  if (t) clearTimeout(t)
                  timers.current.delete(id)
                  hide(id, false)
                  message.destroy(`del-${id}`)
                }}
              >
                Undo
              </Button>
            </span>
          ),
        })
      },
      reorder: (id, dir) => {
        const { trip, store, announce } = c()
        const td = trip.todos.find((t) => t.todo_id === id)
        if (!td) return
        // The order is the manual order, timed or not.
        const list = listFor(trip, td.day ?? null)
        const i = list.findIndex((t) => t.todo_id === id)
        const j = i + dir
        if (i < 0) return
        if (j < 0 || j >= list.length) {
          announce(`${td.title} is already ${dir < 0 ? 'first' : 'last'}`)
          return
        }
        const order =
          dir < 0
            ? orderBetween(list[j - 1]?.order, list[j].order)
            : orderBetween(list[j].order, list[j + 1]?.order)
        store.updateTodo(trip.trip_id, id, { order })
        announce(
          `Moved ${td.title} ${dir < 0 ? 'up' : 'down'}, position ${j + 1} of ${list.length}`,
        )
      },
      seeTheirs: (key) => {
        c().store.dismissNote(key)
        c().openItem(key)
      },
    }

    const bookingActions: BookingActions = {
      save: (id, patch) => {
        const { trip, store, announce } = c()
        if (!id && trip.bookings.length >= LIMITS.bookings) {
          message.error('This trip has all the bookings it can hold (50). Remove one to add more.')
          return
        }
        if (id) store.updateBooking(trip.trip_id, id, patch)
        else store.createBooking(trip.trip_id, patch)
        announce('Booking saved')
      },
      remove: (id) => {
        const { trip, store, announce, openItem } = c()
        store.deleteBooking(trip.trip_id, id)
        openItem(null)
        announce('Booking deleted')
      },
      copy: (code) => {
        void navigator.clipboard?.writeText(code)
        message.success('Code copied')
      },
    }

    const setDayLabel = (date: string, label: string) =>
      c().store.updateTrip(c().trip.trip_id, { days: { [date]: label } })

    return { add, rowActions, bookingActions, setDayLabel }
  }, [ctx, commitDelete])
}
