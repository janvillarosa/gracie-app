import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
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
import { Button, Modal, message } from 'antd'
import { useAuth } from '@auth/AuthProvider'
import { TopNav } from '@components/TopNav'
import { reorderLock } from '@components/ItemRow'
import { HouseLoader } from '@components/HouseLoader'
import { createPackingList } from '@api/tripEndpoints'
import type { Booking, Trip } from '@api/tripTypes'
import { errorMessage } from '@lib/errors'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import { memberName, useTrips, type Member } from '@lib/trips/hooks'
import type { TripStore } from '@lib/trips/store'
import {
  buildSchedule,
  fullDay,
  longDay,
  localDateKey,
  orderBetween,
  shortDay,
  tonightsStay,
  tripPhase,
  wallToUtc,
  type DayModel,
  type Schedule,
} from '@lib/trips/schedule'
import { BookingsPanel, type BookingActions } from '@components/trips/Bookings'
import { BookingDetail, TodoDetail } from '@components/trips/ItemDetail'
import { DateStrip, MapSheet, useMedia } from '@components/trips/Phone'
import {
  IdeasPanel,
  NotesPane,
  PackingPane,
  Panel,
  TripTabs,
  type TabId,
} from '@components/trips/Panels'
import { AddBar, type QuickAddItem } from '@components/trips/QuickAdd'
import {
  DaySection,
  DoneLine,
  DoneRun,
  EntryRows,
  bylineFor,
  dayDone,
  type Shared,
} from '@components/trips/Spine'
import { TripDetails, TripHeader } from '@components/trips/TripHeader'
import { TripMap, type MapPoint, type TripMapHandle } from '@components/trips/TripMap'
import type { RowActions } from '@components/trips/TodoRow'
import { DAY_COLOURS } from '@components/trips/tripUi'
import '../trips.css'

type Extra = 'notes' | 'packing' | null
const UNDO_MS = 5000
const CELEBRATE_MS = 1100
const MAX_TODOS = 150

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function scrollToEl(el: Element | null, focus = true) {
  if (!el) return
  ;(el as HTMLElement).scrollIntoView?.({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' })
  if (focus) {
    const target = el.querySelector<HTMLElement>('h2[tabindex], button') ?? (el as HTMLElement)
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
    const add = (day: string | null, item: QuickAddItem) => {
      const { trip, store, announce, entered, showDay } = c()
      if (trip.todos.length >= MAX_TODOS) {
        message.error('This trip is full (150 todos). Remove something before adding more.')
        return
      }
      const id = store.createTodo(trip.trip_id, {
        title: item.title,
        day,
        order: maxOrder(trip, day) + 1,
        category: 'other',
        ...(item.start_time ? { start_time: item.start_time } : {}),
        ...(item.place ? { place: item.place } : {}),
      })
      if (day) showDay(day)
      entered(id)
      announce(`Added ${item.title} to ${day ? fullDay(day) : 'Ideas'}`)
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
        store.updateTodo(trip.trip_id, id, { day, order: maxOrder(trip, day) + 1 })
        if (day) c().showDay(day)
        announce(`Moved ${td.title} to ${day ? fullDay(day) : 'Ideas'}`)
      },
      patch: (id, patch) => c().store.updateTodo(c().trip.trip_id, id, patch),
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
        const { trip, schedule, store, announce } = c()
        const td = trip.todos.find((t) => t.todo_id === id)
        if (!td) return
        const list = td.day
          ? (schedule.days
              .find((d) => d.date === td.day)
              ?.entries.flatMap((e) => (e.kind === 'todo' ? [e.todo] : [])) ?? [])
          : schedule.ideas
        const i = list.findIndex((t) => t.todo_id === id)
        const j = i + dir
        if (i < 0) return
        if (j < 0 || j >= list.length) {
          announce(`${td.title} is already ${dir < 0 ? 'first' : 'last'}`)
          return
        }
        const other = list[j]
        const timed = td.start_time || other.start_time
        if (timed && td.start_time !== other.start_time) {
          announce('Rows with a time stay in time order. Change the time to move this one.')
          return
        }
        const order =
          dir < 0
            ? orderBetween(list[j - 1]?.order, other.order)
            : orderBetween(other.order, list[j + 1]?.order)
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
  const numbers = new Map<string, number>()
  const byDay = new Map<string, MapPoint[]>()
  const ideaDots: MapPoint[] = []
  for (const d of schedule.days) {
    const list: MapPoint[] = []
    for (const e of d.entries) {
      const p = e.kind === 'todo' ? e.todo.place : e.booking.place
      if (!p || p.source === 'manual') continue
      const n = list.length + 1
      numbers.set(e.id, n)
      list.push({ id: e.id, lat: p.lat, lng: p.lng, n })
    }
    byDay.set(d.date, list)
  }
  for (const t of schedule.ideas)
    if (t.place && t.place.source !== 'manual')
      ideaDots.push({ id: t.todo_id, lat: t.place.lat, lng: t.place.lng })
  return { numbers, byDay, ideaDots }
}

type Segment =
  | { kind: 'day'; key: string; day: DayModel; index: number; closed: boolean }
  | { kind: 'done'; key: string; days: DayModel[] }

const NO_PINS = new Map<string, number>()

const TripScreen: React.FC<{
  trip: Trip
  store: TripStore
  state: ReturnType<typeof useTrips>['state']
  userId?: string
  members: Member[]
  roomName: string
}> = ({ trip: rawTrip, store, state, userId, members, roomName }) => {
  const { apiKey } = useAuth()
  const [search] = useSearchParams()
  const [tab, setTab] = useState<TabId>('plan')
  const [extra, setExtra] = useState<Extra>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [moveOpenId, setMoveOpen] = useState<string | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [override, setOverride] = useState<Record<string, boolean>>({})
  const [mergeOpen, setMergeOpen] = useState<ReadonlySet<string>>(() => new Set())
  const [celebrating, setCelebrating] = useState<ReadonlySet<string>>(() => new Set())
  const [tabletMap, setTabletMap] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [currentDay, setCurrentDay] = useState<string | null>(null)
  const [allDays, setAllDays] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [addTarget, setAddTarget] = useState<string>('auto')
  const [enteringId, setEnteringId] = useState<string | null>(null)
  const [packBusy, setPackBusy] = useState(false)
  const [packError, setPackError] = useState('')
  const [dragging, setDragging] = useState<string | null>(null)
  const mapRef = useRef<TripMapHandle>(null)
  const headerRef = useRef<HTMLDivElement>(null)

  const desktop = useMedia('(min-width: 1024px)')
  const phone = useMedia('(max-width: 767px)')

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

  const bias = useMemo(() => {
    const p = trip.destination ?? trip.stops?.[0]
    return p && p.source !== 'manual' ? { lat: p.lat, lng: p.lng } : null
  }, [trip.destination, trip.stops])

  // ---- which days are cards, closed cards or slim "done" lines ---------------------------
  const isOpenDay = (d: DayModel) => {
    if (celebrating.has(d.date)) return true
    if (doneDays.has(d.date)) return override[d.date] === true
    if (override[d.date] !== undefined) return override[d.date]
    if (!phone) return true
    return phase === 'during' ? d.date === today : d.date === schedule.days[0]?.date
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: isOpenDay reads exactly these
  const segments = useMemo(() => {
    const out: Segment[] = []
    let run: DayModel[] = []
    const flush = () => {
      if (run.length) out.push({ kind: 'done', key: `done-${run[0].date}`, days: run })
      run = []
    }
    schedule.days.forEach((d, index) => {
      const open = isOpenDay(d)
      if (doneDays.has(d.date) && !open) {
        run.push(d)
        return
      }
      flush()
      out.push({ kind: 'day', key: d.date, day: d, index, closed: !open })
    })
    flush()
    return out
  }, [schedule.days, doneDays, override, celebrating, phone, phase, today])

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

  const mapVisible = desktop || (!phone && tabletMap) || (phone && sheetOpen)
  const pins = useMemo(() => pinsFor(schedule), [schedule])
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
      pins: mapVisible ? pins.numbers : NO_PINS,
      setDayLabel,
    }),
    [
      rowActions,
      moveTargets,
      userId,
      members,
      state.notes,
      locked,
      pins.numbers,
      mapVisible,
      setDayLabel,
    ],
  )

  // ---- the day in view -----------------------------------------------------------------
  const segKey = segments
    .map((s) => `${s.key}:${s.kind === 'day' && s.closed ? 'c' : 'o'}`)
    .join(',')
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

  // The phone's slim title bar appears once the header has scrolled away.
  useEffect(() => {
    const el = headerRef.current
    if (!el || !phone || typeof IntersectionObserver === 'undefined') {
      setScrolled(false)
      return
    }
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [phone])

  // Keep the address bar's ?day= in step with what is being read, without touching history.
  useEffect(() => {
    if (!currentDay) return
    const url = new URL(window.location.href)
    if (url.searchParams.get('day') === currentDay) return
    url.searchParams.set('day', currentDay)
    window.history.replaceState(window.history.state, '', url)
  }, [currentDay])

  // First paint: the deep-linked day, else today at the Now marker, else the top.
  const placed = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once when the days first exist
  useEffect(() => {
    if (placed.current || !schedule.days.length) return
    placed.current = true
    const want = search.get('day')
    requestAnimationFrame(() => {
      if (want && schedule.days.some((d) => d.date === want)) {
        scrollToEl(document.getElementById(`day-${want}`), false)
      } else if (phase === 'during') {
        const now = document.querySelector('.trip-now')
        if (now) (now as HTMLElement).scrollIntoView?.({ block: 'center' })
        else scrollToEl(document.getElementById(`day-${today}`), false)
      }
    })
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
  const goTo = useCallback((id: string) => scrollToEl(document.getElementById(id)), [])
  const goToDay = useCallback(
    (date: string, focus = true) => {
      setCurrentDay(date)
      openDay(date)
      // After the open day has rendered.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => scrollToEl(document.getElementById(`day-${date}`), focus)),
      )
    },
    [openDay],
  )
  const onGap = useCallback(
    (target: string) => {
      if (target.startsWith('day-')) goToDay(target.slice(4))
      else goTo(target)
    },
    [goTo, goToDay],
  )

  // ---- map ----------------------------------------------------------------------------
  const dayIndex = Math.max(
    0,
    schedule.days.findIndex((d) => d.date === currentDay),
  )
  const dayPins = currentDay ? (pins.byDay.get(currentDay) ?? []) : []
  const mapPins = allDays ? [] : dayPins
  const mapOthers = useMemo(() => {
    const out: MapPoint[] = [...pins.ideaDots]
    for (const [date, list] of pins.byDay) {
      // Finished days stay off the map unless you opened them or are reading them.
      if (doneDays.has(date) && override[date] !== true && date !== currentDay) continue
      if (allDays || date !== currentDay) out.push(...list.map((p) => ({ ...p, n: undefined })))
    }
    return out
  }, [pins, currentDay, allDays, doneDays, override])
  const currentModel: DayModel | undefined = schedule.days[dayIndex]
  const mapTitle = currentModel
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
        <span className="trip-pill">{mapTitle.replace('Map of ', '')}</span>
        {schedule.days.length > 1 && (
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
        colourVar={`--trip-day-${dayIndex % DAY_COLOURS}`}
        title={mapTitle}
        focusId={selected}
        focusPoint={focusPoint}
        onPinClick={onPinClick}
      />
    </div>
  )

  // ---- derived bits for the spine ------------------------------------------------------
  const stay = phase === 'during' ? tonightsStay(trip, today) : undefined
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
    const label = new Date(nowMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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

  const onCreatePacking = async () => {
    setPackBusy(true)
    setPackError('')
    try {
      await createPackingList(apiKey as string, store.roomId, trip.trip_id)
      await store.flush()
    } catch (e) {
      setPackError(errorMessage(e, 'Couldn’t create the list. Try again.'))
    } finally {
      setPackBusy(false)
    }
  }

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
    const target = over === 'ideas' ? null : over.startsWith('day:') ? over.slice(4) : undefined
    if (target !== undefined) rowActions.move(String(e.active.id), target)
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
      tripTz={trip.tz}
      bias={bias}
      firstDay={trip.start_date ?? undefined}
      nowMs={nowMs}
      actions={bookingActions}
      startMs={bookingStart}
      onOpen={rowActions.open}
      locked={locked}
    />
  )
  const extraNode =
    extra === 'notes' ? (
      <NotesPane
        key={trip.version}
        notes={trip.notes ?? ''}
        locked={locked}
        onSave={(v) => store.updateTrip(trip.trip_id, { notes: v })}
      />
    ) : extra === 'packing' ? (
      <PackingPane
        listId={trip.packing_list_id}
        online={online}
        busy={packBusy}
        error={packError}
        onCreate={onCreatePacking}
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
  } else if (extraNode) {
    panel = {
      key: `extra-${extra}`,
      title: extra === 'notes' ? 'Notes' : 'Packing',
      node: extraNode,
      close: () => setExtra(null),
    }
  } else if (desktop && tab === 'ideas') {
    panel = {
      key: 'tab-ideas',
      title: `Ideas (${schedule.ideas.length})`,
      node: ideasNode,
      close: () => setTab('plan'),
    }
  } else if (desktop && tab === 'bookings') {
    panel = {
      key: 'tab-bookings',
      title: `Bookings (${trip.bookings.length})`,
      node: bookingsNode,
      close: () => setTab('plan'),
    }
  }

  const showSide = desktop || (!phone && tabletMap)
  const showAdd = !locked && (desktop || tab !== 'bookings')

  const spine = (
    // One delegated listener lifts the map pin for the row under the pointer.
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only drive the supplementary map
    <div
      className="trip-spine"
      onPointerOver={onSpineOver}
      onFocus={onSpineOver}
      onPointerLeave={() => mapRef.current?.setHot(null)}
    >
      {schedule.days.length === 0 && (
        <p className="trip-empty-text">
          {trip.todos.length || trip.bookings.length
            ? 'Add dates to place these on days.'
            : 'No dates yet. Add dates in the trip details, or collect ideas first.'}
        </p>
      )}
      {segments.map((s) => {
        if (s.kind === 'done') {
          return s.days.length === 1 ? (
            <DoneLine key={s.key} day={s.days[0]} onOpen={openDay} />
          ) : (
            <DoneRun
              key={s.key}
              days={s.days}
              open={mergeOpen.has(s.key)}
              onToggle={() =>
                setMergeOpen((m) => {
                  const n = new Set(m)
                  if (n.has(s.key)) n.delete(s.key)
                  else n.add(s.key)
                  return n
                })
              }
              onOpenDay={openDay}
            />
          )
        }
        const isToday = s.day.date === today && phase === 'during'
        return (
          <DaySection
            key={s.key}
            day={s.day}
            index={s.index}
            shared={shared}
            moveOpenId={moveOpenId}
            selectedId={selected}
            enteringId={enteringId}
            isToday={isToday}
            onFold={toggleDay}
            nowMs={s.day.date < today ? Number.POSITIVE_INFINITY : s.day.date > today ? 0 : nowMs}
            nowIndex={nowInfo.index}
            nowLabel={nowInfo.label}
            stay={stay}
            lazy={schedule.days.length > 14}
            today={today}
            celebrating={celebrating.has(s.day.date)}
            closed={s.closed}
          />
        )
      })}
      {schedule.outside.length > 0 && (
        <section
          id="outside-dates"
          className="trip-day is-open trip-outside"
          aria-label="Outside trip dates"
        >
          <header className="trip-day-head">
            <div className="trip-day-title">
              <h2 tabIndex={-1}>Outside trip dates</h2>
            </div>
            <p className="trip-day-sum">{schedule.outside.length} items</p>
          </header>
          <div className="trip-day-body">
            <EntryRows
              entries={schedule.outside}
              shared={shared}
              moveOpenId={moveOpenId}
              selectedId={selected}
              enteringId={enteringId}
              nowMs={nowMs}
              showDay
            />
          </div>
        </section>
      )}
    </div>
  )

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="trip-page">
        <div className="trip-shell">
          <div className="trip-col">
            <TopNav back={{ to: '/app', label: roomName }} />
            {phone && (
              <div className={scrolled ? 'trip-phonebar is-scrolled' : 'trip-phonebar'}>
                <p className="trip-slim" aria-hidden={!scrolled}>
                  {trip.title}
                </p>
                {schedule.days.length > 1 && (
                  <DateStrip
                    days={schedule.days}
                    current={currentDay}
                    today={today}
                    done={doneDays}
                    onPick={(d) => goToDay(d, false)}
                  />
                )}
              </div>
            )}
            <div ref={headerRef}>
              <TripHeader
                trip={trip}
                today={today}
                gaps={schedule.gaps}
                offline={state.offline}
                pending={state.pending}
                deletedBy={deletedBy}
                readOnlyOver={phase === 'after' && !unlocked && !trip.deleted}
                members={members}
                onUnlock={() => setUnlocked(true)}
                onRestore={() => store.restoreTrip(trip.trip_id)}
                onGap={onGap}
                onAddDates={() => setDetailsOpen(true)}
              />
            </div>
            <TripTabs
              value={tab}
              onChange={setTab}
              ideas={schedule.ideas.length}
              bookings={trip.bookings.length}
              onMore={(k) => (k === 'details' ? setDetailsOpen(true) : setExtra(k))}
            />
            {!desktop && !phone && (
              <Button size="small" aria-pressed={tabletMap} onClick={() => setTabletMap((m) => !m)}>
                {tabletMap ? 'Hide the map' : 'Show the map'}
              </Button>
            )}
            <div
              role="tabpanel"
              id={`panel-${desktop ? 'plan' : tab}`}
              aria-labelledby={`tab-${desktop ? 'plan' : tab}`}
            >
              {desktop || tab === 'plan' ? spine : tab === 'ideas' ? ideasNode : bookingsNode}
            </div>
            {showAdd && (
              <AddBar
                inputId="trip-add-input"
                label={target === 'ideas' ? 'Add an idea' : `Add to ${targetLabel}`}
                bias={bias}
                targets={targetOptions}
                target={target}
                onTarget={setAddTarget}
                onAdd={(item) => add(target === 'ideas' ? null : target, item)}
              />
            )}
            {phone && <div className="trip-footer-space" aria-hidden />}
          </div>
          {showSide && (
            <aside className="trip-side" aria-label="Map">
              {mapNode}
              {desktop && panel && (
                <Panel key={panel.key} desktop title={panel.title} onClose={panel.close}>
                  {panel.node}
                </Panel>
              )}
            </aside>
          )}
        </div>
        {phone && (
          <div className="trip-bottom">
            <MapSheet
              title={`Map · ${currentModel ? shortDay(currentModel.date) : 'ideas'}`}
              open={sheetOpen}
              onToggle={() => setSheetOpen((o) => !o)}
            >
              {mapNode}
            </MapSheet>
          </div>
        )}
        {!desktop && panel && (
          <Panel key={panel.key} desktop={false} title={panel.title} onClose={panel.close}>
            {panel.node}
          </Panel>
        )}
        {detailsOpen && (
          <Modal
            open
            title="Trip details"
            footer={null}
            onCancel={() => setDetailsOpen(false)}
            destroyOnClose
          >
            <TripDetails
              trip={trip}
              onPatch={(p) => store.updateTrip(trip.trip_id, p)}
              onDelete={() => {
                store.deleteTrip(trip.trip_id)
                setDetailsOpen(false)
              }}
              onClose={() => setDetailsOpen(false)}
            />
          </Modal>
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
  const { store, state, userId, members, loading, roomName } = useTrips()
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
        <TopNav back={{ to: '/app', label: roomName }} />
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
    />
  )
}

export default TripPage
