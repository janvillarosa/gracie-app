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
import { Card, message } from 'antd'
import { CaretRight, Check, MapTrifold } from '@phosphor-icons/react'
import { useAuth } from '@auth/AuthProvider'
import { TopNav } from '@components/TopNav'
import { reorderLock } from '@components/ItemRow'
import { HouseLoader } from '@components/HouseLoader'
import { createPackingList } from '@api/tripEndpoints'
import { usePacking } from '@lib/trips/usePacking'
import { LIMITS } from '@lib/trips/limits'
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
import { BookingsPanel, type BookingActions } from '@components/trips/Bookings'
import { BookingSheet } from '@components/trips/BookingSheet'
import { TodoSheet } from '@components/trips/TodoSheet'
import { DayPick } from '@components/trips/pickers'
import { IdeasPanel } from '@components/trips/IdeasPanel'
import type { TabId } from '@components/trips/tabs'
import { NotePick } from '@components/trips/pickers'
import { LIMITS as TRIP_LIMITS } from '@lib/trips/limits'
import { Button, DetailGroup, NavRow, SectionLabel, Sheet, SheetIdentity } from '@components/ui'
import { NextStopDeck, type Stop, type Tomorrow } from '@components/trips/NextStop'
import { useMedia } from '@components/trips/Phone'
import { AddBar, type QuickAddItem } from '@components/trips/QuickAdd'
import {
  DaySection,
  EntryRows,
  bylineFor,
  dayDone,
  tripNoteList,
  type Shared,
} from '@components/trips/Spine'
import { TripHeader } from '@components/trips/TripHeader'
import { TripMap, type TripMapHandle } from '@components/trips/TripMap'
import { MapScreen } from '@components/trips/MapScreen'
import { useBrowserOnline, useMapFollow, useMapOk } from '@components/trips/useTripMap'
import { hasPin } from '@lib/trips/places'
import { buildScene, hasMapPlaces, tripPoints, type MapPreview } from '@lib/trips/mapScene'
import type { RowActions } from '@components/trips/TodoRow'
import { DAY_COLOURS } from '@components/trips/tripUi'
import { PillNav } from '@components/PillNav'
import { ReadyToGo } from '@components/trips/ReadyToGo'
import { DateRail } from '@components/trips/DateRail'
import { readiness, type CheckLine } from '@lib/trips/readiness'
import { reduced, scrollToEl } from './trip/scroll'
import { listFor, useScreenActions, type Ctx } from './trip/useScreenActions'
import { useDayFolding } from './trip/useDayFolding'
import { useDayInView } from './trip/useDayInView'
import { useAddBarShortcut } from './trip/useAddBarShortcut'
import { useInspectorKeys } from './trip/useInspectorKeys'
import { panes, useDeskScroll } from './trip/useDeskScroll'
import { useDeck } from './trip/useDeck'
import { useItemSheet } from './trip/useItemSheet'
import { usePackingLine } from './trip/usePackingLine'
import { useTripDrag } from './trip/useTripDrag'
import '../trips.css'

type Extra = 'notes' | null

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
  const [rawTab, setTab] = useState<TabId>('plan')
  const [extra, setExtra] = useState<Extra>(null)
  const navigate = useNavigate()
  const goSettings = () => navigate(`/app/trips/${rawTrip.trip_id}/settings`)
  const [selected, setSelected] = useState<string | null>(null)
  const [moveOpenId, setMoveOpen] = useState<string | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [daysOpen, setDaysOpen] = useState(false)
  const [whenOpen, setWhenOpen] = useState(false)
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  const [screenOpen, setScreenOpen] = useState(false)
  const mapPill = useRef<HTMLButtonElement>(null)
  const mapFollow = useMapFollow()
  const [barPreview, setBarPreview] = useState<MapPreview | null>(null)
  const [allDays, setAllDays] = useState(false)
  const [announcement, setAnnouncementRaw] = useState('')
  // The same message twice in a row still reaches a screen reader (the text changes invisibly).
  const setAnnouncement = useCallback(
    (t: string) => setAnnouncementRaw((p) => (p === t ? `${t}\u200b` : t)),
    [],
  )
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [addTarget, setAddTarget] = useState<string>('auto')
  const [enteringId, setEnteringId] = useState<string | null>(null)
  const [freshId, setFreshId] = useState<string | null>(null)
  // The item whose time field opens ready (from an overlap line).
  const [focusTime, setFocusTime] = useState<string | null>(null)
  const mapRef = useRef<TripMapHandle>(null)
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sweepTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (enterTimer.current) clearTimeout(enterTimer.current)
      if (sweepTimer.current) clearTimeout(sweepTimer.current)
    },
    [],
  )

  const desktop = useMedia('(min-width: 1024px)')
  // Tablets use the phone layout: one column, the map in a sheet.
  const phone = useMedia('(max-width: 1023px)')
  // 1200px and wider: Ideas, Days and the Map side by side. 1024-1199: Ideas and Days, and the
  // map opens over them from the Map pill. Either way Ideas is a column, not a tab.
  const wide = useMedia('(min-width: 1200px)')
  // The desk's composer floats over the Days column: it takes that column's left edge and width.
  const daysCol = useRef<HTMLDivElement>(null)
  const [composerBox, setComposerBox] = useState<{ left: number; width: number } | null>(null)
  useEffect(() => {
    const el = daysCol.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setComposerBox({ left: r.left + 24, width: Math.max(280, r.width - 48) })
    }
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [desktop])
  const [mapOver, setMapOver] = useState(false)
  const tab: TabId = desktop && rawTab === 'ideas' ? 'plan' : rawTab

  // Rows waiting behind an Undo are hidden before the delete is sent.
  const trip = useMemo(
    () =>
      hidden.size
        ? { ...rawTrip, todos: rawTrip.todos.filter((t) => !hidden.has(t.todo_id)) }
        : rawTrip,
    [rawTrip, hidden],
  )
  const schedule = useMemo(() => buildSchedule(trip, nowMs), [trip, nowMs])
  const today = localDateKey(new Date(nowMs))
  const browserOnline = useBrowserOnline()
  const online = !state.offline && browserOnline
  // The map is shown only while online (it needs tiles), hiding a few seconds after a drop.
  const mapOk = useMapOk(online)
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
      if (enterTimer.current) clearTimeout(enterTimer.current)
      enterTimer.current = setTimeout(() => setEnteringId((e) => (e === id ? null : e)), 1800)
    },
    showDay: (date) => showDayOpen(date),
  }
  const { add, rowActions, bookingActions, setDayLabel } = useScreenActions(ctx)
  // ---- drag between days ---------------------------------------------------------------
  // The drag reads the day folding and the day in view, which are set up further down.
  const dragBridge = useRef<{
    isClosed: (date: string) => boolean
    openDay: (date: string) => void
    foldDay: (date: string) => void
    currentDay: string | null
    setCurrentDay: (date: string | null) => void
  }>({
    isClosed: () => false,
    openDay: () => {},
    foldDay: () => {},
    currentDay: null,
    setCurrentDay: () => {},
  })
  const { dragging, drop, sensors, onDragStart, onDragOver, onDragEnd, onDragCancel, dragTitle } =
    useTripDrag({
      trip,
      store,
      ctx,
      announce: setAnnouncement,
      isClosed: (d) => dragBridge.current.isClosed(d),
      openDay: (d) => dragBridge.current.openDay(d),
      foldDay: (d) => dragBridge.current.foldDay(d),
      currentDay: dragBridge.current.currentDay,
      setCurrentDay: (d) => dragBridge.current.setCurrentDay(d),
      setPreview: (p) =>
        setBarPreview(hasPin(p) ? { lat: p.lat, lng: p.lng, label: p.name } : null),
      scrollers: desktop ? panes : undefined,
    })

  const draftCount = useRef(0)
  const [bookingDraft, setBookingDraft] = useState<{
    title: string
    n: number
    start?: string
  } | null>(null)

  const bias = useMemo(() => {
    const p = trip.destination ?? trip.stops?.[0]
    return hasPin(p) ? { lat: p.lat, lng: p.lng } : null
  }, [trip.destination, trip.stops])
  // Where the map looks when the day in view has nothing placed: the trip's places, else where.
  const mapHome = useMemo(() => tripPoints(trip, bias), [trip, bias])

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
  const {
    override,
    celebrating,
    isOpenDay,
    toggleDay,
    openDay,
    foldDay,
    showDay: showDayOpen,
  } = useDayFolding({
    days: schedule.days,
    doneDays,
    phone,
    phase,
    today,
    announce: setAnnouncement,
    onToggle: mapFollow.resume,
  })
  // The next-stop deck, the plain "Next up" line, and tomorrow's first stop.
  const { deckStops, deckTopId, nextUp, tomorrow } = useDeck({
    trip,
    schedule,
    phase,
    today,
    nowMs,
    showNextStop,
    dismissed,
  })

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
      isOpenDay,
      phase,
      today,
      nextBookingId,
      deckStops.length,
      deckTopId,
      dismissed,
      stay,
    ],
  )
  // The map control appears once there is something to show on it.
  const hasPlaces = hasMapPlaces(trip)
  // Wide and online: the map is a pane beside the plan; item panels dock over it. Otherwise
  // (phone, or no connection) panels are bottom sheets.
  // The map column exists on wide screens, online, once there is a place to show.
  const mapCol = wide && mapOk && hasPlaces
  // Item panels dock into the right column on wide screens (over the map, or alone when there is
  // no map); at 1024-1199 they overlay. Below that they are sheets.
  const docked = wide
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
      now: nowMs,
      lazyDnd: trip.todos.length > 40,
      dragging: dragging !== null,
      drop,
      onClash: (id: string) => {
        ctx.current.openItem(id)
        setFocusTime(id)
      },
    }),
    [
      rowActions,
      moveTargets,
      userId,
      members,
      state.notes,
      locked,
      setDayLabel,
      nowMs,
      trip.todos.length,
      dragging,
      drop,
    ],
  )

  // ---- the day in view -----------------------------------------------------------------
  const segKey = planDays.map((p) => `${p.day.date}:${p.closed ? 'c' : 'o'}`).join(',')
  const { currentDay, setCurrentDay } = useDayInView({
    days: schedule.days,
    segKey,
    phase,
    today,
    wantedDay: search.get('day'),
    getScroller: desktop ? () => daysCol.current : undefined,
  })
  dragBridge.current = {
    isClosed: (date) => {
      const d = schedule.days.find((x) => x.date === date)
      return d ? !isOpenDay(d) : false
    },
    openDay,
    foldDay,
    currentDay,
    setCurrentDay,
  }
  const goToDay = useCallback(
    (date: string, focus = true) => {
      // Picking a day is an explicit camera action: the map fits it (desk) or follows it.
      if (desktop) mapFollow.fit()
      else mapFollow.resume()
      setCurrentDay(date)
      if (doneDays.has(date)) setShowDone(true)
      openDay(date)
      // After the open day has rendered.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => scrollToEl(document.getElementById(`day-${date}`), focus)),
      )
    },
    [openDay, doneDays, desktop],
  )
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

  // ---- map ----------------------------------------------------------------------------
  const dayIndex = Math.max(
    0,
    schedule.days.findIndex((d) => d.date === currentDay),
  )
  const ideasOpen = docked && tab === 'ideas'
  const currentModel: DayModel | undefined = schedule.days[dayIndex]
  // The next stop today: the first open todo, or a booking that has not finished.
  const nextStopId = useMemo(() => {
    if (phase !== 'during') return null
    const model = schedule.days.find((d) => d.date === today)
    const e = model?.entries.find((x) =>
      x.kind === 'todo'
        ? !x.todo.done
        : (x.endMs ?? x.startMs ?? Number.POSITIVE_INFINITY) >= nowMs,
    )
    return e?.id ?? null
  }, [schedule.days, phase, today, nowMs])
  // On a desk the map holds every day and only changes emphasis as you scroll (the camera never
  // follows), so finished days stay on it; elsewhere they drop off unless opened.
  const skipDays = useMemo(
    () =>
      desktop
        ? new Set<string>()
        : new Set([...doneDays].filter((d) => override[d] !== true && d !== currentDay)),
    [desktop, doneDays, override, currentDay],
  )
  const sceneFor = useCallback(
    (mode: 'day' | 'all' | 'ideas', day: string | null, sel: string | null) =>
      buildScene({
        mode,
        schedule,
        day,
        skipDays,
        nextId: day === today || mode !== 'day' ? nextStopId : null,
        selectedId: sel,
        colourIndex: Math.max(
          0,
          schedule.days.findIndex((d) => d.date === day),
        ),
      }),
    [schedule, skipDays, today, nextStopId],
  )
  // Desk: one scene of every day with a route per day; the day in view is in colour and the
  // others dimmed ("Show all days" dims nothing). Elsewhere: the day, or every day, or the ideas.
  const deskScene = desktop && !ideasOpen
  const mapMode = ideasOpen ? 'ideas' : deskScene || allDays ? 'all' : 'day'
  const dayIdx = schedule.days.findIndex((d) => d.date === currentDay)
  const emphasisDay = deskScene && !allDays && dayIdx >= 0 ? dayIdx : null
  const scene = useMemo(() => {
    const s = sceneFor(mapMode, currentDay, selected)
    return deskScene
      ? {
          ...s,
          route: true,
          emphasisDay,
          ...(emphasisDay !== null && currentModel
            ? { emphasisLabel: shortDay(currentModel.date) }
            : {}),
        }
      : s
  }, [sceneFor, mapMode, currentDay, selected, deskScene, emphasisDay, currentModel])
  const dayStopCount =
    deskScene && emphasisDay !== null
      ? scene.stops.filter((s) => s.dayIndex === emphasisDay).length
      : scene.stops.length
  const mapTitle = ideasOpen
    ? 'Map of the ideas'
    : currentModel
      ? `Map of ${shortDay(currentModel.date)}, ${dayStopCount} ${dayStopCount === 1 ? 'stop' : 'stops'}`
      : 'Map of the ideas'

  const selTodo = selected ? trip.todos.find((t) => t.todo_id === selected) : undefined
  const selBooking = selected ? trip.bookings.find((b) => b.booking_id === selected) : undefined
  const focusPlace = (selTodo?.place ?? selBooking?.place) || null
  const focusPoint = hasPin(focusPlace) ? { lat: focusPlace.lat, lng: focusPlace.lng } : null

  // A pill selects its item (brief 6v). The Days pane scrolls to the row only if it is off
  // screen, the row gets the highlighter sweep, and on the desk the item opens in the inspector.
  // The map's camera does not move.
  const revealRow = useCallback((id: string, block: ScrollLogicalPosition, focus: boolean) => {
    const row = document.getElementById(`row-${id}`)
    if (!row) return
    row.scrollIntoView?.({ block, behavior: reduced() ? 'auto' : 'smooth' })
    row.classList.add('is-sweep')
    if (focus)
      row.querySelector<HTMLElement>('.trip-main, .trip-stubline')?.focus({ preventScroll: true })
    if (sweepTimer.current) clearTimeout(sweepTimer.current)
    sweepTimer.current = setTimeout(() => row.classList.remove('is-sweep'), 1400)
  }, [])
  const onPinClick = useCallback(
    (id: string) => {
      revealRow(id, 'nearest', false)
      ctx.current.openItem(id)
    },
    [revealRow],
  )
  // The phone's map view closes first, then the list scrolls to the row and lights it.
  const onPickRow = useCallback(
    (id: string) => {
      const day =
        trip.todos.find((t) => t.todo_id === id)?.day ??
        trip.bookings.find((b) => b.booking_id === id)?.starts_at?.slice(0, 10)
      if (day) {
        setCurrentDay(day)
        openDay(day)
      }
      let tries = 0
      const go = () => {
        if (document.querySelector('.map-screen') && tries++ < 60) {
          requestAnimationFrame(go)
          return
        }
        requestAnimationFrame(() => revealRow(id, 'center', true))
      }
      requestAnimationFrame(go)
    },
    [trip.todos, trip.bookings, setCurrentDay, openDay, revealRow],
  )
  // A pill under the pointer lights its row (visual only).
  const linked = useRef<HTMLElement | null>(null)
  const onPinHover = useCallback((id: string | null) => {
    linked.current?.classList.remove('is-pin-linked')
    linked.current = id ? document.getElementById(`row-${id}`) : null
    linked.current?.classList.add('is-pin-linked')
  }, [])

  const onSpineOver = (e: React.SyntheticEvent) => {
    const li = (e.target as Element).closest?.('[data-entry-id]') as HTMLElement | null
    mapRef.current?.setHot(li?.dataset.entryId ?? null)
  }

  const preview: MapPreview | null = barPreview

  const mapNode = (
    <div className="trip-map">
      <div className="trip-map-bar">
        <span className="trip-pill">
          {ideasOpen || !currentModel ? 'Ideas' : shortDay(currentModel.date)}
        </span>
        <span className="trip-map-keys">
          {schedule.days.length > 1 && !ideasOpen && (
            <button
              type="button"
              className="trip-pill is-button"
              aria-pressed={allDays}
              onClick={() => {
                setAllDays((a) => !a)
                // Showing every day (or going back to the day) fits the map: an explicit action.
                if (desktop) mapFollow.fit()
              }}
            >
              {allDays ? 'Follow the day' : 'Show all days'}
            </button>
          )}
          <button
            type="button"
            className={mapFollow.following ? 'trip-pill is-button' : 'trip-pill is-button is-key'}
            onClick={mapFollow.fit}
          >
            Fit day
          </button>
        </span>
      </div>
      <TripMap
        ref={mapRef}
        scene={scene}
        interactive
        labelLimit={22}
        nextPrefix
        preview={preview}
        following={mapFollow.following}
        fitToken={mapFollow.fitToken}
        title={mapTitle}
        focusPoint={focusPoint}
        focusInset={0}
        home={mapHome}
        onPinClick={onPinClick}
        onPinHover={onPinHover}
        onShowDay={mapFollow.fit}
        onUserMove={mapFollow.pause}
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

  const { packing, toList, onPacking, packingMenu, toPack } = usePackingLine({
    trip,
    store,
    apiKey,
    online,
    phase,
    today,
  })

  useAddBarShortcut(desktop)
  // J/K and Alt+Up/Down: the next or previous item in the inspector.
  useInspectorKeys(desktop, selected, (id, position, total) => {
    ctx.current.openItem(id)
    const title =
      trip.todos.find((t) => t.todo_id === id)?.title ??
      trip.bookings.find((b) => b.booking_id === id)?.title ??
      ''
    setAnnouncement(`${title}, ${position} of ${total}`)
  })
  // Opening, switching or closing the inspector never moves the Days pane. Only a selected row
  // that is hidden (under the sticky header or the composer) is brought just into view.
  useEffect(() => {
    if (!desktop || !selected) return
    const row = document.getElementById(`row-${selected}`)
    const pane = daysCol.current
    if (!row || !pane || !pane.contains(row)) return
    const r = row.getBoundingClientRect()
    const p = pane.getBoundingClientRect()
    const composer = document.querySelector('.trip-composer')?.getBoundingClientRect()
    const bottom = composer && composer.top > p.top ? Math.min(p.bottom, composer.top) : p.bottom
    if (r.top < p.top + 44 || r.bottom > bottom) row.scrollIntoView?.({ block: 'nearest' })
  }, [selected, desktop])
  // The desk is an app shell: the window itself does not scroll, each pane does.
  useEffect(() => {
    if (!desktop) return
    document.documentElement.classList.add('trip-desk-shell')
    return () => document.documentElement.classList.remove('trip-desk-shell')
  }, [desktop])
  useDeskScroll(
    trip.trip_id,
    desktop,
    schedule.days.length > 0 || schedule.ideas.length > 0,
    !!search.get('day'),
  )

  // ---- sheets --------------------------------------------------------------------------
  // One at a time: an item, a new booking, the notes, or (wide screens) the ideas. Docked over
  // the map when there is a map, otherwise a sheet.
  const bookingsNode = (
    <BookingsPanel
      bookings={trip.bookings}
      nowMs={nowMs}
      tripTz={trip.tz}
      onOpen={rowActions.open}
    />
  )
  const ideasNode = (
    <IdeasPanel
      ideas={schedule.ideas}
      shared={shared}
      moveOpenId={moveOpenId}
      selectedId={selected}
      enteringId={enteringId}
    />
  )
  const shownSheet = useItemSheet({
    trip,
    state,
    store,
    userId,
    members,
    locked,
    phase,
    today,
    nowMs,
    docked: desktop,
    ideasOpen,
    ideasNode,
    selTodo,
    selBooking,
    bookingDraft,
    setBookingDraft,
    extra,
    setExtra,
    setSelected,
    setTab,
    freshId,
    focusTime,
    rowActions,
    bookingActions,
    moveTargets,
    bias,
  })
  const showSide = docked
  // The right column exists while the map has something to show, or an item is open in it.
  const inspectorOpen = !!(selTodo || selBooking || bookingDraft || extra === 'notes')
  const asideOpen = mapCol || (wide && inspectorOpen)
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
        <section
          id="outside-dates"
          // Same row grid as a day: a time column when any of its lines has a time, else the
          // times would sit on top of the titles.
          className={
            schedule.outside.some(
              (e) =>
                e.startMs !== null ||
                (e.kind === 'todo' ? !!e.todo.start_time : !!e.booking.starts_at?.includes('T')),
            )
              ? 'trip-day has-time is-open'
              : 'trip-day is-open'
          }
          aria-label="Outside trip dates"
        >
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
  // Before the trip, on a desk: what is still missing, instead of the Next stop card.
  const readyLines = useMemo(
    () => (phase === 'before' && desktop ? readiness(trip, schedule.days, packing) : []),
    [phase, desktop, trip, schedule.days, packing],
  )
  const fixReady = (line: CheckLine) => {
    switch (line.fix?.action) {
      case 'add-travel':
        return setBookingDraft({ title: '', n: ++draftCount.current })
      case 'add-stay':
        return setBookingDraft({
          title: 'Stay',
          n: ++draftCount.current,
          start: line.date ? `${line.date}T15:00` : undefined,
        })
      case 'show-empty-day':
        return line.date ? goToDay(line.date) : undefined
      case 'open-list':
        return packing.listId ? toList(packing.listId) : undefined
      case 'make-list':
        return void onPacking()
    }
  }
  // No dates yet: ideas live under Ideas, and Plan keeps its first-step prompts.
  const noDays = schedule.days.length === 0 && schedule.outside.length === 0
  const dayTargets = schedule.days.map((d) => ({
    value: d.date as string | null,
    label: fullDay(d.date),
  }))
  const dayNotes = Object.fromEntries(
    schedule.days.map((d) => {
      const todos = d.entries.filter((e) => e.kind === 'todo').length
      const label = d.label || d.suggested
      const flagged = d.date >= today && !!d.clash
      return [
        d.date,
        [
          d.date === today && phase === 'during' ? 'Today' : '',
          label,
          flagged
            ? 'Two things overlap'
            : doneDays.has(d.date)
              ? 'All done'
              : todos === 0
                ? 'Nothing planned'
                : '',
        ]
          .filter(Boolean)
          .join(' · '),
      ]
    }),
  )
  const dayListNode = (
    <DayPick
      days={dayTargets}
      value={currentDay}
      notes={dayNotes}
      onPick={(date) => {
        setDaysOpen(false)
        if (date) goToDay(date)
      }}
    />
  )
  const deckNode = (flat: boolean) => (
    <NextStopDeck
      flat={flat}
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
  )
  const planNode = (
    <>
      {toPack && packing.listId && !desktop && (
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
      {phase === 'during' && tab === 'plan' && deckStops.length > 0 && !desktop && deckNode(false)}
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
      {noDays || (emptyPlan && !desktop) ? (
        <div className="trip-empty-sheet">
          <h3>Where to first?</h3>
          <p>Add a place or a plan below. You can sort it into days later.</p>
          {!trip.start_date && !locked && (
            <Button kind="quiet" onClick={() => setWhenOpen(true)}>
              When are you going?
            </Button>
          )}
          {schedule.ideas.length > 0 && !desktop && (
            <DetailGroup label="Ideas">
              <NavRow
                label={`${schedule.ideas.length} ${schedule.ideas.length === 1 ? 'idea' : 'ideas'}`}
                onClick={() => setTab('ideas')}
              />
            </DetailGroup>
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
      {desktop && !hasPlaces && !noDays && (
        <p className="trip-map-note">Places you add show up on a map.</p>
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
      : desktop
        ? 'Add a place, plan or idea'
        : target === 'ideas'
          ? 'Add an idea'
          : `Add to ${targetLabel}`

  const readyNode =
    readyLines.length > 0 && tab === 'plan' ? (
      <ReadyToGo lines={readyLines} locked={locked} onFix={fixReady} />
    ) : null
  // The sheet's band on a desk: Ready to go? before the trip, the Next stop card during it.
  const bandNode = !desktop
    ? null
    : phase === 'before'
      ? readyNode
      : phase === 'during' && tab === 'plan' && deckStops.length > 0
        ? deckNode(true)
        : null
  const headerNode = (
    <TripHeader
      band={bandNode}
      trip={trip}
      today={today}
      desk={desktop}
      offline={state.offline}
      pending={state.pending}
      persistFailed={state.persistFailed}
      deletedBy={deletedBy}
      readOnlyOver={phase === 'after' && !unlocked && !trip.deleted}
      members={members}
      notes={tripNoteList(state.notes, trip.trip_id)}
      onDismissNote={(k) => store.dismissNote(k)}
      onUnlock={() => setUnlocked(true)}
      onRestore={() => store.restoreTrip(trip.trip_id)}
      onMenu={(k) => (k === 'details' ? goSettings() : k === 'packing' ? onPacking() : setExtra(k))}
      packing={packingMenu}
      daysOpen={daysOpen}
      onDaysOpen={setDaysOpen}
      dayList={dayListNode}
    />
  )
  const mapPillNode =
    (phone || (desktop && !wide)) && hasPlaces && mapOk ? (
      <Button
        kind="quiet"
        ref={mapPill}
        icon={<MapTrifold />}
        aria-label={`Show map for ${currentModel ? shortDay(currentModel.date) : 'the trip'}`}
        aria-pressed={desktop ? mapOver : undefined}
        onClick={() => (desktop ? setMapOver((o) => !o) : setScreenOpen(true))}
      >
        Map
      </Button>
    ) : undefined
  const pillNode = (
    <PillNav
      value={tab}
      onChange={(k) => setTab(k as TabId)}
      extra={mapPillNode}
      items={[
        { key: 'plan', label: 'Plan', children: planNode },
        // Ideas is a column on desktops; it is a tab on phones and tablets.
        ...(desktop ? [] : [{ key: 'ideas', label: 'Ideas', children: ideasNode }]),
        { key: 'bookings', label: 'Bookings', children: bookingsNode },
      ]}
    />
  )
  const addBarNode = showAdd ? (
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
      onLaunch={(typed) => setBookingDraft({ title: typed, n: ++draftCount.current })}
      onPreview={
        mapCol
          ? (pl) => setBarPreview(hasPin(pl) ? { lat: pl.lat, lng: pl.lng, label: pl.name } : null)
          : undefined
      }
      onExpand={(item) => {
        // One editor for add and edit: create the item, then open it.
        const id = add(target === 'ideas' ? null : target, item)
        if (id) {
          setFreshId(id)
          ctx.current.openItem(id)
        }
      }}
    />
  ) : null
  // The map column, only while there are places: sticky, with the docked item panels over it.
  const sideNode = (
    <aside
      className="trip-side"
      aria-label={mapCol ? 'Map' : 'Details'}
      data-testid={mapCol ? 'trip-map-pane' : 'trip-inspector-pane'}
    >
      {mapCol ? mapNode : null}
      {docked && shownSheet}
    </aside>
  )
  const ideasColumn = (
    <aside className="trip-ideas-col" aria-label="Ideas">
      <header className="trip-ideas-head">
        <SectionLabel>Ideas · {schedule.ideas.length}</SectionLabel>
        <span className="trip-ideas-hint">Drag onto a day</span>
      </header>
      <IdeasPanel
        hint={false}
        ideas={schedule.ideas}
        shared={shared}
        moveOpenId={moveOpenId}
        selectedId={selected}
        enteringId={enteringId}
      />
    </aside>
  )
  return (
    <DndContext
      sensors={sensors}
      // The page scrolls itself while a drag is held near an edge (useTripDrag): dnd-kit's own
      // only scrolls the nearest scrollable box, not the window.
      autoScroll={false}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div
        className={['trip-page', dragging ? 'is-dragging' : '', desktop ? 'is-desk-shell' : '']
          .filter(Boolean)
          .join(' ')}
      >
        {desktop ? (
          <div className="trip-desk-frame">
            <TopNav back={{ to: '/app/trips', label: roomName }} />
            <div className={asideOpen ? 'trip-shell is-desk has-map' : 'trip-shell is-desk'}>
              {ideasColumn}
              <div className="trip-col trip-days-col" ref={daysCol}>
                {!mapOk && hasPlaces && (
                  <p className="trip-map-off">The map comes back when you’re online.</p>
                )}
                {dragging && schedule.days.length > 5 && (
                  <DateRail
                    days={schedule.days.map((d) => d.date)}
                    onJump={(d) => scrollToEl(document.getElementById(`day-${d}`), false)}
                  />
                )}
                <div className="paper-stack">
                  {headerNode}
                  <Card className="paper-card paper-list">
                    <div>{pillNode}</div>
                  </Card>
                </div>
              </div>
              {asideOpen && sideNode}
            </div>
            {addBarNode && (
              <div
                className="trip-composer"
                style={
                  composerBox
                    ? ({
                        '--composer-left': `${composerBox.left}px`,
                        '--composer-width': `${composerBox.width}px`,
                      } as React.CSSProperties)
                    : undefined
                }
              >
                {addBarNode}
              </div>
            )}
            {!wide && hasPlaces && mapOk && (
              <Sheet
                open={mapOver}
                label="Map"
                title="Map"
                width={640}
                onClose={() => setMapOver(false)}
              >
                {mapNode}
              </Sheet>
            )}
          </div>
        ) : (
          <div className="trip-shell">
            <div className="trip-col">
              <TopNav back={{ to: '/app/trips', label: roomName }} />
              <div className="paper-stack">
                {headerNode}
                <Card className="paper-card paper-list">
                  <div>{pillNode}</div>
                  {addBarNode}
                </Card>
              </div>
            </div>
          </div>
        )}
        <WhenSheet
          open={whenOpen}
          start={trip.start_date}
          end={trip.end_date}
          onChange={(s, e) => store.updateTrip(trip.trip_id, { start_date: s, end_date: e })}
          onClose={() => setWhenOpen(false)}
        />
        {phone && mapOk && screenOpen && (
          <MapScreen
            days={schedule.days.map((d) => ({
              date: d.date,
              title: `${shortDay(d.date)}${d.label || d.suggested ? ` · ${d.label || d.suggested}` : ''}`,
              long: longDay(d.date),
            }))}
            initialDate={currentDay ?? schedule.days[0]?.date ?? today}
            defaultSelected={(date, ids) =>
              date === today && nextStopId && ids.includes(nextStopId)
                ? nextStopId
                : (ids[0] ?? null)
            }
            scene={(date, sel) => sceneFor('day', date, sel)}
            home={mapHome}
            onOpenItem={(id) => ctx.current.openItem(id)}
            onPickRow={onPickRow}
            onClose={() => setScreenOpen(false)}
            opener={mapPill}
          />
        )}
        {!desktop && shownSheet}
        {desktop && !wide && shownSheet && (
          <div className="trip-inspector-overlay">{shownSheet}</div>
        )}
        <div className="sr-only" role="status" aria-live="polite">
          {announcement}
        </div>
      </div>
      <DragOverlay dropAnimation={reduced() ? null : undefined}>
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
