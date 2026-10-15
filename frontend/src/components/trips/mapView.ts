// The contract a map provider implements. TripPage and the phone view talk to TripMap with
// these props only, so the renderer behind it (Google Maps JavaScript API today) can
// be swapped without touching them.
//
// The map is for viewing (brief 6v): pan and zoom, +/−, Fit day, Show all days, emphasis on
// scroll, hover links and the add bar's preview pin. Its one click action is a pill: it selects
// its item in the list.
//
//   scene             what to draw: stops, flags, routes, emphasis (lib/trips/mapScene)
//   preview           a hollow pin for a place being considered
//   fitToken          bump it to fit the scene; `following` lets scene changes refit
//   plus: hover linking (hotId in, onPinHover out), focus on an item (focusPoint/focusInset),
//   user movement (onUserMove pauses following), pill clicks and the "off the map" chip.
import type { MapPreview, MapScene, LatLng } from '@lib/trips/mapScene'

export type MapViewProps = {
  scene: MapScene
  // Desktop: zoom controls and hover links. Phone: look around only (smaller pills, no times).
  interactive: boolean
  // Names are cut to this many characters (22 on desktop, 16 on the phone).
  labelLimit: number
  // The "NEXT" kicker on the next stop's pill (desktop only).
  nextPrefix: boolean
  preview?: MapPreview | null
  // A stop the pointer (or focus) is on in the list: lifted, and in full even if it collided.
  hotId?: string | null
  // The item open in a docked panel: the map centres on it in the space that is left.
  focusPoint?: LatLng | null
  focusInset?: number
  // Space the view's own chrome covers, so fitted pins never sit under it.
  fitPadding?: { top: number; bottom: number; left: number; right: number }
  // Fit the scene whenever its set of stops changes (until the person moves the map themselves).
  following: boolean
  fitToken: number
  title: string
  // A pill was clicked: select its item.
  onPinClick: (id: string) => void
  // The pointer is on a pill (or left it): the page lights the matching row.
  onPinHover?: (id: string | null) => void
  // The chip "Wed 28 is off the map · Show": fit the emphasised day.
  onShowDay?: () => void
  // The person zoomed or panned: following should pause.
  onUserMove?: () => void
}
