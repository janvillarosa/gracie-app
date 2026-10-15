// Pure helpers for the stop pills: what each one says, which ones are even eligible for a full
// pill, how wide it is, and the greedy collision pass that collapses the ones that would overlap
// (a collapsed pill is its anchor and dot; it expands on hover).
import { shorten, type MapScene, type MapStop } from '@lib/trips/mapScene'

/** A stop's name, cut to the limit with an ellipsis. */
export const pillText = (stop: Pick<MapStop, 'label'>, limit: number): string =>
  shorten(stop.label, limit)

/** Names are in full for a day; for all days and for ideas only a hovered stop is. */
export const labelledByDefault = (scene: Pick<MapScene, 'mode'>) => scene.mode === 'day'

/** Whether a stop carries its name: every stop of a day, and in all-days mode the stops of the day
 *  in emphasis (the desk's map, scrolling the list changes which). */
export const isLabelled = (
  scene: Pick<MapScene, 'mode' | 'emphasisDay'>,
  stop: Pick<MapStop, 'dayIndex'>,
) =>
  labelledByDefault(scene) ||
  (scene.mode === 'all' && scene.emphasisDay != null && stop.dayIndex === scene.emphasisDay)

/** Whether the pill shows in full without hovering: a labelled stop, and always the next and the
 *  selected one. */
export const isFull = (scene: MapScene, stop: Pick<MapStop, 'id' | 'dayIndex'>) =>
  isLabelled(scene, stop) || stop.id === scene.nextId || stop.id === scene.selectedId

// Pill geometry (px), matching gmap.css: height, the gap between the pill and its anchor, and
// rough glyph widths for Figtree 600 at 14px (13px on the phone).
export const PILL_GAP = 10
const DESKTOP = { height: 34, padX: 24, dot: 12, gap: 8, char: 7.5, time: 6.6 }
const PHONE = { height: 30, padX: 20, dot: 12, gap: 8, char: 7, time: 0 }

export type PillSize = { w: number; h: number }

/** How big the full pill is: dot, name, the time if there is one, the NEXT kicker. */
export function pillSize(o: {
  name: string
  time?: string
  kicker?: boolean
  compact?: boolean
}): PillSize {
  const k = o.compact ? PHONE : DESKTOP
  let w = k.padX + k.dot + k.gap + Math.ceil(o.name.length * k.char)
  if (!o.compact && o.time) w += k.gap + Math.ceil(o.time.length * k.time)
  if (o.kicker) w += k.gap + 32
  return { w, h: k.height }
}

export type PillCandidate = {
  id: string
  // The anchor's pixel position in the map div.
  x: number
  y: number
  w: number
  h: number
  // Lower first: selected 0, next 1, then the day's order (2+).
  priority: number
  // A stop the list is hovering: tried first of all, and always kept.
  hot?: boolean
}

type Box = { x: number; y: number; w: number; h: number }
const hit = (a: Box, b: Box) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

const ANCHOR = 12 // the 10px ring and its shadow

/** Greedy pill layout after the map settles: in priority order each pill, standing above its
 *  anchor, is kept if it covers no kept pill and no other stop's anchor. The selected, the next
 *  and a hovered stop are always kept. Returns the ids that stay in full; the rest collapse. */
export function resolvePills(
  items: PillCandidate[],
  // Anchors of stops with no full pill right now: a pill still must not cover them.
  obstacles: Array<{ x: number; y: number }> = [],
): Set<string> {
  const anchors: Array<Box & { id?: string }> = [
    ...items.map((i) => ({
      id: i.id,
      x: i.x - ANCHOR / 2,
      y: i.y - ANCHOR / 2,
      w: ANCHOR,
      h: ANCHOR,
    })),
    ...obstacles.map((o) => ({ x: o.x - ANCHOR / 2, y: o.y - ANCHOR / 2, w: ANCHOR, h: ANCHOR })),
  ]
  const order = items
    .map((it, index) => ({ it, index }))
    .sort(
      (a, b) =>
        (a.it.hot ? -1 : a.it.priority) - (b.it.hot ? -1 : b.it.priority) || a.index - b.index,
    )
  const taken: Box[] = []
  const kept = new Set<string>()
  for (const { it } of order) {
    const box: Box = { x: it.x - it.w / 2, y: it.y - PILL_GAP - it.h, w: it.w, h: it.h }
    const sure = it.hot || it.priority <= 1
    if (
      !sure &&
      (taken.some((t) => hit(t, box)) || anchors.some((a) => a.id !== it.id && hit(a, box)))
    )
      continue
    taken.push(box)
    kept.add(it.id)
  }
  return kept
}

/** Pins that may carry a full pill right now (everything on a day, the day in emphasis, the next
 *  and the selected stop, and a hovered one). */
export function eligibleIds(scene: MapScene, hotId: string | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const s of scene.stops) if (isFull(scene, s) || s.id === hotId) out.add(s.id)
  return out
}
