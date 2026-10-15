// The contract a map provider implements. TripPage and the phone view talk to TripMap with
// these props only, so the renderer behind it (Google Maps JavaScript API today) can
// be swapped without touching them.
//
//   setDay / setPins   -> scene            what to draw: stops, flags, route, emphasis (lib/trips/mapScene)
//   setPreview         -> preview          a hollow pin for a place being considered
//   fit                -> fitToken         bump it to fit the scene; `following` lets scene changes refit
//   plus: hover linking (hotId in, onPinHover out), pill clicks (onPinClick), focus on an item
//   (focusPoint/focusInset) and user movement (onUserMove pauses following). The map is for looking: the only click is a pill,
//   which selects its row; place icons and empty spots do nothing.
import type { MapPreview, MapScene, LatLng } from '@lib/trips/mapScene'

export type MapViewProps = {
  scene: MapScene
  // Desktop: zoom controls and hover links. Phone: look around only.
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
  // A pill was clicked: the page selects that item in the list (the one thing the map does).
  onPinClick: (id: string) => void
  // The pointer is on a pill (or left it): the page lights that row. Purely visual.
  onPinHover?: (id: string | null) => void
  // The person zoomed or panned: following should pause.
  onUserMove?: () => void
}
