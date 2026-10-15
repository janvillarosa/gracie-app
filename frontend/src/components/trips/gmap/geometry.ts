// Small pure geometry the controller needs: world-pixel projection of a lat/lng inside the
// map div, and "is this pin on screen, clear of a docked panel".
export type PxPoint = { x: number; y: number }
export type Bounds = { north: number; south: number; east: number; west: number }

const TILE = 256

/** Web-mercator world coordinates (0..256) for a lat/lng, as Google's own projection gives them. */
export function worldPoint(lat: number, lng: number): PxPoint {
  const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999)
  return {
    x: TILE * (0.5 + lng / 360),
    y: TILE * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)),
  }
}

/** Where a lat/lng falls in the map div, given the visible bounds and the zoom. */
export function projector(b: Bounds, zoom: number) {
  const scale = 2 ** zoom
  const nw = worldPoint(b.north, b.west)
  return (lat: number, lng: number): PxPoint => {
    const w = worldPoint(lat, lng)
    return { x: (w.x - nw.x) * scale, y: (w.y - nw.y) * scale }
  }
}

/** Whether a point is inside the bounds and not under a panel that covers the right `inset` px. */
export function isVisible(
  b: Bounds,
  p: { lat: number; lng: number },
  width: number,
  inset = 0,
): boolean {
  if (p.lat > b.north || p.lat < b.south) return false
  const span = b.east - b.west
  const usable = width > 0 ? Math.max(0, 1 - inset / width) : 1
  const east = b.west + span * usable
  return p.lng >= b.west && p.lng <= east
}

/** The inverse of `worldPoint`. */
export function latLngFromWorld(p: PxPoint): { lat: number; lng: number } {
  const lng = (p.x / TILE - 0.5) * 360
  const n = Math.PI - (2 * Math.PI * p.y) / TILE
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n))
  return { lat, lng }
}

/** The centre that puts `p` in the middle of the space left of a panel covering the right
 *  `inset` px (so the pin is not hidden behind it). */
export function centreFor(
  p: { lat: number; lng: number },
  zoom: number,
  inset: number,
): { lat: number; lng: number } {
  if (!inset) return p
  const w = worldPoint(p.lat, p.lng)
  return latLngFromWorld({ x: w.x + inset / 2 / 2 ** zoom, y: w.y })
}
