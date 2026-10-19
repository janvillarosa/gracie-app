import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AutopilotView, ListItem } from '@api/types'
import { pickUpNext } from '@lib/upNext'
import { hideUpNext, isUpNextHidden } from '@lib/upNextHidden'

export type UpNextEvent =
  | { type: 'shown' }
  | { type: 'tapped' }
  | { type: 'dismissed' }
  | { type: 'followed'; hit: boolean }

export type UpNextPick = { itemId: string; name: string; thenName?: string }

type Args = {
  view: AutopilotView | undefined
  items: ListItem[]
  listId: string
  onEvent: (e: UpNextEvent) => void
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Up next on the List page: the item the House usually grabs next, from the server's route over
 *  this list. The server says whether the slip is allowed (its stack) and where the run stands;
 *  the page applies the pick rule itself so a check-off hands off at once.
 *
 *  It shows as soon as the server says the House is probably shopping (a run in progress, or the
 *  usual window), else after the first check-off of this visit, anchored on that item. Once it has
 *  shown it stays for the visit while there is something left to name. The round X puts it away
 *  for this run (see upNextHidden). */
export function useUpNext({ view, items, listId, onEvent }: Args) {
  const up = view?.stack?.includes('up_next') ? view.up_next : undefined
  const [visitAnchor, setVisitAnchor] = useState<string | null>(null)
  const [latched, setLatched] = useState(false)
  const [hiddenTick, setHiddenTick] = useState(0)

  // A different list is a different visit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on the list only
  useEffect(() => {
    setVisitAnchor(null)
    setLatched(false)
  }, [listId])

  const live = useMemo(() => new Map(items.map((it) => [it.item_id, it])), [items])
  // A route item missing from the list was checked off (the list hides them) or removed.
  const route = useMemo(
    () => up?.route.map((r) => ({ ...r, done: live.get(r.item_id)?.completed ?? true })),
    [up, live],
  )
  const runKey = up?.run?.started_at ?? `window-${dayKey(Date.now())}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: hiddenTick re-reads storage after a hide
  const hidden = useMemo(
    () => isUpNextHidden(listId, runKey, Date.now()),
    [listId, runKey, hiddenTick],
  )

  const allowed = !!up && (latched || up.ready || visitAnchor !== null)
  useEffect(() => {
    if (up && (up.ready || visitAnchor !== null)) setLatched(true)
  }, [up, visitAnchor])

  const anchor = visitAnchor ?? up?.run?.anchor_item_id
  const pick = useMemo<UpNextPick | undefined>(() => {
    if (!allowed || hidden || !route) return undefined
    const { next, after } = pickUpNext(route, anchor)
    if (!next) return undefined
    const nameOf = (id: string, fallback: string) => live.get(id)?.description ?? fallback
    return {
      itemId: next.item_id,
      name: nameOf(next.item_id, next.key),
      thenName: after ? nameOf(after.item_id, after.key) : undefined,
    }
  }, [allowed, hidden, route, anchor, live])
  const afterId = useMemo(
    () => (route && pick ? pickUpNext(route, anchor).after?.item_id : undefined),
    [route, pick, anchor],
  )

  const emit = useRef(onEvent)
  emit.current = onEvent
  const shown = useRef(new Set<string>())
  useEffect(() => {
    if (!pick || shown.current.has(pick.itemId)) return
    shown.current.add(pick.itemId)
    emit.current({ type: 'shown' })
  }, [pick])

  const state = useRef({ pick, afterId, route })
  state.current = { pick, afterId, route }

  /** An item was checked off (here or by the slip's tick): did it follow the pick, and move on. */
  const onChecked = useCallback((itemId: string) => {
    const s = state.current
    if (s.pick)
      emit.current({ type: 'followed', hit: itemId === s.pick.itemId || itemId === s.afterId })
    if (s.route?.some((r) => r.item_id === itemId)) setVisitAnchor(itemId)
  }, [])
  const onUnchecked = useCallback((itemId: string) => {
    setVisitAnchor((a) => (a === itemId ? null : a))
  }, [])
  const tapped = useCallback(() => emit.current({ type: 'tapped' }), [])
  const hide = useCallback(() => {
    hideUpNext(listId, runKey, Date.now())
    setHiddenTick((t) => t + 1)
    emit.current({ type: 'dismissed' })
  }, [listId, runKey])

  return { pick, onChecked, onUnchecked, tapped, hide }
}
