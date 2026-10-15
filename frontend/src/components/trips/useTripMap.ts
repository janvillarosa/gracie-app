import { useCallback, useEffect, useState } from 'react'
import type { Place } from '@api/tripTypes'
import type { MapClick } from '@lib/trips/mapScene'
import { googlePlace, sanitizePlace, setPlaceInfo } from '@lib/trips/places'

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
  // A pin (no Google place): the card says "Dropped pin" with a name to type.
  degraded: boolean
  name: string
}

/** A click on the map drops one temporary pin and works out what is there. Nothing is made
 *  until the person says so. A click on a Google place stores only its `place_id` and
 *  coordinates (its name is display-only); an empty spot becomes a "pin" place whose name is the
 *  geocoder's address, which the person can edit in the card. */
export function useClickAdd(_apiKey: string | null, tripTz?: string) {
  const [pin, setPin] = useState<ClickPin | null>(null)

  const onMapClick = useCallback(
    (c: MapClick) => {
      if (c.place_id) {
        if (c.displayName) setPlaceInfo(c.place_id, { name: c.displayName })
        const place = googlePlace(c.place_id, { lat: c.lat, lng: c.lng }, new Date(), tripTz)
        setPin({
          pos: c,
          place: c.displayName ? { ...place, name: c.displayName } : place,
          degraded: false,
          name: '',
        })
        return
      }
      setPin({
        pos: c,
        place: { name: c.displayName ?? '', lat: c.lat, lng: c.lng, source: 'pin', tz: tripTz },
        // The name is a field in the card, prefilled with the address when we have one.
        degraded: true,
        name: c.displayName ?? '',
      })
    },
    [tripTz],
  )
  const dismiss = useCallback(() => {
    setPin(null)
  }, [])
  const setName = useCallback((name: string) => setPin((p) => (p ? { ...p, name } : p)), [])
  return { pin, onMapClick, dismiss, setName }
}

/** The place to create from a pin: the found one, or "Dropped pin" with the name typed. */
export function pinPlace(pin: ClickPin): Place | null {
  if (!pin.place) return null
  if (pin.place.source === 'google') return sanitizePlace(pin.place)
  return { ...pin.place, name: pin.name.trim() || 'Dropped pin' }
}
