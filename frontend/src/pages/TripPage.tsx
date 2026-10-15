import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Button, Card, message } from 'antd'
import { CaretRight, Check, MapTrifold } from '@phosphor-icons/react'
import { useAuth } from '@auth/AuthProvider'
import { TopNav } from '@components/TopNav'
import { reorderLock } from '@components/ItemRow'
import { HouseLoader } from '@components/HouseLoader'
import { createPackingList } from '@api/tripEndpoints'
import { usePacking } from '@lib/trips/usePacking'
import type { Booking, Trip } from '@api/tripTypes'
import { errorMessage } from '@lib/errors'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import { memberName, useTrips, type Member } from '@lib/trips/hooks'
import type { TripStore } from '@lib/trips/store'
import {
  addDays,
  buildSchedule,
  diffDays,
  fullDay,
  longDay,
  shortRange,
  localDateKey,
  orderBetween,
  orderForDrop,
  orderForTime,
  shortDay,
  tonightsStay,
  tripPhase,
  wallToUtc,
  type DayModel,
  type Schedule,
} from '@lib/trips/schedule'
import { WhenSheet } from '@components/trips/WhenSheet'
import { BookingEditor, BookingsPanel, type BookingActions } from '@components/trips/Bookings'
import { BookingDetail, TodoDetail } from '@components/trips/ItemDetail'
import { DayList, type DayRow } from '@components/trips/DayList'
import { NextStopDeck, type Stop, type Tomorrow } from '@components/trips/NextStop'
import { useMedia } from '@components/trips/Phone'
import { IdeasPanel, NotesPane, Panel, type TabId } from '@components/trips/Panels'
import { AddBar, type QuickAddItem } from '@components/trips/QuickAdd'
import { DaySection, EntryRows, bylineFor, dayDone, type Shared } from '@components/trips/Spine'
import { TripHeader } from '@components/trips/TripHeader'
import { TripMap, type MapPoint, type TripMapHandle } from '@components/trips/TripMap'
import type { RowActions } from '@components/trips/TodoRow'
import { Sheet } from '@components/trips/Sheet'
import { DAY_COLOURS } from '@components/trips/tripUi'
import { PillNav } from '@components/PillNav'
import '../trips.css'

type Extra = 'notes' | null
const UNDO_MS = 5000
const CELEBRATE_MS = 1100
const MAX_TODOS = 150

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function scrollToEl(el: Element | null, focus = true) {
  if (!el) return
  ;(el as HTMLElement).scrollIntoView?.({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' })
  if (focus) {
    const target = el.querySelector<HTMLElement>('h3[tabindex], button') ?? (el as HTMLElement)
    target.focus?.({ preventScroll: true })
  }
}

type Ctx = {
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
const listFor = (trip: Trip, day: string | null, except?: string) =>
  trip.todos
    .filter((t) => (t.day ?? null) === day && t.todo_id !== except)
    .sort((a, b) => a.order - b.order || (a.todo_id < b.todo_id ? -1 : 1))

/** Where a todo with this time goes in its day: by time among the timed ones, else at the end. */
const slotOrder = (trip: Trip, day: string, time: string, tz: string | undefined, id?: string) =>
  orderForTime(listFor(trip, day, id), day, time, tz, trip.tz) ?? maxOrder(trip, day) + 1

function useScreenActions(ctx: React.MutableRefObject<Ctx>) {
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
      if (trip.todos.length >= MAX_TODOS) {
        message.error('This trip is full (150 todos). Remove something before adding more.')
        return undefined
      }
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
                type="link"
                size="small"
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

function pinsFor(schedule: Schedule) {
  let hasDayPlaces = false
  const byDay = new Map<string, MapPoint[]>()
  const ideaDots: MapPoint[] = []
  const ideaPins: MapPoint[] = []
  for (const d of schedule.days) {
    const list: MapPoint[] = []
    for (const e of d.entries) {
      const p = e.kind === 'todo' ? e.todo.place : e.booking.place
      if (!p || p.source === 'manual') continue
      hasDayPlaces = true
      list.push({ id: e.id, lat: p.lat, lng: p.lng })
    }
    byDay.set(d.date, list)
  }
  for (const t of schedule.ideas)
    if (t.place && t.place.source !== 'manual')
      ideaDots.push({ id: t.todo_id, lat: t.place.lat, lng: t.place.lng })
  for (const d of ideaDots) ideaPins.push(d)
  return { hasDayPlaces, byDay, ideaDots, ideaPins }
}

type Segment =
  | { kind: 'day'; key: string; day: DayModel; index: number; closed: boolean }
  | { kind: 'done'; key: string; days: DayModel[] }

const TripScreen: React.FC<{
  trip: Trip
  store: TripStore
  state: ReturnType<typeof useTrips>['state']
  userId?: string
  members: Member[]
  roomName: string
  showNextStop: boolean
}> = ({ trip: rawTrip, store, state, userId, members, roomName, showNextStop }) => {
  const { apiKey } = useAuth()
  const [search] = useSearchParams()
  const [tab, setTab] = useState<TabId>('plan')
  const [extra, setExtra] = useState<Extra>(null)
  const navigate = useNavigate()
  const goSettings = () => navigate(`/app/trips/${rawTrip.trip_id}/settings`)
  const [selected, setSelected] = useState<string | null>(null)
  const [moveOpenId, setMoveOpen] = useState<string | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [override, setOverride] = useState<Record<string, boolean>>({})
  const [showDone, setShowDone] = useState(false)
  const [daysOpen, setDaysOpen] = useState(false)
  const [whenOpen, setWhenOpen] = useState(false)
  const [celebrating, setCelebrating] = useState<ReadonlySet<string>>(() => new Set())
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  const [sheetOpen, setSheetOpen] = useState(false)
  const [currentDay, setCurrentDay] = useState<string | null>(null)
  const [allDays, setAllDays] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [addTarget, setAddTarget] = useState<string>('auto')
  const [enteringId, setEnteringId] = useState<string | null>(null)
  const [freshId, setFreshId] = useState<string | null>(null)
  const [packBusy, setPackBusy] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  // The item whose time field opens ready (from an overlap line).
  const [focusTime, setFocusTime] = useState<string | null>(null)
  const mapRef = useRef<TripMapHandle>(null)

  const desktop = useMedia('(min-width: 1024px)')
  // Tablets use the phone layout: one column, the map in a sheet.
  const phone = useMedia('(max-width: 1023px)')

  // Rows waiting behind an Undo are hidden before the delete is sent.
  const trip = useMemo(
    () =>
      hidden.size
        ? { ...rawTrip, todos: rawTrip.todos.filter((t) => !hidden.has(t.todo_id)) }
        : rawTrip,
    [rawTrip, hidden],
  )
  const schedule = useMemo(() => buildSchedule(trip), [trip])
  const today = localDateKey(new Date(nowMs))
  const phase = tripPhase(trip, today)
  const locked = !!trip.deleted || (phase === 'after' && !unlocked)
  const doneDays = useMemo(
    () => new Set(schedule.days.filter(dayDone).map((d) => d.date)),
    [schedule.days],
  )

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setNowMs(Date.now())
    }, 60000)
    return () => clearInterval(id)
  }, [])

  // Store-level toasts (rejections) show once, then clear.
  useEffect(() => {
    for (const t of state.toasts) {
      message.warning(t.text)
      store.dismissToast(t.id)
    }
  }, [state.toasts, store])

  const ctx = useRef<Ctx>(null as unknown as Ctx)
  ctx.current = {
    trip,
    schedule,
    store,
    announce: setAnnouncement,
    openItem: (id) => {
      setMoveOpen(null)
      setFocusTime(null)
      const key = id ? id.replace(/^tonight-/, '') : null
      setSelected(key)
      // The map shows the day of the item you opened.
      const day =
        trip.todos.find((t) => t.todo_id === key)?.day ??
        trip.bookings.find((b) => b.booking_id === key)?.starts_at?.slice(0, 10)
      if (day) setCurrentDay(day)
    },
    setMoveOpen,
    hide: (id, on) =>
      setHidden((h) => {
        const n = new Set(h)
        if (on) n.add(id)
        else n.delete(id)
        return n
      }),
    entered: (id) => {
      setEnteringId(id)
      setTimeout(() => setEnteringId((e) => (e === id ? null : e)), 1800)
    },
    showDay: (date) => setOverride((o) => (o[date] === true ? o : { ...o, [date]: true })),
  }
  const { add, rowActions, bookingActions, setDayLabel } = useScreenActions(ctx)
  const [bookingDraft, setBookingDraft] = useState<{ title: string } | null>(null)

  const bias = useMemo(() => {
    const p = trip.destination ?? trip.stops?.[0]
    return p && p.source !== 'manual' ? { lat: p.lat, lng: p.lng } : null
  }, [trip.destination, trip.stops])

  // ---- which days are cards, closed cards or slim "done" lines ---------------------------
  const stay = phase === 'during' ? tonightsStay(trip, today) : undefined
  // In the plan only tonight's stay and the next booking show; the rest live under Bookings.
  const nextBookingId = useMemo(() => {
    let best: { id: string; at: number } | null = null
    for (const d of schedule.days)
      for (const e of d.entries) {
        if (e.kind !== 'booking' || e.id === stay?.booking_id) continue
        if (trip.todos.some((t) => t.booking_id === e.id && t.done)) continue
        if ((e.endMs ?? e.startMs ?? 0) < nowMs) continue
        if (!best || (e.startMs ?? 0) < best.at) best = { id: e.id, at: e.startMs ?? 0 }
      }
    return best?.id ?? null
  }, [schedule.days, stay, nowMs, trip.todos])
  const planDates = schedule.days.filter((d) => !doneDays.has(d.date)).map((d) => d.date)
  const firstPlanDate = planDates[0]
  const secondPlanDate = planDates[1]
  const isOpenDay = (d: DayModel) =>
    celebrating.has(d.date) ||
    (override[d.date] ??
      (!phone ||
        (phase === 'during'
          ? d.date <= addDays(today, 1)
          : d.date === firstPlanDate || d.date === secondPlanDate)))
  // The next-stop deck: today's stops in the day's order, only during the trip.
  const deckStops = useMemo<Stop[]>(() => {
    if (phase !== 'during' || !showNextStop) return []
    const model = schedule.days.find((d) => d.date === today)
    return (
      model?.entries
        .filter(
          (e) =>
            e.kind === 'todo' || !trip.todos.some((t) => t.booking_id === e.booking.booking_id),
        )
        .map((e): Stop => {
          const clock = (dt?: string | null) => dt?.split('T')[1] ?? ''
          if (e.kind === 'todo') {
            const t = e.todo
            const bk = t.booking_id
              ? trip.bookings.find((x) => x.booking_id === t.booking_id)
              : undefined
            // The heading is only where to go; the rest is a quiet line under it.
            const heading = t.place?.name || t.title
            const time = t.start_time || clock(bk?.starts_at)
            const overdue = !t.done && e.startMs !== null && e.startMs < nowMs
            const sub = [
              heading !== t.title ? t.title : '',
              // Said once: the time, or "Planned for" it once it has passed.
              overdue && time ? `Planned for ${time}` : time,
              bk?.title ?? '',
              bk ? 'Booked' : '',
            ]
              .filter(Boolean)
              .join(' · ')
            return {
              id: t.todo_id,
              kind: 'todo',
              title: t.title,
              heading,
              sub: sub || 'Anytime',
              time: t.start_time ?? '',
              place: t.place,
              notes: t.notes,
              code: bk?.confirmation_code,
              linked: bk
                ? {
                    title: bk.title,
                    kind: bk.kind,
                    line: [clock(bk.starts_at), bk.place?.name].filter(Boolean).join(' · '),
                  }
                : undefined,
              done: t.done,
              planned: overdue,
            }
          }
          const b = e.booking
          const heading = b.place?.name || b.title
          return {
            id: b.booking_id,
            kind: 'booking',
            title: b.title,
            heading,
            sub: [clock(b.starts_at), heading !== b.title ? b.title : '', 'Booked']
              .filter(Boolean)
              .join(' · '),
            time: clock(b.starts_at),
            place: b.place,
            notes: b.notes,
            code: b.confirmation_code,
            bookingKind: b.kind,
            line: [clock(b.starts_at), b.place?.name].filter(Boolean).join(' · '),
            done:
              (e.endMs ?? e.startMs ?? Number.POSITIVE_INFINITY) < nowMs ||
              dismissed.has(b.booking_id),
            planned: false,
          }
        }) ?? []
    )
  }, [schedule.days, phase, today, nowMs, dismissed, trip.bookings, showNextStop])
  const deckTopId = deckStops.find((s) => !s.done)?.id
  // With the deck switched off, a plain "Next up" line leads today's section.
  const nextUp = useMemo(() => {
    if (phase !== 'during' || showNextStop) return null
    const model = schedule.days.find((d) => d.date === today)
    const todos = model?.entries.flatMap((e) => (e.kind === 'todo' ? [e] : [])) ?? []
    if (!todos.length) return null
    const open = todos.filter((e) => !e.todo.done)
    if (!open.length) return { title: '', time: '' }
    const soon = open
      .filter((e) => e.startMs !== null && e.startMs >= nowMs)
      .sort((a, b) => (a.startMs as number) - (b.startMs as number))[0]
    const pick = soon ?? open[0]
    return { title: pick.todo.title, time: pick.todo.start_time ?? '' }
  }, [schedule.days, phase, today, nowMs, showNextStop])
  const tomorrow = useMemo<Tomorrow>(() => {
    const model = schedule.days.find((d) => d.date === addDays(today, 1))
    if (!model) return null
    const first = model.entries.find((e) => e.kind === 'todo')
    const todo = first?.kind === 'todo' ? first.todo : null
    return {
      date: model.date,
      label: model.label || model.suggested || shortDay(model.date),
      first: todo?.title ?? '',
      time: todo?.start_time ?? '',
    }
  }, [schedule.days, today])

  // biome-ignore lint/correctness/useExhaustiveDependencies: isOpenDay reads exactly these
  const planDays = useMemo(
    () =>
      schedule.days
        .filter((d) => showDone || !doneDays.has(d.date) || celebrating.has(d.date))
        .map((d) => {
          const deckDay = deckStops.length > 0 && d.date === today
          return {
            deckDay,
            day: {
              ...d,
              // With the deck up, today lists only what comes after the top card.
              entries: d.entries.filter((e) =>
                deckDay
                  ? e.id !== deckTopId &&
                    (e.kind === 'todo'
                      ? !e.todo.done
                      : e.id === nextBookingId && !dismissed.has(e.id))
                  : e.kind === 'todo' || (e.id === nextBookingId && e.id !== stay?.booking_id),
              ),
            },
            closed: !isOpenDay(d),
            // Past days are never flagged.
            clash: d.date >= today ? d.clash : undefined,
          }
        })
        .filter((p) => !p.deckDay || p.day.entries.length > 0 || !!stay),
    [
      schedule.days,
      showDone,
      doneDays,
      celebrating,
      override,
      phone,
      phase,
      today,
      nextBookingId,
      deckStops.length,
      deckTopId,
      dismissed,
      stay,
    ],
  )
  // A day finishes when its last item is ticked: "Day done" shows for a moment, then it folds
  // into a slim line. Unticking anything unfolds it again.
  const prevDone = useRef<ReadonlySet<string> | null>(null)
  const foldTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const doneKey = [...doneDays].sort().join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: doneKey stands for doneDays' contents
  useEffect(() => {
    const prev = prevDone.current
    prevDone.current = doneDays
    if (!prev) return
    for (const date of doneDays) {
      if (prev.has(date)) continue
      const fold = () => {
        foldTimers.current.delete(date)
        setCelebrating((c) => {
          const n = new Set(c)
          n.delete(date)
          return n
        })
        setOverride((o) => {
          const { [date]: _x, ...rest } = o
          return rest
        })
        setAnnouncement(`${longDay(date)} done, folded`)
      }
      if (reduced()) fold()
      else {
        setCelebrating((c) => new Set(c).add(date))
        foldTimers.current.set(date, setTimeout(fold, CELEBRATE_MS))
      }
    }
    for (const date of prev) {
      if (doneDays.has(date)) continue
      const t = foldTimers.current.get(date)
      if (t) clearTimeout(t)
      foldTimers.current.delete(date)
      setCelebrating((c) => {
        if (!c.has(date)) return c
        const n = new Set(c)
        n.delete(date)
        return n
      })
      setOverride((o) => {
        if (!(date in o)) return o
        const { [date]: _x, ...rest } = o
        return rest
      })
    }
  }, [doneKey])
  useEffect(() => {
    const timers = foldTimers.current
    return () => {
      for (const t of timers.values()) clearTimeout(t)
    }
  }, [])

  const mapVisible = desktop || (phone && sheetOpen)
  const pins = useMemo(() => pinsFor(schedule), [schedule])
  // The map control appears once there is something to show on it.
  const hasPlaces = pins.hasDayPlaces || pins.ideaDots.length > 0
  const moveTargets = useMemo(
    () => [
      ...schedule.days.map((d) => ({ value: d.date as string | null, label: fullDay(d.date) })),
      { value: null, label: 'Ideas' },
    ],
    [schedule.days],
  )

  const shared: Shared = useMemo(
    () => ({
      actions: rowActions,
      days: moveTargets,
      me: userId,
      members,
      notes: state.notes,
      locked,
      setDayLabel,
      onClash: (id: string) => {
        ctx.current.openItem(id)
        setFocusTime(id)
      },
    }),
    [rowActions, moveTargets, userId, members, state.notes, locked, setDayLabel],
  )

  // ---- the day in view -----------------------------------------------------------------
  const segKey = planDays.map((p) => `${p.day.date}:${p.closed ? 'c' : 'o'}`).join(',')
  useEffect(() => {
    if (!segKey || typeof IntersectionObserver === 'undefined') return
    const inBand = new Set<string>()
    const top = window.innerWidth < 768 ? 120 : 24
    const line = Math.max(top + 8, Math.round(window.innerHeight * 0.25))
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const d = (e.target as HTMLElement).dataset.day as string
          if (e.isIntersecting) inBand.add(d)
          else inBand.delete(d)
        }
        const first = [...inBand].sort()[0]
        if (first) setCurrentDay(first)
      },
      // A one-pixel reading line a little below the sticky chrome: only the day being read
      // crosses it.
      { rootMargin: `-${line}px 0px -${Math.max(0, window.innerHeight - line - 1)}px 0px` },
    )
    // Cards only: a slim done line is not a place you are "reading".
    for (const el of document.querySelectorAll('.trip-day[data-day]')) io.observe(el)
    return () => io.disconnect()
  }, [segKey])
  useEffect(() => {
    setCurrentDay((c) => c ?? (phase === 'during' ? today : (schedule.days[0]?.date ?? null)))
    // biome-ignore lint/correctness/useExhaustiveDependencies: only the first value matters
  }, [schedule.days])

  // First paint: the top of the page, unless the URL carried a day (a deep link).
  const placed = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once when the days first exist
  useEffect(() => {
    if (placed.current || !schedule.days.length) return
    placed.current = true
    const want = search.get('day')
    if (!want || !schedule.days.some((d) => d.date === want)) return
    requestAnimationFrame(() => scrollToEl(document.getElementById(`day-${want}`), false))
  }, [schedule.days.length])

  // biome-ignore lint/correctness/useExhaustiveDependencies: isOpenDay reads exactly these
  const toggleDay = useCallback(
    (date: string) => {
      const d = schedule.days.find((x) => x.date === date)
      if (!d) return
      setOverride((o) => ({ ...o, [date]: !isOpenDay(d) }))
    },
    [schedule.days, doneDays, override, celebrating, phone, phase, today],
  )
  const openDay = useCallback((date: string) => setOverride((o) => ({ ...o, [date]: true })), [])
  const goToDay = useCallback(
    (date: string, focus = true) => {
      setCurrentDay(date)
      if (doneDays.has(date)) setShowDone(true)
      openDay(date)
      // After the open day has rendered.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => scrollToEl(document.getElementById(`day-${date}`), focus)),
      )
    },
    [openDay, doneDays],
  )
  // ---- map ----------------------------------------------------------------------------
  const dayIndex = Math.max(
    0,
    schedule.days.findIndex((d) => d.date === currentDay),
  )
  const dayPins = currentDay ? (pins.byDay.get(currentDay) ?? []) : []
  const ideasOpen = desktop && tab === 'ideas'
  const mapPins = ideasOpen ? pins.ideaPins : allDays ? [] : dayPins
  const mapOthers = useMemo(() => {
    if (ideasOpen) return []
    const out: MapPoint[] = [...pins.ideaDots]
    for (const [date, list] of pins.byDay) {
      // Finished days stay off the map unless you opened them or are reading them.
      if (doneDays.has(date) && override[date] !== true && date !== currentDay) continue
      if (allDays || date !== currentDay) out.push(...list)
    }
    return out
  }, [pins, currentDay, allDays, doneDays, override, ideasOpen])
  const currentModel: DayModel | undefined = schedule.days[dayIndex]
  const mapTitle = ideasOpen
    ? 'Map of the ideas'
    : currentModel
      ? `Map of ${shortDay(currentModel.date)}, ${dayPins.length} ${dayPins.length === 1 ? 'stop' : 'stops'}`
      : 'Map of the ideas'

  const selTodo = selected ? trip.todos.find((t) => t.todo_id === selected) : undefined
  const selBooking = selected ? trip.bookings.find((b) => b.booking_id === selected) : undefined
  const focusPlace = (selTodo?.place ?? selBooking?.place) || null
  const focusPoint =
    focusPlace && focusPlace.source !== 'manual'
      ? { lat: focusPlace.lat, lng: focusPlace.lng }
      : null

  const onPinClick = useCallback((id: string) => {
    const row = document.getElementById(`row-${id}`)
    if (!row) return
    row.scrollIntoView?.({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' })
    row.classList.add('is-sweep')
    row.querySelector<HTMLElement>('.trip-main, .trip-stubline')?.focus({ preventScroll: true })
    setTimeout(() => row.classList.remove('is-sweep'), 1400)
  }, [])

  const onSpineOver = (e: React.SyntheticEvent) => {
    const li = (e.target as Element).closest?.('[data-entry-id]') as HTMLElement | null
    mapRef.current?.setHot(li?.dataset.entryId ?? null)
  }

  const mapNode = (
    <div className="trip-map">
      <div className="trip-map-bar">
        <span className="trip-pill">
          {ideasOpen || !currentModel ? 'Ideas' : shortDay(currentModel.date)}
        </span>
        {schedule.days.length > 1 && !ideasOpen && (
          <button
            type="button"
            className="trip-pill is-button"
            aria-pressed={allDays}
            onClick={() => setAllDays((a) => !a)}
          >
            {allDays ? 'Follow the day' : 'Show all days'}
          </button>
        )}
      </div>
      <TripMap
        ref={mapRef}
        pins={mapPins}
        others={mapOthers}
        colourVar={ideasOpen ? '--muted' : `--trip-day-${dayIndex % DAY_COLOURS}`}
        nextId={
          !ideasOpen && phase === 'during' && currentDay === today ? (deckTopId ?? null) : null
        }
        title={mapTitle}
        focusId={selected}
        focusPoint={focusPoint}
        focusInset={desktop && selected ? 420 : 0}
        onPinClick={onPinClick}
      />
    </div>
  )

  // ---- derived bits for the spine ------------------------------------------------------
  const nowInfo = useMemo(() => {
    const model = schedule.days.find((d) => d.date === today)
    if (!model || phase !== 'during') return { index: -1, label: '' }
    const timed = model.entries.map((e) => e.startMs)
    if (!timed.some((t) => t !== null)) return { index: -1, label: '' }
    let idx = model.entries.findIndex((e) => e.startMs !== null && e.startMs > nowMs)
    if (idx === -1) {
      for (let i = timed.length - 1; i >= 0; i--)
        if (timed[i] !== null) {
          idx = i + 1
          break
        }
    }
    // 24-hour, like every other time on the page.
    const nd = new Date(nowMs)
    const label = `${String(nd.getHours()).padStart(2, '0')}:${String(nd.getMinutes()).padStart(2, '0')}`
    return { index: idx, label }
  }, [schedule.days, today, phase, nowMs])

  const deletedBy = trip.deleted
    ? (() => {
        const n = memberName(trip.deleted.by, userId, members) || 'Someone'
        return n[0].toUpperCase() + n.slice(1)
      })()
    : ''
  const online = !state.offline && (typeof navigator === 'undefined' || navigator.onLine !== false)

  const bookingStart = (b: Booking) => {
    if (!b.starts_at) return Number.MAX_SAFE_INTEGER
    const [d, t] = b.starts_at.split('T')
    return wallToUtc(d, t || '00:00', b.start_tz || trip.tz)
  }

  // The packing list is the List page's: the menu says how packed it is and goes straight there.
  const packing = usePacking(store.roomId, trip.packing_list_id)
  const toList = (listId: string) =>
    navigate(`/app/lists/${listId}`, {
      state: { from: `trip:${trip.trip_id}`, fromLabel: trip.title },
    })
  const onPacking = async () => {
    if (packing.listId) return toList(packing.listId)
    if (!online || packBusy) return
    setPackBusy(true)
    try {
      const made = await createPackingList(apiKey as string, store.roomId, trip.trip_id)
      await store.flush()
      toList(made.list_id)
    } catch (e) {
      message.error(errorMessage(e, 'Couldn’t make the list. Try again.'))
    } finally {
      setPackBusy(false)
    }
  }
  const packingMenu = packing.listId
    ? { label: `Packing list${packing.text ? ` · ${packing.text}` : ''}`, disabled: false }
    : online
      ? { label: 'Make a packing list', disabled: packBusy }
      : { label: 'Connect to make one', disabled: true }
  // Within three days of leaving, with things still to pack: one quiet line at the top of Plan.
  const toPack =
    phase === 'before' &&
    !!trip.start_date &&
    diffDays(trip.start_date, today) <= 3 &&
    packing.listId &&
    packing.total !== undefined &&
    packing.packed !== undefined &&
    packing.total > 0 &&
    packing.packed < packing.total

  // ---- drag between days ---------------------------------------------------------------
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
      setAnnouncement(`Moved ${moving.title} ${before ? 'before' : 'after'} ${target.title}`)
      return
    }
    const target = over === 'ideas' ? null : over.startsWith('day:') ? over.slice(4) : undefined
    if (target !== undefined) rowActions.move(activeId, target)
  }
  const dragTitle = dragging ? trip.todos.find((t) => t.todo_id === dragging)?.title : ''

  // ---- the one add bar -----------------------------------------------------------------
  const autoTarget =
    tab === 'ideas' || schedule.days.length === 0
      ? 'ideas'
      : phase === 'during'
        ? today
        : (currentDay ?? schedule.days[0].date)
  const target = addTarget === 'auto' ? autoTarget : addTarget
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new tab goes back to the automatic target
  useEffect(() => setAddTarget('auto'), [tab])
  const targetOptions = useMemo(
    () => [
      ...schedule.days.map((d) => ({
        value: d.date,
        label: d.date === today && phase === 'during' ? 'Today' : shortDay(d.date),
      })),
      { value: 'ideas', label: 'Ideas' },
    ],
    [schedule.days, today, phase],
  )
  const targetLabel =
    target === 'ideas'
      ? 'Ideas'
      : target === today && phase === 'during'
        ? 'today'
        : shortDay(target)

  // n or / jumps to the add bar, unless you are typing somewhere.
  useEffect(() => {
    if (!desktop) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== 'n' && e.key !== '/')) return
      const el = document.activeElement as HTMLElement | null
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return
      e.preventDefault()
      document.getElementById('trip-add-input')?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [desktop])

  // ---- panels --------------------------------------------------------------------------
  const closeSelected = () => setSelected(null)
  const detailNode = selTodo ? (
    <TodoDetail
      key={selTodo.todo_id}
      todo={selTodo}
      fresh={selTodo.todo_id === freshId}
      focusTime={focusTime === selTodo.todo_id}
      onCopy={bookingActions.copy}
      bookings={trip.bookings}
      days={moveTargets}
      tripTz={trip.tz}
      bias={bias}
      byline={bylineFor(selTodo, userId, members)}
      locked={locked}
      onPatch={(p) => rowActions.patch(selTodo.todo_id, p)}
      onMove={(d) => rowActions.move(selTodo.todo_id, d)}
      onDelete={() => rowActions.remove(selTodo.todo_id)}
    />
  ) : selBooking ? (
    <BookingDetail
      key={selBooking.booking_id}
      booking={selBooking}
      days={moveTargets}
      focusTime={focusTime === selBooking.booking_id}
      tripTz={trip.tz}
      bias={bias}
      byline={bylineFor(selBooking, userId, members)}
      locked={locked}
      actions={bookingActions}
    />
  ) : null

  const ideasNode = (
    <IdeasPanel
      ideas={schedule.ideas}
      shared={shared}
      moveOpenId={moveOpenId}
      selectedId={selected}
      enteringId={enteringId}
    />
  )
  const bookingsNode = (
    <BookingsPanel
      bookings={trip.bookings}
      nowMs={nowMs}
      startMs={bookingStart}
      onOpen={rowActions.open}
      locked={locked}
    />
  )
  // A new booking starts at the next full hour today during the trip, else on day one at 09:00,
  // so it never lands in the past by default.
  const defaultStart =
    phase === 'during'
      ? `${today}T${String(Math.min(23, new Date(nowMs).getHours() + 1)).padStart(2, '0')}:00`
      : trip.start_date
        ? `${trip.start_date}T09:00`
        : undefined
  const bookingFormNode = bookingDraft ? (
    <BookingEditor
      tripTz={trip.tz}
      bias={bias}
      defaultStart={defaultStart}
      initialTitle={bookingDraft.title}
      onCancel={() => setBookingDraft(null)}
      onSave={(patch) => {
        bookingActions.save(null, patch)
        setBookingDraft(null)
      }}
    />
  ) : null
  const extraNode =
    extra === 'notes' ? (
      <NotesPane
        key={trip.version}
        notes={trip.notes ?? ''}
        locked={locked}
        onSave={(v) => store.updateTrip(trip.trip_id, { notes: v })}
      />
    ) : null

  // One panel at a time: an item's detail wins, then notes or packing, then (desktop) the tab.
  let panel: { key: string; title: string; node: React.ReactNode; close: () => void } | null = null
  if (detailNode) {
    panel = {
      key: `item-${selected}`,
      title: selTodo?.title ?? selBooking?.title ?? 'Details',
      node: detailNode,
      close: closeSelected,
    }
  } else if (bookingFormNode) {
    panel = {
      key: 'booking-new',
      title: 'New booking',
      node: bookingFormNode,
      close: () => setBookingDraft(null),
    }
  } else if (extraNode) {
    panel = {
      key: `extra-${extra}`,
      title: 'Notes',
      node: extraNode,
      close: () => setExtra(null),
    }
  } else if (ideasOpen) {
    panel = { key: 'ideas', title: 'Ideas', node: ideasNode, close: () => setTab('plan') }
  }

  const showSide = desktop
  const showAdd = !locked

  const spine = (
    // One delegated listener lifts the map pin for the row under the pointer.
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only drive the supplementary map
    <div
      className="trip-spine"
      onPointerOver={onSpineOver}
      onFocus={onSpineOver}
      onPointerLeave={() => mapRef.current?.setHot(null)}
    >
      {planDays.map(({ day, closed, deckDay, clash }) => {
        const isToday = day.date === today && phase === 'during'
        return (
          <DaySection
            key={day.date}
            day={day}
            shared={shared}
            moveOpenId={moveOpenId}
            selectedId={selected}
            enteringId={enteringId}
            isToday={isToday}
            heading={deckDay ? 'Later today' : undefined}
            onFold={toggleDay}
            nowMs={day.date < today ? Number.POSITIVE_INFINITY : day.date > today ? 0 : nowMs}
            nowIndex={deckDay ? -1 : nowInfo.index}
            nowLabel={nowInfo.label}
            stay={stay}
            lazy={schedule.days.length > 14}
            today={today}
            celebrating={celebrating.has(day.date)}
            closed={closed}
            clash={clash}
            colourIndex={schedule.days.findIndex((d) => d.date === day.date)}
          />
        )
      })}
      {schedule.outside.length > 0 && (
        <section id="outside-dates" className="trip-day is-open" aria-label="Outside trip dates">
          <header className="trip-day-head">
            <h3 tabIndex={-1}>Outside the trip dates</h3>
          </header>
          {trip.start_date && (
            <p className="trip-muted trip-outside-note">
              These are dated outside {shortRange(trip.start_date, trip.end_date)}.
            </p>
          )}
          <EntryRows
            entries={schedule.outside}
            shared={shared}
            moveOpenId={moveOpenId}
            selectedId={selected}
            enteringId={enteringId}
            nowMs={nowMs}
            showDay
          />
        </section>
      )}
    </div>
  )

  const emptyPlan = trip.todos.length === 0 && trip.bookings.length === 0
  const dayRows: DayRow[] = schedule.days.map((d) => {
    const todos = d.entries.filter((e) => e.kind === 'todo').length
    return {
      value: d.date,
      title: `${d.date === today && phase === 'during' ? 'Today' : shortDay(d.date)}${d.label || d.suggested ? ` · ${d.label || d.suggested}` : ''}`,
      note: doneDays.has(d.date) ? 'All done' : todos === 0 ? 'Nothing planned' : '',
      current: d.date === currentDay,
      flag: d.date >= today && !!d.clash,
    }
  })
  const dayListNode = (
    <DayList
      label="Days"
      rows={dayRows}
      onPick={(date) => {
        setDaysOpen(false)
        goToDay(date)
      }}
    />
  )
  const planNode = (
    <>
      {toPack && packing.listId && (
        <button
          type="button"
          className="trip-packline"
          onClick={() => toList(packing.listId as string)}
        >
          <span>
            Packing · {packing.packed} of {packing.total} packed
          </span>
          <CaretRight aria-hidden />
        </button>
      )}
      {phase === 'during' && tab === 'plan' && deckStops.length > 0 && (
        <NextStopDeck
          stops={deckStops}
          tomorrow={tomorrow}
          locked={locked}
          announce={setAnnouncement}
          onDone={(id) => {
            if (deckStops.find((x) => x.id === id)?.kind === 'booking')
              setDismissed((s) => new Set(s).add(id))
            else rowActions.toggle(id, true)
          }}
          onSeeTomorrow={(d) => goToDay(d)}
          onOpen={rowActions.open}
          onCopy={bookingActions.copy}
        />
      )}
      {doneDays.size > 0 && !emptyPlan && (
        <button
          type="button"
          className="completed-toggle trip-donetoggle"
          aria-expanded={showDone}
          onClick={() => setShowDone((v) => !v)}
        >
          {showDone ? (
            'Hide done days'
          ) : (
            <>
              <Check aria-hidden /> {doneDays.size} {doneDays.size === 1 ? 'day' : 'days'} done
            </>
          )}
        </button>
      )}
      {emptyPlan ? (
        <div className="trip-empty-sheet">
          <h3>Where to first?</h3>
          <p>Add a place or a plan below. You can sort it into days later.</p>
          {!trip.start_date && !locked && (
            <Button shape="round" onClick={() => setWhenOpen(true)}>
              When are you going?
            </Button>
          )}
        </div>
      ) : (
        <>
          {nextUp && (
            <p className="trip-nextup">
              {nextUp.title ? (
                <>
                  Next up: <strong>{nextUp.title}</strong>
                  {nextUp.time ? ` at ${nextUp.time}` : ''}
                </>
              ) : (
                'All done for today'
              )}
            </p>
          )}
          {spine}
        </>
      )}
    </>
  )

  const addLabel =
    tab === 'bookings'
      ? 'Add a booking'
      : target === 'ideas'
        ? 'Add an idea'
        : `Add to ${targetLabel}`
  const addPlaceholder =
    tab === 'bookings'
      ? 'Add a booking'
      : target === 'ideas'
        ? 'Add an idea'
        : `Add to ${targetLabel}`

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="trip-page">
        <div className="trip-shell">
          <div className="trip-col">
            <TopNav back={{ to: '/app/trips', label: roomName }} />
            <div className="paper-stack">
              <TripHeader
                trip={trip}
                today={today}
                offline={state.offline}
                pending={state.pending}
                persistFailed={state.persistFailed}
                deletedBy={deletedBy}
                readOnlyOver={phase === 'after' && !unlocked && !trip.deleted}
                members={members}
                onUnlock={() => setUnlocked(true)}
                onRestore={() => store.restoreTrip(trip.trip_id)}
                onMenu={(k) =>
                  k === 'details' ? goSettings() : k === 'packing' ? onPacking() : setExtra(k)
                }
                packing={packingMenu}
                desktop={desktop}
                daysOpen={daysOpen}
                onDaysOpen={setDaysOpen}
                dayList={dayListNode}
              />
              <Card className="paper-card paper-list">
                <div>
                  <PillNav
                    value={tab}
                    onChange={(k) => setTab(k as TabId)}
                    extra={
                      phone && hasPlaces ? (
                        <Button
                          shape="circle"
                          icon={<MapTrifold />}
                          title="Map"
                          aria-label={`Show map for ${currentModel ? shortDay(currentModel.date) : 'the ideas'}`}
                          onClick={() => setSheetOpen(true)}
                        />
                      ) : undefined
                    }
                    items={[
                      { key: 'plan', label: 'Plan', children: planNode },
                      // Wide screens: the spine stays; the ideas open over the map instead.
                      { key: 'ideas', label: 'Ideas', children: desktop ? planNode : ideasNode },
                      { key: 'bookings', label: 'Bookings', children: bookingsNode },
                    ]}
                  />
                </div>
                {showAdd && (
                  <AddBar
                    inputId="trip-add-input"
                    mode={tab === 'bookings' ? 'booking' : 'todo'}
                    label={addLabel}
                    placeholder={addPlaceholder}
                    bias={bias}
                    targets={targetOptions}
                    target={target}
                    onTarget={setAddTarget}
                    onAdd={(item) => add(target === 'ideas' ? null : target, item)}
                    onLaunch={() => setBookingDraft({ title: '' })}
                    onExpand={(item) => {
                      // One editor for add and edit: create the item, then open it.
                      const id = add(target === 'ideas' ? null : target, item)
                      if (id) {
                        setFreshId(id)
                        ctx.current.openItem(id)
                      }
                    }}
                  />
                )}
              </Card>
            </div>
          </div>
          {showSide && (
            <aside className="trip-side" aria-label="Map">
              {mapNode}
              {desktop && panel && (
                <Panel
                  key={panel.key}
                  desktop
                  bare={panel.key.startsWith('item-')}
                  title={panel.title}
                  onClose={panel.close}
                >
                  {panel.node}
                </Panel>
              )}
            </aside>
          )}
        </div>
        {whenOpen && (
          <WhenSheet
            start={trip.start_date}
            end={trip.end_date}
            onChange={(s, e) => store.updateTrip(trip.trip_id, { start_date: s, end_date: e })}
            onClose={() => setWhenOpen(false)}
          />
        )}
        {phone && sheetOpen && (
          <Sheet
            title={`Map · ${currentModel ? shortDay(currentModel.date) : 'ideas'}`}
            height="62%"
            className="trip-map-drawer"
            onClose={() => setSheetOpen(false)}
          >
            {mapNode}
          </Sheet>
        )}
        {!desktop && daysOpen && (
          <Panel desktop={false} title="Days" onClose={() => setDaysOpen(false)}>
            {dayListNode}
          </Panel>
        )}
        {!desktop && panel && (
          <Panel
            key={panel.key}
            desktop={false}
            bare={panel.key.startsWith('item-')}
            title={panel.title}
            onClose={panel.close}
          >
            {panel.node}
          </Panel>
        )}
        <div className="sr-only" role="status" aria-live="polite">
          {announcement}
        </div>
      </div>
      <DragOverlay>
        {dragTitle ? <div className="trip-drag-chip">{dragTitle}</div> : null}
      </DragOverlay>
    </DndContext>
  )
}

export const TripPage: React.FC = () => {
  const { tripId = '' } = useParams()
  const { store, state, userId, members, loading, roomName, showNextStop } = useTrips()
  const trip = state.trips[tripId]
  useDocumentTitle(trip?.title)
  if (loading || !store || (!trip && !state.synced)) {
    return (
      <div className="container" aria-busy="true">
        <TopNav />
        <div className="route-skeleton">
          <HouseLoader label="Loading the trip" />
        </div>
      </div>
    )
  }
  if (!trip) {
    return (
      <div className="container">
        <TopNav back={{ to: '/app/trips', label: roomName }} />
        <div className="trip-missing">
          <h1>We can’t find this trip</h1>
          <p>It may have been removed, or it hasn’t reached this device yet.</p>
          <Link to="/app/trips" className="trip-link">
            See all trips
          </Link>
        </div>
      </div>
    )
  }
  return (
    <TripScreen
      key={trip.trip_id}
      trip={trip}
      store={store}
      state={state}
      userId={userId}
      members={members}
      roomName={roomName}
      showNextStop={showNextStop}
    />
  )
}

export default TripPage
