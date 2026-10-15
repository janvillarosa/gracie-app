import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Place, Trip } from '@api/tripTypes'
import {
  asked,
  enrichTrip,
  isGoogle,
  located,
  placeInfo,
  placeInfoVersion,
  refreshPatch,
  selectRefresh,
  setPlaceInfo,
  subscribePlaceInfo,
  worthRefreshing,
  type LatLng,
} from './places'
import {
  biasBox,
  DISPLAY_FIELDS,
  getPlacesSource,
  newSession,
  type Session,
  type Suggestion,
} from './placesSource'
import type { TripStore } from './store'

export const MIN_QUERY = 2
export const DEBOUNCE_MS = 250

export type Suggest = {
  suggestions: Suggestion[]
  loading: boolean
  // Search could not run (offline, quota, a rejected key): the caller offers typing instead.
  degraded: boolean
  // The query the suggestions belong to, so callers can ignore stale ones.
  forQuery: string
  // "Powered by Google" must show under Google suggestions; the demo list says what it is.
  attribution: 'google' | 'demo'
  /** The pick: fetches the place with the session's token (ending the session) and remembers its
   *  name for display. Resolves null when Google cannot be reached. */
  pick: (s: Suggestion) => Promise<Place | null>
}

/** Parses "38.7876, -9.3906" (a dropped pin typed or pasted). */
export function parseCoords(text: string): LatLng | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}

/** Debounced place suggestions (250 ms, at least 2 characters). One session token covers a whole
 *  search: the keystrokes' requests and the pick. A pick, or clearing the field, ends it. */
export function usePlaceSuggest(query: string, bias?: LatLng | null): Suggest {
  const [state, setState] = useState<
    Pick<Suggest, 'suggestions' | 'loading' | 'degraded' | 'forQuery'>
  >({
    suggestions: [],
    loading: false,
    degraded: false,
    forQuery: '',
  })
  const session = useRef<Session | null>(null)
  const seq = useRef(0)
  const q = query.trim()
  const lat = bias?.lat
  const lng = bias?.lng
  const source = getPlacesSource()

  useEffect(() => {
    const my = ++seq.current
    if (q === '') session.current = null
    if (q.length < MIN_QUERY || parseCoords(q)) {
      setState({ suggestions: [], loading: false, degraded: false, forQuery: '' })
      return
    }
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true }))
      if (!session.current) session.current = newSession()
      try {
        const suggestions = await source.suggest(q, {
          bias: lat !== undefined && lng !== undefined ? biasBox({ lat, lng }) : null,
          session: session.current,
        })
        if (my === seq.current)
          setState({ suggestions, loading: false, degraded: false, forQuery: q })
      } catch {
        if (my === seq.current)
          setState({ suggestions: [], loading: false, degraded: true, forQuery: q })
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [q, lat, lng, source])

  const pick = useCallback(
    async (s: Suggestion): Promise<Place | null> => {
      const sess = session.current ?? newSession()
      try {
        const r = await source.resolve(s, sess)
        if (r.place.place_id) setPlaceInfo(r.place.place_id, r.info)
        // The pick ends the session: the next search starts a new one.
        session.current = null
        return r.place
      } catch {
        return null
      }
    },
    [source],
  )

  return { ...state, attribution: source.kind, pick }
}

// ---- display cache and coordinate maintenance ---------------------------------------------------

const SPACING_MS = 200 // about 5 calls a second
let queueTail: Promise<void> = Promise.resolve()

/** Run a task after the previous one, spaced out. */
function paced<T>(fn: () => Promise<T>): Promise<T | undefined> {
  const run = queueTail.then(fn, fn)
  queueTail = run.then(
    () => new Promise((r) => setTimeout(r, SPACING_MS)),
    () => new Promise((r) => setTimeout(r, SPACING_MS)),
  )
  return run.catch(() => undefined)
}

/** Test hook. */
export function resetPlaceMaintenance() {
  queueTail = Promise.resolve()
}

const todayStr = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Names for the Google places on screen (session memory, one call per place id, de-duplicated,
 *  paced), and fresh coordinates for current and upcoming trips (older than 25 days or missing).
 *  Online only. Re-runs when the window gains focus. */
export function usePlaceMaintenance(
  store: TripStore | null,
  trips: Record<string, Trip>,
  offline: boolean,
) {
  const [focusTick, setFocusTick] = useState(0)
  useEffect(() => {
    const on = () => {
      asked.clear()
      setFocusTick((n) => n + 1)
    }
    window.addEventListener('focus', on)
    return () => window.removeEventListener('focus', on)
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: focusTick re-runs the pass on focus
  useEffect(() => {
    if (offline || !store || (typeof navigator !== 'undefined' && navigator.onLine === false))
      return
    const today = todayStr()
    const source = getPlacesSource()
    const now = new Date()
    for (const trip of Object.values(trips)) {
      if (!worthRefreshing(trip, today)) continue
      const stale = selectRefresh(trip, now.getTime())
      const staleIds = new Set(stale.map((t) => t.place.place_id))
      // 1. names and addresses for display
      const ids = new Set<string>()
      const see = (p?: Place | null) => {
        if (isGoogle(p) && !placeInfo(p.place_id) && !staleIds.has(p.place_id)) ids.add(p.place_id)
      }
      see(trip.destination)
      for (const s of trip.stops ?? []) see(s)
      for (const t of trip.todos) see(t.place)
      for (const b of trip.bookings) {
        see(b.place)
        see(b.end_place)
      }
      for (const id of ids) {
        if (asked.has(`info:${id}`)) continue
        asked.add(`info:${id}`)
        void paced(async () => {
          const d = await source.details(id, DISPLAY_FIELDS)
          setPlaceInfo(id, d.info)
        })
      }
      // 2. coordinates, written back as an ordinary update (the server stamps nothing for us)
      for (const target of stale) {
        const key = `${trip.trip_id}:${JSON.stringify(target.slot)}:${target.place.place_id}`
        if (asked.has(key)) continue
        asked.add(key)
        void paced(async () => {
          const d = await source.details(target.place.place_id, [
            'displayName',
            'formattedAddress',
            'addressComponents',
            'location',
          ])
          setPlaceInfo(target.place.place_id, d.info)
          if (!d.at) return
          const patch = refreshPatch(trip, target, d.at, new Date())
          const { slot } = target
          if (slot.kind === 'todo') store.updateTodo(trip.trip_id, slot.id, patch)
          else if (slot.kind === 'booking') store.updateBooking(trip.trip_id, slot.id, patch)
          else store.updateTrip(trip.trip_id, patch)
        })
      }
    }
  }, [trips, store, offline, focusTick])
}

/** Re-render when the display cache fills, and fill Google places of each trip from it. */
export function useEnrichedTrips(trips: Record<string, Trip>): Record<string, Trip> {
  const v = useSyncExternalStore(subscribePlaceInfo, placeInfoVersion, placeInfoVersion)
  const cache = useRef<{
    v: number
    trips: Record<string, Trip>
    out: Record<string, Trip>
  } | null>(null)
  if (cache.current && cache.current.v === v && cache.current.trips === trips)
    return cache.current.out
  const prev = cache.current?.out
  const out: Record<string, Trip> = {}
  for (const [id, t] of Object.entries(trips)) {
    const e = enrichTrip(t)
    // Keep object identity when nothing changed, so memoised screens stay still.
    out[id] = prev?.[id] && sameTrip(prev[id], e) ? prev[id] : e
  }
  cache.current = { v, trips, out }
  return out
}

const sameTrip = (a: Trip, b: Trip) => a === b

// ---- previewing a highlighted suggestion ---------------------------------------------------------

const PREVIEW_DWELL_MS = 350

/** A highlighted suggestion (arrowed to and left for a moment) is looked up for its location and
 *  handed to `onPreview` as a place the map can draw; nothing highlighted clears it. One
 *  `location` lookup per place, cached for the session. */
export function useSuggestionPreview(onPreview?: (p: Place | null) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const seq = useRef(0)
  const cb = useRef(onPreview)
  cb.current = onPreview
  useEffect(() => () => clearTimeout(timer.current), [])
  return useCallback((s: Suggestion | null) => {
    clearTimeout(timer.current)
    const my = ++seq.current
    if (!s) {
      cb.current?.(null)
      return
    }
    timer.current = setTimeout(async () => {
      let at = located.get(s.id)
      if (at === undefined) {
        try {
          at = (await getPlacesSource().details(s.id, ['location'])).at
        } catch {
          at = null
        }
        located.set(s.id, at)
      }
      if (my === seq.current && at) cb.current?.({ source: 'google', place_id: s.id, ...at })
    }, PREVIEW_DWELL_MS)
  }, [])
}
