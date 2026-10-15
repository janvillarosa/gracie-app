import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { message } from 'antd'
import type { Place, Trip } from '@api/tripTypes'
import { reorderLock } from '@components/ItemRow'
import { Button } from '@components/ui'
import {
  MAP_DEBOUNCE_MS,
  SPRING_MS,
  dropHint,
  edgeScroll,
  type DropHint,
} from '@lib/trips/dragDrop'
import type { TripStore } from '@lib/trips/store'
import { shortDay } from '@lib/trips/schedule'
import { quietEnter } from '@components/trips/TodoRow'
import type { Ctx } from './useScreenActions'

export type { DropHint } from '@lib/trips/dragDrop'

const UNDO_S = 5
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

type Args = {
  trip: Trip
  store: TripStore
  ctx: React.MutableRefObject<Ctx>
  announce: (t: string) => void
  // Spring-loaded days: is this date folded, open it, fold it again.
  isClosed: (date: string) => boolean
  openDay: (date: string) => void
  foldDay: (date: string) => void
  // The map follows the day under the pointer, and shows the dragged item's place.
  currentDay: string | null
  setCurrentDay: (date: string | null) => void
  setPreview: (place: Place | null) => void
  // On a desk the panes scroll, not the window: the drag scrolls the one under the pointer.
  scrollers?: () => { days: HTMLElement | null; ideas: HTMLElement | null }
}

/** Dragging an idea or a row onto a row (reorder), a day or Ideas (move). Mouse after 8px, touch
 *  after a 300ms hold. While a drag is held: the page scrolls itself near its top and bottom
 *  edges, a folded day under the pointer opens after 600ms, and the map shows that day with the
 *  dragged item's place as a preview pip. A drop plays the sweep, says "Added to Wed 25" with an
 *  Undo, and never moves the page. */
export function useTripDrag({
  trip,
  store,
  ctx,
  announce,
  isClosed,
  openDay,
  foldDay,
  currentDay,
  setCurrentDay,
  setPreview,
  scrollers,
}: Args) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropHint>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
  )

  // Everything the timers read lives in refs, so they always see the latest state.
  const live = useRef({ trip, isClosed, openDay, foldDay, currentDay })
  live.current = { trip, isClosed, openDay, foldDay, currentDay }
  const pointerY = useRef<number | null>(null)
  const pointerX = useRef<number | null>(null)
  const raf = useRef(0)
  const springTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const springFor = useRef<string | null>(null)
  const sprung = useRef(new Set<string>())
  const mapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startDay = useRef<string | null>(null)

  // ---- auto-scroll: a rAF loop while a drag is held -----------------------------------------
  useEffect(() => {
    if (!dragging) return
    const track = (e: MouseEvent | PointerEvent | TouchEvent) => {
      const p = 'touches' in e ? e.touches[0] : e
      pointerY.current = p?.clientY ?? null
      pointerX.current = p?.clientX ?? null
    }
    window.addEventListener('pointermove', track, true)
    window.addEventListener('mousemove', track, true)
    window.addEventListener('touchmove', track, { capture: true, passive: true })
    const tick = () => {
      const y = pointerY.current
      const x = pointerX.current
      const panes = scrollers?.()
      if (y !== null && panes && (panes.days || panes.ideas)) {
        // A desk: scroll the pane under the pointer, near its own top or bottom edge. The days
        // pane ends where the floating composer begins.
        const pane = [panes.days, panes.ideas].find((el) => {
          const r = el?.getBoundingClientRect()
          return !!r && x !== null && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
        })
        if (pane) {
          const r = pane.getBoundingClientRect()
          const c = document.querySelector('.trip-composer')?.getBoundingClientRect()
          const bottom =
            pane === panes.days && c && c.top > r.top && c.top < r.bottom ? c.top : r.bottom
          const dy = edgeScroll(y, r.top, bottom)
          if (dy) pane.scrollBy(0, dy)
        }
      } else if (y !== null) {
        // The phone: the window scrolls, above the sticky add bar at its foot.
        const bar = document.querySelector('.add-bar')?.getBoundingClientRect()
        const bottom =
          bar && bar.top > 0 && bar.top < window.innerHeight ? bar.top : window.innerHeight
        const dy = edgeScroll(y, 0, bottom)
        if (dy) window.scrollBy(0, dy)
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf.current)
      window.removeEventListener('pointermove', track, true)
      window.removeEventListener('mousemove', track, true)
      window.removeEventListener('touchmove', track, true)
      pointerY.current = null
      pointerX.current = null
    }
  }, [dragging, scrollers])

  const clearTimers = useCallback(() => {
    if (springTimer.current) clearTimeout(springTimer.current)
    if (mapTimer.current) clearTimeout(mapTimer.current)
    springTimer.current = mapTimer.current = null
    springFor.current = null
  }, [])
  useEffect(
    () => () => {
      clearTimers()
      // Leaving mid-drag must not leave rows locked.
      reorderLock.active = false
    },
    [clearTimers],
  )

  const finish = (restoreDay: boolean) => {
    reorderLock.active = false
    setDragging(null)
    setDrop(null)
    clearTimers()
    setPreview(null)
    if (restoreDay) setCurrentDay(startDay.current)
    // Days that opened under the pointer fold again.
    const opened = [...sprung.current]
    sprung.current.clear()
    if (opened.length)
      setTimeout(() => {
        for (const d of opened) live.current.foldDay(d)
      }, 0)
  }

  const onDragStart = (e: DragStartEvent) => {
    reorderLock.active = true
    const id = String(e.active.id)
    setDragging(id)
    startDay.current = live.current.currentDay
    const moving = live.current.trip.todos.find((t) => t.todo_id === id)
    const p = moving?.place
    setPreview(p && p.source !== 'manual' ? p : null)
    // A small tick under the finger where the device has one.
    try {
      navigator.vibrate?.(10)
    } catch {}
  }

  const overDate = (over: string): string | null => {
    if (over.startsWith('day:')) return over.slice(4)
    if (over.startsWith('row:'))
      return live.current.trip.todos.find((t) => t.todo_id === over.slice(4))?.day ?? null
    return null
  }

  const onDragOver = (e: DragOverEvent) => {
    const over = e.over ? String(e.over.id) : ''
    const next = over ? dropHint(live.current.trip, String(e.active.id), over) : null
    setDrop((p) => (JSON.stringify(p) === JSON.stringify(next) ? p : next))
    const date = overDate(over)
    // Spring-loaded: a folded day under the pointer opens after a beat.
    if (date !== springFor.current) {
      if (springTimer.current) clearTimeout(springTimer.current)
      springFor.current = date
      springTimer.current = null
      if (date && live.current.isClosed(date)) {
        springTimer.current = setTimeout(() => {
          if (live.current.isClosed(date)) {
            sprung.current.add(date)
            live.current.openDay(date)
          }
        }, SPRING_MS)
      }
    }
    // The map follows the day under the pointer (not on every pixel).
    if (date) {
      if (mapTimer.current) clearTimeout(mapTimer.current)
      mapTimer.current = setTimeout(() => setCurrentDay(date), MAP_DEBOUNCE_MS)
    }
  }

  const onDragCancel = () => finish(true)

  const onDragEnd = (e: DragEndEvent) => {
    const over = e.over ? String(e.over.id) : ''
    const activeId = String(e.active.id)
    const hint = over ? dropHint(live.current.trip, activeId, over) : null
    if (!hint) return finish(true)
    const moving = live.current.trip.todos.find((t) => t.todo_id === activeId)
    if (!moving) return finish(true)
    finish(false)

    const before = { day: moving.day ?? null, order: moving.order }
    // Nothing to do if it lands where it already is.
    if (before.day === hint.day && before.order === hint.order) return
    store.updateTodo(live.current.trip.trip_id, activeId, { day: hint.day, order: hint.order })
    if (hint.day) ctx.current.showDay(hint.day)
    // The page stays where it is, even when the day is far away: the row plays its sweep once.
    quietEnter.current = true
    setTimeout(() => {
      quietEnter.current = false
    }, 1500)
    ctx.current.entered(activeId)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const row = document.getElementById(`row-${activeId}`)
        if (!row || reduced()) return
        row.classList.add('is-sweep')
        setTimeout(() => row.classList.remove('is-sweep'), 1400)
      }),
    )
    const where = hint.day ? shortDay(hint.day) : 'Ideas'
    const text = before.day === null && hint.day ? `Added to ${where}` : `Moved to ${where}`
    announce(`${text}: ${moving.title}`)
    const key = `drop-${activeId}`
    message.open({
      key,
      duration: UNDO_S,
      content: (
        <span>
          {text}.{' '}
          <Button
            kind="text"
            onClick={() => {
              store.updateTodo(live.current.trip.trip_id, activeId, before)
              message.destroy(key)
              announce(`Moved ${moving.title} back`)
            }}
          >
            Undo
          </Button>
        </span>
      ),
    })
  }
  const dragTitle = dragging ? trip.todos.find((t) => t.todo_id === dragging)?.title : ''

  return { dragging, drop, sensors, onDragStart, onDragOver, onDragEnd, onDragCancel, dragTitle }
}
