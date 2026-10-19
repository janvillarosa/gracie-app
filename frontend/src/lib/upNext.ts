import type { RouteItem } from '@api/types'

/** The item to do next on the House's route, and the one after it. This is the Go pick rule
 *  (autopilot.PickUpNext): both run backend/internal/autopilot/testdata/upnext_cases.json.
 *
 *  The anchor is the last item checked this run that has a spot; none, or one not on the route,
 *  is the start of the route. `next` is the unchecked item with the smallest spot at or after the
 *  anchor, doubling back to the smallest overall when nothing is ahead. `after` (the Go rule's `then`) is the unchecked
 *  item with the next strictly later spot (no doubling back). Look-alike items share a key, so
 *  the first unchecked item of a key is the one named. */
export function pickUpNext(
  route: RouteItem[],
  anchorItemId?: string,
): { next?: RouteItem; after?: RouteItem } {
  const anchor = route.find((it) => it.item_id === anchorItemId)?.spot ?? 0
  const seen = new Set<string>()
  const open: RouteItem[] = []
  for (const it of route) {
    if (it.done || seen.has(it.key)) continue
    seen.add(it.key)
    open.push(it)
  }
  const bySpot = (a: RouteItem, b: RouteItem) => a.spot - b.spot || a.key.localeCompare(b.key)
  open.sort(bySpot)
  const next = open.find((it) => it.spot >= anchor) ?? open[0]
  if (!next) return {}
  return { next, after: open.find((it) => it.spot > next.spot) }
}
