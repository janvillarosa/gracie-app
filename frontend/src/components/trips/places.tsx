import React, { useEffect, useRef, useState } from 'react'
import { useAuth } from '@auth/AuthProvider'
import { reversePlace, searchPlaces } from '@api/tripEndpoints'
import type { Place } from '@api/tripTypes'

export const MIN_QUERY = 3
export const DEBOUNCE_MS = 300

export type PlaceSearch = {
  results: Place[]
  degraded: boolean
  loading: boolean
  // The query the results belong to, so callers can ignore stale slips.
  forQuery: string
}

const IDLE: PlaceSearch = { results: [], degraded: false, loading: false, forQuery: '' }

/** Parses "38.7876, -9.3906" (a dropped pin typed or pasted). */
export function parseCoords(text: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}

/** Debounced place search through the backend proxy. Any failure reads as "degraded". */
export function usePlaceSearch(query: string, bias?: { lat: number; lng: number } | null) {
  const { apiKey } = useAuth()
  const [state, setState] = useState<PlaceSearch>(IDLE)
  const seq = useRef(0)
  const q = query.trim()
  const lat = bias?.lat
  const lng = bias?.lng

  useEffect(() => {
    const my = ++seq.current
    if (q.length < MIN_QUERY || parseCoords(q)) {
      setState(IDLE)
      return
    }
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true }))
      try {
        const r = await searchPlaces(apiKey as string, {
          q,
          lat,
          lng,
          lang: navigator.language?.slice(0, 2),
          limit: 5,
        })
        if (my === seq.current)
          setState({
            results: r.results ?? [],
            degraded: !!r.degraded,
            loading: false,
            forQuery: q,
          })
      } catch {
        if (my === seq.current)
          setState({ results: [], degraded: true, loading: false, forQuery: q })
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [q, apiKey, lat, lng])

  return state
}

/** A place for a typed coordinate pair: reverse-geocoded when the proxy answers. */
export async function pinFromCoords(
  apiKey: string,
  lat: number,
  lng: number,
  fallbackTz?: string,
): Promise<Place> {
  try {
    const r = await reversePlace(apiKey, lat, lng)
    const p = r.results?.[0]
    if (p) return { ...p, lat, lng, source: 'pin', tz: p.tz || fallbackTz }
  } catch {}
  return { name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng, source: 'pin', tz: fallbackTz }
}

export const OSM_ATTRIBUTION = 'Places © OpenStreetMap contributors (ODbL)'

export const PlaceSlip = React.memo(function PlaceSlip({
  place,
  id,
  active,
  onPick,
}: {
  place: Place
  id: string
  active: boolean
  onPick: (p: Place) => void
}) {
  const detail = place.address || place.locality || ''
  return (
    // Options aren't tab stops: focus stays in the field and the active slip is announced
    // through aria-activedescendant, the same as the pantry slips.
    // biome-ignore lint/a11y/useFocusableInteractive: combobox options are not tab stops
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard goes through the combobox field
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-label={detail ? `${place.name}, ${detail}` : place.name}
      className={active ? 'pantry-slip is-active' : 'pantry-slip'}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => onPick(place)}
    >
      <span className="slip-name">{place.name}</span>
      {detail && <span className="slip-usual">{detail}</span>}
    </div>
  )
})

export const DEGRADED_TEXT = 'Search is unavailable. Drop a pin or type the address.'
