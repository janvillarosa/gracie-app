import { useCallback, useEffect, useRef, useState } from 'react'
import type { Place } from '@api/tripTypes'
import type { MapClick } from '@lib/trips/mapScene'

const OFFLINE_HIDE_MS = 5000

/** Whether the map may show: yes while online; going offline hides it only after a few
 *  seconds, so a flaky connection does not flicker it; coming back shows it at once. */
export function useMapOk(online: boolean): boolean {
  const [ok, setOk] = useState(online)
  useEffect(() => {
    if (online) {
      setOk(true)
      return
    }
    const t = setTimeout(() => setOk(false), OFFLINE_HIDE_MS)
    return () => clearTimeout(t)
  }, [online])
  return ok
}

/** The map follows the day being read until the person zooms or pans it; then it waits for
 *  "Fit day", a day picked from the list, or a day opened. */
export function useMapFollow() {
  const [following, setFollowing] = useState(true)
  const [fitToken, setFitToken] = useState(0)
  const pause = useCallback(() => setFollowing(false), [])
  const resume = useCallback(() => setFollowing(true), [])
  const fit = useCallback(() => {
    setFollowing(true)
    setFitToken((n) => n + 1)
  }, [])
  return { following, fitToken, pause, resume, fit }
}

export type ClickPin = {
  pos: MapClick
  // Null while the place is being found.
  place: Place | null
  // Reverse geocoding gave nothing: the card says "Dropped pin" with a name to type.
  degraded: boolean
  name: string
}

/** A click on the map drops one temporary pin and finds out what is there. Nothing is made
 *  until the person says so. */
export function useClickAdd(apiKey: string | null, tripTz?: string) {
  const [pin, setPin] = useState<ClickPin | null>(null)
  const seq = useRef(0)

  const onMapClick = useCallback(
    (c: MapClick) => {
      const my = ++seq.current
      setPin({ pos: c, place: null, degraded: false, name: '' })
      void (async () => {
        let place: Place | null = null
        let degraded = false
        try {
          // The Photon reverse-geocoding proxy is gone; the map's own click gives the name (a POI)
          // or nothing (a dropped pin the person names). The map work replaces this whole flow.
          const r: { results: Place[]; degraded?: boolean } = { results: [], degraded: true }
          const p = r.results[0]
          if (p && !r.degraded)
            place = {
              ...p,
              lat: c.lat,
              lng: c.lng,
              source: 'pin',
              tz: p.tz || tripTz,
              // A label under the click names it; the geocoder fills in the rest.
              name: c.name ?? p.name ?? 'Dropped pin',
            }
          else degraded = true
        } catch {
          degraded = true
        }
        if (my !== seq.current) return
        if (!place) {
          place = {
            name: c.name ?? 'Dropped pin',
            lat: c.lat,
            lng: c.lng,
            source: 'pin',
            tz: tripTz,
          }
          degraded = !c.name
        }
        const found = place
        setPin((cur) => (cur && my === seq.current ? { ...cur, place: found, degraded } : cur))
      })()
    },
    [apiKey, tripTz],
  )
  const dismiss = useCallback(() => {
    seq.current++
    setPin(null)
  }, [])
  const setName = useCallback((name: string) => setPin((p) => (p ? { ...p, name } : p)), [])
  return { pin, onMapClick, dismiss, setName }
}

/** The place to create from a pin: the found one, or "Dropped pin" with the name typed. */
export function pinPlace(pin: ClickPin): Place | null {
  if (!pin.place) return null
  return pin.degraded ? { ...pin.place, name: pin.name.trim() || 'Dropped pin' } : pin.place
}
