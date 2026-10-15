// Pure helpers for the markers' name labels: what each one says, which ones are even eligible,
// and the greedy collision pass that hides the ones that would overlap (pips always stay).
import { placeLabels, type Anchor, type LabelItem } from '@lib/trips/mapLabels'
import { shorten, type MapScene, type MapStop } from '@lib/trips/mapScene'

export type { Anchor } from '@lib/trips/mapLabels'

/** "Next · Pena Palace", cut to the limit with an ellipsis. */
export function labelText(
  stop: MapStop,
  scene: Pick<MapScene, 'nextId'>,
  limit: number,
  nextPrefix: boolean,
): string {
  const next = stop.id === scene.nextId && nextPrefix
  return `${next ? 'Next · ' : ''}${shorten(stop.label, limit)}`
}

/** Names are on for a day; for all days and for ideas only a hovered stop shows its name. */
export const labelledByDefault = (scene: Pick<MapScene, 'mode'>) => scene.mode === 'day'

export type LabelCandidate = {
  id: string
  // The pip's pixel position in the map div.
  x: number
  y: number
  text: string
  // Lower first: selected 0, next 1, then the day's order (2+).
  priority: number
  // A stop the list is hovering: tried first of all.
  hot?: boolean
}

/** Greedy label layout after the map settles: in priority order each label takes the first side
 *  (right, left, above, below) where it covers no other label and no other pip; the rest are
 *  hidden. Returns the side for every label that stays. */
export function resolveLabels(
  items: LabelCandidate[],
  size: { width: number; height: number },
  // Pips of stops that carry no label right now: a label still must not cover them.
  obstacles: Array<{ x: number; y: number }> = [],
): Map<string, Anchor> {
  const all: LabelItem[] = items.map((i) => ({
    id: i.id,
    x: i.x,
    y: i.y,
    text: i.text,
    priority: i.hot ? -1 : i.priority,
  }))
  const placed = placeLabels(all, { ...size, obstacles })
  return new Map(placed.map((p) => [p.id, p.anchor]))
}

/** Pins that carry a label right now (everything on a day; only a hovered stop otherwise). */
export function eligibleIds(scene: MapScene, hotId: string | null | undefined): Set<string> {
  const out = new Set<string>()
  const all = labelledByDefault(scene)
  for (const s of scene.stops) if (all || s.id === hotId) out.add(s.id)
  return out
}
