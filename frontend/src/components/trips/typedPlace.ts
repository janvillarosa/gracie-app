import type { Place } from '@api/tripTypes'
import { parseCoords } from '@lib/trips/usePlaces'

/** What Enter makes of text typed into an inline place field that no suggestion matched:
 *  "38.7, -9.1" drops a pin there; anything else is an address with no pin ("Address only"). */
export function placeFromTyped(
  text: string,
  bias?: { lat: number; lng: number } | null,
  tz?: string,
): Place {
  const typed = text.trim()
  const c = parseCoords(typed)
  if (c)
    return {
      name: `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`,
      lat: c.lat,
      lng: c.lng,
      tz,
      source: 'pin',
    }
  return {
    name: typed,
    address: typed,
    lat: bias?.lat ?? 0,
    lng: bias?.lng ?? 0,
    tz,
    source: 'manual',
  }
}
