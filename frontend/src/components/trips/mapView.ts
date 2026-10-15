// The contract a map provider implements. TripPage and the phone view talk to TripMap with
// these props only, so the tiles/renderer behind it (MapLibre with Protomaps tiles today) can
// be swapped without touching them.
//
//   setDay / setPins   -> scene            what to draw: stops, flags, route (see lib/trips/mapScene)
//   setPreview         -> preview          a hollow pin for a place being considered
//   onMapClick         -> onMapClick       a click on the map (desktop add-a-stop only)
//   fit                -> fitToken         bump it to fit the scene; `following` lets scene changes refit
//   plus: hover linking (hotId), focus on an item (focusPoint/focusInset), user movement
//   (onUserMove pauses following) and pin clicks.
import type { MapClick, MapPreview, MapScene, LatLng } from '@lib/trips/mapScene'

export const OSM_MAP_ATTRIBUTION = '© OpenStreetMap contributors'

export type MapViewProps = {
  scene: MapScene
  // Desktop: zoom controls, click to add, hover links. Phone: look around only.
  interactive: boolean
  // Labels are cut to this many characters (22 on desktop, 14 on the phone).
  labelLimit: number
  // "Next · " before the next stop's label (desktop only).
  nextPrefix: boolean
  preview?: MapPreview | null
  // A stop the pointer (or focus) is on in the list: lifted, and labelled even if it collided.
  hotId?: string | null
  // The item open in a docked panel: the map centres on it in the space that is left.
  focusPoint?: LatLng | null
  focusInset?: number
  // Space the view's own chrome covers, so fitted pins never sit under it.
  fitPadding?: { top: number; bottom: number; left: number; right: number }
  // Fit the scene whenever it changes (until the person moves the map themselves).
  following: boolean
  fitToken: number
  title: string
  onPinClick: (id: string) => void
  onMapClick?: (c: MapClick) => void
  // The person zoomed or panned: following should pause.
  onUserMove?: () => void
}

export type TileConfig = {
  // The Protomaps hosted API key (VITE_PROTOMAPS_API_KEY). Without it the map is the preview.
  key: string
  // Where the tiles' TileJSON lives.
  tilejson: string
  // Glyphs for labels (VITE_GLYPHS_URL); without them labels fall back to a hover tag.
  glyphs: string
}

export function tileConfig(): TileConfig {
  const key = ((import.meta.env.VITE_PROTOMAPS_API_KEY as string | undefined) ?? '').trim()
  const glyphs = ((import.meta.env.VITE_GLYPHS_URL as string | undefined) ?? '').trim()
  return {
    key,
    tilejson: key ? `https://api.protomaps.com/tiles/v4.json?key=${encodeURIComponent(key)}` : '',
    glyphs,
  }
}
