import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Paper, PaperStack, Button, RubberStamp } from '@components/ui'
import { errorMessage } from '@lib/errors'
import { useLocation, useParams } from 'react-router-dom'
import { useTransitionNavigate } from '@lib/viewTransition'
import { useAuth } from '@auth/AuthProvider'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getMe,
  getMyRoom,
  getListItems,
  getLists,
  createListItem,
  updateListItem,
  deleteListItem,
  voteListDeletion,
  cancelListDeletion,
  reorderListItem,
  updateList,
  clearListItems,
  getRoomPantry,
  getListSuggestions,
  getRunHint,
  ignoreListSuggestion,
} from '@api/endpoints'
import type { List, ListItem, ListSuggestion, PantryItem } from '@api/types'
import {
  Typography,
  Space,
  Input,
  List as AntList,
  Grid,
  Dropdown,
  message,
  Alert,
  Tag,
} from 'antd'
import {
  ArrowLeft,
  Plus,
  DotsThreeVertical,
  FloppyDisk,
  Broom,
  Eraser,
  ArrowCounterClockwise,
  Check,
  Rows,
} from '@phosphor-icons/react'
import {
  DndContext,
  TouchSensor,
  MouseSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { toEmoji } from '../icons'
import { confettiAt } from '@lib/confetti'
import { parseInput } from '@lib/parseInput'
import { timeAgo } from '@lib/time'
import { getCategoryClass } from '@lib/category'
import { useStableCallback } from '@lib/useStableCallback'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import { ItemRow, reorderLock } from '@components/ItemRow'
import { AddItemBar } from '@components/AddItemBar'
import { SuggestionStack, type SlipPhase } from '@components/SuggestionSlip'
import { track } from '@lib/analytics'
import { stampLines, useShoppingRun } from '@lib/shoppingRun'
import { TopNav } from '@components/TopNav'
import { PillNav } from '@components/PillNav'
import { HouseLoader } from '@components/HouseLoader'
import { RowSkeleton } from '@components/RowSkeleton'

const CLEAR_TOAST_KEY = 'clear-completed'

// Smart suggestions show one at a time: the server answers with the most confident, and after an
// add or an ignore it is asked again (it pauses the list once two in a row are ignored).
const MAX_SUGGESTIONS_SHOWN = 1
// How long a taken or ignored slip takes to pop out before the next answer is shown.
const SUGGESTION_EXIT_MS = 160
// How long the emptied slot takes to close when no further suggestion follows.
const SUGGESTION_COLLAPSE_MS = 220

export const ListPage: React.FC = () => {
  const { apiKey } = useAuth()
  const navigate = useTransitionNavigate()
  const { listId = '' } = useParams()
  // Arrived from a trip (its packing list): the way back is the trip.
  const arrival = useLocation().state as { from?: string; fromLabel?: string } | null
  const fromTrip = arrival?.from?.startsWith('trip:')
    ? { id: arrival.from.slice(5), label: arrival.fromLabel || 'Trip' }
    : null
  const [includeCompleted, setIncludeCompleted] = useState(false)
  const [groupByCat, setGroupByCat] = useState(() => {
    const saved = localStorage.getItem('gracie_group_by_cat')
    return saved === 'true'
  })

  useEffect(() => {
    localStorage.setItem('gracie_group_by_cat', String(groupByCat))
  }, [groupByCat])

  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [savingItemId, setSavingItemId] = useState<string | null>(null)
  const checkboxRefs = useRef<Record<string, HTMLElement | null>>({})
  const registerAnchor = useStableCallback((id: string, el: HTMLElement | null) => {
    checkboxRefs.current[id] = el
  })
  const qc = useQueryClient()
  // Breakpoints hook must be called before any early returns
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  // antd message for toasts
  const [msgApi, contextHolder] = message.useMessage()
  const show = (msg: string) => {
    msgApi.info(msg)
  }
  const [redirecting, setRedirecting] = useState(false)
  const [activeTab, setActiveTab] = useState<'items' | 'notes'>('items')
  const [notesText, setNotesText] = useState('')
  const [notesSaving, setNotesSaving] = useState(false)
  // What Clear all wiped, kept until the user types or saves so the clear can be undone.
  const [clearedNotes, setClearedNotes] = useState<string | null>(null)
  // Save says "Saved" in place for a moment instead of raising a toast.
  const [notesJustSaved, setNotesJustSaved] = useState(false)

  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => getMe(apiKey!) })
  const roomId = meQuery.data?.room_id as string | undefined
  // Shares the dashboard's cache; only used to name the way back.
  const houseQuery = useQuery({
    queryKey: ['my-room'],
    queryFn: () => getMyRoom(apiKey!),
    retry: false,
    staleTime: 60_000,
  })
  const userId = meQuery.data?.user_id as string | undefined

  const parseMs = (v: any, def: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : def
  }
  const listsQuery = useQuery({
    queryKey: ['lists', roomId],
    queryFn: () => getLists(apiKey!, roomId!),
    enabled: !!roomId,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 5_000,
  })
  const listMeta: List | undefined = useMemo(
    () => listsQuery.data?.find((l) => l.list_id === listId),
    [listsQuery.data, listId],
  )
  const itemsQuery = useQuery({
    queryKey: ['list-items', listId, includeCompleted],
    queryFn: () => getListItems(apiKey!, roomId!, listId, includeCompleted),
    enabled: !!roomId && !!listId,
    // Showing/hiding checked-off items keeps the rows already on screen while the other
    // set loads, instead of dropping back to a skeleton. Never across lists, though.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === listId ? prev : undefined),
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 5_000,
  })

  // Past items for add-bar suggestions. Fetched once and filtered on the client; a failure
  // just means no suggestions.
  const pantryQuery = useQuery({
    queryKey: ['pantry', roomId],
    queryFn: () => getRoomPantry(apiKey!, roomId!),
    enabled: !!roomId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    staleTime: 5 * 60_000,
  })

  // Shopping run: check-offs on this visit, with thresholds learned from this person's (or the
  // house's) habits. A failed or slow hint just means the default rule.
  const runHintQuery = useQuery({
    queryKey: ['run-hint', roomId, listId],
    queryFn: () => getRunHint(apiKey!, roomId!, listId),
    enabled: !!roomId && !!listId,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 600_000,
  })
  const run = useShoppingRun(runHintQuery.data)
  const during = run.active ? ('run' as const) : undefined
  // The run-done stamp: lands once per run, on the last check or on Clear done.
  const [runStamp, setRunStamp] = useState<string[] | null>(null)
  const landRunStamp = useStableCallback(() => {
    if (!run.active || run.stamped) return
    run.markStamped()
    setRunStamp(stampLines(run.runChecks, run.minutes, runHintQuery.data?.typical))
    track('list.run_stamped', {
      subject: { type: 'list', id: listId },
      props: { items: run.runChecks, minutes: run.minutes },
    })
  })

  // Smart suggestion: the one thing the house usually adds around now (mid-shop: what comes due
  // before the next shop). The server decides (and answers with nothing when the feature is off);
  // a failure just means no slip.
  const suggestionsKey = ['suggestions', roomId, listId, during ?? 'normal']
  const suggestionsQuery = useQuery({
    queryKey: suggestionsKey,
    queryFn: () => getListSuggestions(apiKey!, roomId!, listId, during),
    enabled: !!roomId && !!listId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    staleTime: 60_000,
  })
  // A taken or ignored slip keeps its slot while it pops out and the server answers (phase leaving,
  // then held), so going through suggestions swaps the card in place instead of moving the list. The
  // slot only collapses (once) when there is no next suggestion.
  const [spent, setSpent] = useState<{ s: ListSuggestion; phase: SlipPhase } | null>(null)
  const suggestions = spent
    ? [spent.s]
    : (suggestionsQuery.data ?? []).slice(0, MAX_SUGGESTIONS_SHOWN)

  // Items that replace a skeleton fade in; cached items just appear with the sheet.
  const itemsWereLoading = useRef(false)
  if (itemsQuery.isLoading) itemsWereLoading.current = true

  // Always derive items and sorted views before any early returns to keep hook order stable
  const items = itemsQuery.data ?? []
  const sortedItems = useMemo(() => {
    const copy = [...items]
    // Filter by completion, then by order
    copy.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      return (a.order || 0) - (b.order || 0)
    })
    return copy
  }, [items])

  const incompleteItems = useMemo(() => sortedItems.filter((it) => !it.completed), [sortedItems])

  // Item ids already shown for this list. A row not in the set is new and slides in;
  // the first load is recorded silently so the initial list doesn't animate row by row.
  const seenIds = useRef<{ listId: string; ids: Set<string> } | null>(null)
  useEffect(() => {
    if (!itemsQuery.isSuccess) return
    if (seenIds.current?.listId !== listId) seenIds.current = { listId, ids: new Set() }
    for (const it of items) seenIds.current.ids.add(it.item_id)
  }, [items, itemsQuery.isSuccess, listId])
  const isEntering = (id: string) =>
    seenIds.current?.listId === listId && !seenIds.current.ids.has(id)

  const incompleteGrouped = useMemo(() => {
    if (!groupByCat) return null
    const groups: Record<string, ListItem[]> = {}
    incompleteItems.forEach((it) => {
      const cat = it.category || 'Uncategorized'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(it)
    })
    return groups
  }, [incompleteItems, groupByCat])

  const completedItems = useMemo(() => sortedItems.filter((it) => it.completed), [sortedItems])
  const totalCount = items.length
  const completedCount = items.filter((it) => it.completed).length
  const incompleteCount = items.filter((it) => !it.completed).length
  // Everything got: the run is done.
  useEffect(() => {
    if (run.active && !run.stamped && incompleteCount === 0 && !itemsQuery.isLoading) landRunStamp()
  }, [run.active, run.stamped, incompleteCount, itemsQuery.isLoading, landRunStamp])
  // Sensors: touch (mobile long-press), mouse (desktop), keyboard (a11y)
  const sensors = useSensors(
    // Tolerance stays under ItemRow's SWIPE_START, so a finger that starts a swipe has
    // always cancelled the long-press first and a row can't lift mid-swipe.
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 5 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // While a row is lifted, swipe-to-delete stays out of the way (see ItemRow.reorderLock).
  const lockReorder = () => {
    reorderLock.active = true
  }
  const unlockReorder = () => {
    reorderLock.active = false
  }
  // Leaving the page mid-drag must not strand the lock and quietly disable swipes later.
  useEffect(() => unlockReorder, [])
  const onDragEndUnlocked = (e: DragEndEvent) => {
    unlockReorder()
    return onDragEnd(e)
  }
  const onDragEnd = async (e: DragEndEvent) => {
    const activeId = e.active.id as string
    const overId = (e.over?.id as string) || null
    if (!overId || activeId === overId) return
    const order = incompleteItems.map((it) => it.item_id)
    const from = order.indexOf(activeId)
    const to = order.indexOf(overId)
    if (from < 0 || to < 0) return

    // Compute new array after drag
    const nextOrder = [...order]
    nextOrder.splice(from, 1)
    nextOrder.splice(to, 0, activeId)

    // Derive prev/next ids for active item in new order
    const idx = nextOrder.indexOf(activeId)
    const prev_id = idx > 0 ? nextOrder[idx - 1] : undefined
    const next_id = idx < nextOrder.length - 1 ? nextOrder[idx + 1] : undefined

    // Optimistic reorder: cancel any current fetches, update query cache immediately
    const key = ['list-items', listId, includeCompleted]
    await qc.cancelQueries({ queryKey: ['list-items', listId] })

    const prevData = qc.getQueryData<ListItem[]>(key)
    if (prevData) {
      const map = new Map(prevData.map((it) => [it.item_id, it]))
      // Map new order to index so the local `sortedItems` derivation keeps them stable
      const nextIncomplete = nextOrder
        .map((id, index) => {
          const item = map.get(id)!
          return { ...item, order: index }
        })
        .filter(Boolean) as ListItem[]
      const nextCompleted = prevData.filter((it) => it.completed)
      qc.setQueryData<ListItem[]>(key, [...nextIncomplete, ...nextCompleted])
    }

    try {
      await reorderListItem(apiKey!, roomId!, listId, activeId, { prev_id, next_id })
      qc.invalidateQueries({ queryKey: ['list-items', listId] })
    } catch (err: any) {
      // Revert on failure
      if (prevData) qc.setQueryData<ListItem[]>(key, prevData)
      msgApi.error(errorMessage(err, 'Couldn’t move that item. Try again.'))
    }
  }

  // If the list disappears due to partner's vote while viewing, navigate home (avoid firing during refetch/errors)
  const hadListRef = useRef(false)
  useEffect(() => {
    if (listMeta) hadListRef.current = true
    if (listsQuery.isSuccess && !listsQuery.isFetching && hadListRef.current && !listMeta) {
      setRedirecting(true)
      show('List deleted.')
      navigate('/app', { replace: true })
    }
  }, [listsQuery.isSuccess, listsQuery.isFetching, listMeta, navigate])

  // Refetch only once the last optimistic mutation settles; an earlier refetch would return
  // server state that doesn't yet reflect the others and flash removed rows back.
  const inFlight = useRef(0)
  const settle = () => {
    inFlight.current -= 1
    if (inFlight.current === 0) {
      qc.invalidateQueries({ queryKey: ['list-items', listId] })
      // What is on the list changed, so what is worth suggesting may have too.
      qc.invalidateQueries({ queryKey: ['suggestions', roomId, listId] })
    }
  }

  // Server id -> the temporary id a row was first rendered with, so swapping in the
  // created item keeps the same React key (no remount, no replayed entrance).
  const rowKeys = useRef(new Map<string, string>())
  const tempSeq = useRef(0)
  const isTemp = (id: string) => id.startsWith('tmp-')

  // Keep suggestions current without a refetch: an added item moves to the front of the
  // pantry (or joins it) so it is the first suggestion next time.
  const bumpPantry = (created: ListItem) => {
    const key = created.description.trim().toLowerCase()
    qc.setQueryData<PantryItem[]>(['pantry', roomId], (prev) => {
      if (!prev) return prev
      const hit = prev.find((p) => p.description.trim().toLowerCase() === key)
      const entry: PantryItem = {
        description: created.description,
        category: created.category || hit?.category || '',
        quantity: created.quantity || hit?.quantity || '',
        unit: created.unit || hit?.unit || '',
        times_added: (hit?.common ? 0 : (hit?.times_added ?? 0)) + 1,
        last_added_at: created.created_at,
        common: false,
      }
      return [entry, ...prev.filter((p) => p !== hit)]
    })
  }

  // Adds appear instantly: insert a placeholder row, then swap in the server's item
  // (which carries the category) when the request returns.
  const onCreateItem = useStableCallback(
    async (p: { description: string; quantity?: string; unit?: string; source?: 'suggestion' }) => {
      const tempId = `tmp-${++tempSeq.current}`
      const now = new Date().toISOString()
      const maxOrder = items.reduce((m, x) => Math.max(m, x.order || 0), 0)
      const placeholder: ListItem = {
        item_id: tempId,
        list_id: listId,
        room_id: roomId!,
        description: p.description,
        quantity: p.quantity,
        unit: p.unit,
        completed: false,
        order: maxOrder + 1,
        created_at: now,
        updated_at: now,
      }
      inFlight.current += 1
      const rollback = await applyOptimistic((list) => [...list, placeholder])
      try {
        const created = await createListItem(apiKey!, roomId!, listId, p)
        bumpPantry(created)
        rowKeys.current.set(created.item_id, tempId)
        seenIds.current?.ids.add(created.item_id)
        for (const [key, data] of qc.getQueriesData<ListItem[]>({
          queryKey: ['list-items', listId],
        })) {
          if (data) {
            qc.setQueryData<ListItem[]>(
              key,
              data.map((x) =>
                x.item_id === tempId ? { ...created, order: created.order ?? x.order } : x,
              ),
            )
          }
        }
      } catch (e: any) {
        rollback()
        msgApi.error(errorMessage(e, 'Couldn’t add that item. Your text is still in the box.'))
        throw e
      } finally {
        settle()
      }
    },
  )

  const nudge = (name: 'nudge.shown' | 'nudge.tapped' | 'nudge.dismissed') =>
    track(name, {
      subject: { type: 'nudge', id: 'recurring' },
      container: { type: 'list', id: listId },
      props: { kind: 'recurring' },
    })

  // Taking or ignoring the slip pops it; the server is then asked what (if anything) comes next.
  const dropSuggestion = (key: string) =>
    qc.setQueryData<ListSuggestion[]>(suggestionsKey, (prev) => prev?.filter((s) => s.key !== key))

  // Retire a slip: pop it out, hold its slot while `work` (the add or ignore, then the refetch)
  // runs, then show the server's next answer in the same slot, or collapse the slot if there is none.
  const retireSuggestion = async (s: ListSuggestion, work: () => Promise<void>) => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    dropSuggestion(s.key)
    setSpent({ s, phase: reduced ? 'held' : 'leaving' })
    const popped = reduced
      ? Promise.resolve()
      : new Promise<void>((resolve) =>
          setTimeout(() => {
            setSpent((cur) => (cur ? { ...cur, phase: 'held' } : cur))
            resolve()
          }, SUGGESTION_EXIT_MS),
        )
    await Promise.all([popped, work()])
    const next = qc.getQueryData<ListSuggestion[]>(suggestionsKey)?.[0]
    if (next || reduced) return setSpent(null)
    setSpent({ s, phase: 'collapsing' })
    setTimeout(() => setSpent(null), SUGGESTION_COLLAPSE_MS)
  }

  const onAddSuggestion = useStableCallback(async (s: ListSuggestion) => {
    if (spent) return
    nudge('nudge.tapped')
    await retireSuggestion(s, async () => {
      try {
        await onCreateItem({
          description: s.description,
          quantity: s.quantity,
          unit: s.unit,
          source: 'suggestion',
        })
      } catch {
        // onCreateItem already rolled back and told the user; the refetch brings the slip back.
      }
      await qc.invalidateQueries({ queryKey: suggestionsKey })
    })
  })

  const onIgnoreSuggestion = useStableCallback(async (s: ListSuggestion) => {
    if (spent) return
    nudge('nudge.dismissed')
    await retireSuggestion(s, async () => {
      try {
        await ignoreListSuggestion(apiKey!, roomId!, listId, s.key, during)
      } catch {
        // fall through: the refetch puts the slip back if the ignore did not land
      }
      await qc.invalidateQueries({ queryKey: suggestionsKey })
    })
  })

  // nudge.shown once per slip per visit, not once per render.
  const shownKeys = useRef(new Set<string>())
  const suggestionKeys = suggestions.map((s) => s.key).join('\n')
  useEffect(() => {
    for (const key of suggestionKeys ? suggestionKeys.split('\n') : []) {
      if (shownKeys.current.has(key)) continue
      shownKeys.current.add(key)
      nudge('nudge.shown')
    }
  }, [suggestionKeys])

  // Optimistically rewrite every cached variant of this list's items; returns a rollback.
  const applyOptimistic = async (
    mutate: (items: ListItem[], withCompleted: boolean) => ListItem[],
  ) => {
    await qc.cancelQueries({ queryKey: ['list-items', listId] })
    const snapshot = qc.getQueriesData<ListItem[]>({ queryKey: ['list-items', listId] })
    for (const [key, data] of snapshot) {
      if (data) qc.setQueryData<ListItem[]>(key, mutate(data, key[2] === true))
    }
    return () => {
      for (const [key, data] of snapshot) qc.setQueryData<ListItem[]>(key, data)
    }
  }

  // Clear completed is deferred like a delete: the checked-off rows leave at once, the request
  // is sent when the toast closes (or the page is left), and Undo cancels it.
  const pendingClear = useRef<(() => Promise<void>) | null>(null)
  useEffect(() => {
    return () => void pendingClear.current?.()
  }, [])

  const onClearCompleted = async () => {
    if (pendingClear.current) return
    landRunStamp()
    inFlight.current += 1
    await applyOptimistic((items) => items.filter((x) => !x.completed))

    const commit = async () => {
      if (!pendingClear.current) return
      pendingClear.current = null
      try {
        await clearListItems(apiKey!, roomId!, listId)
      } catch (e: any) {
        msgApi.error(errorMessage(e, 'Couldn’t clear completed items. Try again.'))
      } finally {
        settle()
      }
    }
    const undo = () => {
      if (!pendingClear.current) return
      pendingClear.current = null
      msgApi.destroy(CLEAR_TOAST_KEY)
      settle()
    }
    pendingClear.current = commit
    msgApi.open({
      key: CLEAR_TOAST_KEY,
      type: 'info',
      duration: 5,
      onClose: () => void commit(),
      content: (
        <span className="undo-toast">
          Completed items cleared to pantry
          <Button kind="text" className="undo-btn" onClick={undo}>
            Undo
          </Button>
        </span>
      ),
    })
  }

  const onToggleComplete = useStableCallback(async (it: ListItem) => {
    if (isTemp(it.item_id)) return
    if (savingItemId === it.item_id || editingItemId === it.item_id) return
    const next = !it.completed
    if (next) run.check()
    inFlight.current += 1
    // Confetti and UI update immediately; the request reconciles afterwards.
    if (next) {
      const rect = checkboxRefs.current[it.item_id]?.getBoundingClientRect()
      if (rect) {
        confettiAt(rect.left + rect.width / 2, rect.top + rect.height / 2, { durationMs: 2000 })
      }
    }
    const rollback = await applyOptimistic((items, withCompleted) =>
      withCompleted || !next
        ? items.map((x) => (x.item_id === it.item_id ? { ...x, completed: next } : x))
        : items.filter((x) => x.item_id !== it.item_id),
    )
    try {
      await updateListItem(apiKey!, roomId!, listId, it.item_id, { completed: next })
    } catch (e: any) {
      rollback()
      msgApi.error(errorMessage(e, 'Couldn’t update that item. Try again.'))
    } finally {
      settle()
    }
  })

  // Deleting is deferred for a few seconds so it can be undone: the row leaves the list at
  // once, the request is sent when the toast closes (or the page is left).
  const pendingDeletes = useRef(new Map<string, () => Promise<void>>())
  useEffect(() => {
    if (listId) track('list.view', { subject: { type: 'list', id: listId } })
  }, [listId])
  useEffect(() => {
    const pending = pendingDeletes.current
    return () => {
      for (const commit of [...pending.values()]) void commit()
    }
  }, [])

  const onDeleteItem = useStableCallback(async (it: ListItem) => {
    if (isTemp(it.item_id)) return
    if (savingItemId === it.item_id) return
    const id = it.item_id
    if (pendingDeletes.current.has(id)) return
    inFlight.current += 1
    await applyOptimistic((items) => items.filter((x) => x.item_id !== id))

    const commit = async () => {
      if (!pendingDeletes.current.delete(id)) return
      try {
        await deleteListItem(apiKey!, roomId!, listId, id)
      } catch (e: any) {
        await applyOptimistic((items) =>
          items.some((x) => x.item_id === id) ? items : [...items, it],
        )
        msgApi.error(errorMessage(e, 'Couldn’t delete that item. Try again.'))
      } finally {
        settle()
      }
    }
    const undo = async () => {
      if (!pendingDeletes.current.delete(id)) return
      track('item.delete_undone', {
        subject: { type: 'item', id },
        container: { type: 'list', id: listId },
      })
      msgApi.destroy(id)
      await applyOptimistic((items) =>
        items.some((x) => x.item_id === id) ? items : [...items, it],
      )
      settle()
    }
    pendingDeletes.current.set(id, commit)
    msgApi.open({
      key: id,
      type: 'info',
      duration: 5,
      onClose: () => void commit(),
      content: (
        <span className="undo-toast">
          Removed {it.description}
          <Button kind="text" className="undo-btn" onClick={undo}>
            Undo
          </Button>
        </span>
      ),
    })
  })

  const startEdit = useStableCallback((it: ListItem) => {
    if (savingItemId || isTemp(it.item_id)) return
    setEditingItemId(it.item_id)
  })

  const submitEdit = useStableCallback(async (it: ListItem, next: string) => {
    const trimmed = next.trim()
    if (!trimmed) return

    // Smart parsing on edit
    const { description, quantity, unit } = parseInput(trimmed)

    const isSame =
      description === it.description && quantity === (it.quantity || '') && unit === (it.unit || '')

    if (isSame) {
      setEditingItemId(null)
      return
    }

    try {
      setSavingItemId(it.item_id)
      await updateListItem(apiKey!, roomId!, listId, it.item_id, {
        description,
        quantity,
        unit,
      })
      setEditingItemId(null)
      await qc.invalidateQueries({ queryKey: ['list-items', listId] })
    } catch (e: any) {
      msgApi.error(errorMessage(e, 'Couldn’t update that item. Try again.'))
    } finally {
      setSavingItemId(null)
    }
  })

  const myVote = (l?: List) => !!l?.deletion_votes && !!userId && !!l.deletion_votes[userId]
  const onVoteDelete = async () => {
    try {
      const res = await voteListDeletion(apiKey!, roomId!, listId)
      await qc.invalidateQueries({ queryKey: ['lists', roomId] })
      if (res.deleted) {
        setRedirecting(true)
        show('List deleted.')
        navigate('/app')
      }
    } catch (e: any) {
      msgApi.error(errorMessage(e, 'Couldn’t record your vote. Try again.'))
    }
  }
  const onCancelVote = async () => {
    try {
      await cancelListDeletion(apiKey!, roomId!, listId)
      await qc.invalidateQueries({ queryKey: ['lists', roomId] })
    } catch (e: any) {
      msgApi.error(errorMessage(e, 'Couldn’t cancel your vote. Try again.'))
    }
  }

  // Set the document title unconditionally (before any early returns)
  useDocumentTitle(listMeta?.name || 'List')
  // Follow the server's notes into the buffer, but never over unsaved typing: only when the
  // buffer still holds what the server last said (or we've switched lists). A slow save or a
  // housemate's edit landing mid-sentence would otherwise wipe what's being written.
  const syncedNotes = useRef<{ listId?: string; notes: string }>({ notes: '' })
  useEffect(() => {
    if (!listMeta) return
    const server = listMeta.notes || ''
    const prev = syncedNotes.current
    const switched = prev.listId !== listMeta.list_id
    setNotesText((buf) => (switched || buf === prev.notes ? server : buf))
    if (switched) setClearedNotes(null)
    syncedNotes.current = { listId: listMeta.list_id, notes: server }
  }, [listMeta?.list_id, listMeta?.notes])
  const notesTextRef = useRef(notesText)
  notesTextRef.current = notesText

  const isGroceryList = useMemo(() => {
    const name = listMeta?.name.toLowerCase() || ''
    return (
      name.includes('grocer') ||
      name.includes('shop') ||
      name.includes('pantry') ||
      name.includes('market') ||
      name.includes('food')
    )
  }, [listMeta?.name])

  const notesDirty = (listMeta?.notes || '') !== notesText
  useEffect(() => {
    if (!notesJustSaved) return
    const t = setTimeout(() => setNotesJustSaved(false), 1800)
    return () => clearTimeout(t)
  }, [notesJustSaved])
  const onNotesChange = (next: string) => {
    setNotesText(next)
    setClearedNotes(null)
    setNotesJustSaved(false)
  }
  const onClearNotes = () => {
    setClearedNotes(notesText)
    setNotesText('')
    setNotesJustSaved(false)
  }
  const onUndoClearNotes = () => {
    if (clearedNotes !== null) setNotesText(clearedNotes)
    setClearedNotes(null)
  }
  const onSaveNotes = async () => {
    if (!roomId || !listId || !notesDirty) return
    try {
      setNotesSaving(true)
      const saved = notesText
      await updateList(apiKey!, roomId, listId, { notes: saved })
      // Confirm from the save itself rather than waiting on a refetch round trip; the
      // refetch still runs in the background to pick up anything else that changed.
      qc.setQueryData<List[]>(['lists', roomId], (old) =>
        old?.map((l) => (l.list_id === listId ? { ...l, notes: saved } : l)),
      )
      void qc.invalidateQueries({ queryKey: ['lists', roomId] })
      setClearedNotes(null)
      // Typing carried on during the save: those words are still unsaved, so no "Saved".
      if (notesTextRef.current === saved) setNotesJustSaved(true)
    } catch (e: any) {
      msgApi.error(errorMessage(e, 'Couldn’t save your notes. They’re still here, so try again.'))
    } finally {
      setNotesSaving(false)
    }
  }

  const ago = timeAgo(listMeta?.updated_at)
  const updatedAgo = ago === 'less than a minute ago' ? 'just now' : ago

  const ready =
    !meQuery.isLoading && !listsQuery.isLoading && !itemsQuery.isLoading && !!roomId && !!listMeta

  // Items load inside the Items tab (it has its own skeleton), so a list already in the
  // cache from the house page renders at once, and its sticker can land mid-transition.
  if (meQuery.isLoading || listsQuery.isLoading || (itemsQuery.isLoading && !listMeta)) {
    return (
      <div className="container" aria-busy="true">
        <TopNav />
        <div className="route-skeleton">
          <HouseLoader label="Loading list" />
        </div>
      </div>
    )
  }
  if (!roomId || (!listMeta && !(redirecting || hadListRef.current))) {
    return (
      <div className="container">
        <Paper>
          <Alert
            type="error"
            message="We couldn’t find this list. It may have been deleted."
            showIcon
          />
          <div className="spacer" />
          <Button kind="quiet" onClick={() => navigate('/app')} icon={<ArrowLeft />}>
            Back to house
          </Button>
        </Paper>
      </div>
    )
  }
  if (!listMeta) {
    return (
      <div className="container">
        <Paper>Redirecting…</Paper>
      </div>
    )
  }

  const menuItems = [
    { key: 'clear-completed', label: 'Clear completed', icon: <Broom size={18} /> },
    { type: 'divider' as const },
    ...(myVote(listMeta)
      ? [{ key: 'cancel', label: 'Cancel delete vote', danger: true }]
      : [{ key: 'vote', label: 'Vote to delete list', danger: true }]),
  ]
  const onMenuClick = ({ key }: { key: string }) => {
    if (key === 'clear-completed') onClearCompleted()
    if (key === 'vote') {
      onVoteDelete()
      show('Vote recorded. The list is deleted once every housemate votes.')
    }
    if (key === 'cancel') {
      onCancelVote()
      show('Vote canceled.')
    }
  }
  const renderRow = (it: ListItem, variant: 'sortable' | 'plain' | 'completed', cat: boolean) => (
    <ItemRow
      key={rowKeys.current.get(it.item_id) ?? it.item_id}
      it={it}
      variant={variant}
      showCategory={cat}
      // Checked-off rows arriving from the server are old items, not new ones
      entering={variant !== 'completed' && isEntering(it.item_id)}
      editing={editingItemId === it.item_id}
      saving={savingItemId === it.item_id}
      onToggle={onToggleComplete}
      onDelete={onDeleteItem}
      onStartEdit={startEdit}
      onSubmitEdit={submitEdit}
      registerAnchor={registerAnchor}
    />
  )

  return (
    <div className="container">
      <TopNav
        back={
          fromTrip
            ? { to: `/app/trips/${fromTrip.id}`, label: fromTrip.label }
            : { to: '/app', label: houseQuery.data?.display_name || 'House' }
        }
      />
      {contextHolder}
      <PaperStack>
        {/* Bottom sheet: title + details + actions */}
        <Paper className="paper-meta">
          <div className="list-header-grid">
            <div className="list-header-title">
              <Typography.Title
                level={2}
                style={{ margin: 0, lineHeight: 1.2, display: 'flex', alignItems: 'center' }}
              >
                {listMeta.icon ? (
                  <span className="list-icon list-icon-title" aria-hidden>
                    {toEmoji(listMeta.icon)}
                  </span>
                ) : null}
                {listMeta.name}
              </Typography.Title>
              <Typography.Text className="list-meta">
                {itemsQuery.isLoading
                  ? ''
                  : incompleteCount > 0
                    ? `${incompleteCount} to get · `
                    : 'All done · '}
                updated {updatedAgo}
              </Typography.Text>
              {listMeta.description && (
                <Typography.Text className="list-description">
                  {listMeta.description}
                </Typography.Text>
              )}
            </div>
            <div className="list-actions">
              <Dropdown trigger={['click']} menu={{ items: menuItems, onClick: onMenuClick }}>
                <Button
                  kind="text"
                  iconOnly
                  icon={<DotsThreeVertical />}
                  aria-label="More list actions"
                />
              </Dropdown>
            </div>
          </div>
        </Paper>

        {/* Top sheet: tabs over list content */}
        <Paper className="paper-list">
          <div>
            <PillNav
              value={activeTab}
              onChange={(k) => setActiveTab(k as 'items' | 'notes')}
              extra={
                isGroceryList && activeTab === 'items' ? (
                  <button
                    type="button"
                    className="view-toggle"
                    aria-pressed={groupByCat}
                    onClick={() => setGroupByCat(!groupByCat)}
                    aria-label="Group by category"
                    title="Group by category"
                  >
                    <Rows size={20} weight={groupByCat ? 'bold' : 'regular'} aria-hidden />
                  </button>
                ) : null
              }
              items={[
                {
                  key: 'items',
                  label: (
                    <>
                      Items
                      {incompleteCount > 0 && <span className="tab-count">{incompleteCount}</span>}
                    </>
                  ),
                  children: (
                    <>
                      {runStamp && (
                        <RubberStamp
                          title={runStamp[0]}
                          lines={runStamp.slice(1)}
                          onDone={() => setRunStamp(null)}
                        />
                      )}
                      <SuggestionStack
                        suggestions={suggestions}
                        during={during}
                        phase={spent?.phase}
                        onAdd={onAddSuggestion}
                        onIgnore={onIgnoreSuggestion}
                      />
                      <Space
                        // Remount when the items arrive so a skeleton hands over with a fade
                        key={itemsQuery.isLoading ? 'loading' : 'ready'}
                        className={
                          !itemsQuery.isLoading && itemsWereLoading.current
                            ? 'items-space is-arriving'
                            : 'items-space'
                        }
                        direction="vertical"
                        style={{ width: '100%' }}
                        size="large"
                      >
                        {itemsQuery.isLoading ? (
                          <RowSkeleton variant="item" rows={4} label="Loading items" />
                        ) : items.length === 0 ? (
                          <div className="empty-state">
                            <Plus size={20} style={{ color: 'var(--brand-yellow)' }} />
                            <Typography.Text type="secondary">
                              No items yet. Add your first item below.
                            </Typography.Text>
                          </div>
                        ) : (
                          <>
                            {incompleteItems.length > 0 &&
                              (groupByCat && incompleteGrouped ? (
                                <div className="grouped-sections">
                                  {Object.entries(incompleteGrouped).map(([cat, catItems]) => (
                                    <div
                                      key={cat}
                                      className="category-section"
                                      style={{ marginBottom: 24 }}
                                    >
                                      <div
                                        className="category-section-header"
                                        style={{ marginBottom: 8 }}
                                      >
                                        <Tag
                                          className={`category-tag ${getCategoryClass(cat)}`}
                                          style={{
                                            fontSize: '12px',
                                            padding: '2px 10px',
                                            fontWeight: 600,
                                          }}
                                        >
                                          {cat.toUpperCase()}
                                        </Tag>
                                      </div>
                                      <AntList itemLayout="horizontal" className="items-list">
                                        {catItems.map((it) => renderRow(it, 'plain', false))}
                                      </AntList>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <DndContext
                                  sensors={sensors}
                                  onDragStart={lockReorder}
                                  onDragEnd={onDragEndUnlocked}
                                  onDragCancel={unlockReorder}
                                >
                                  <SortableContext
                                    items={incompleteItems.map((it) => it.item_id)}
                                    strategy={verticalListSortingStrategy}
                                  >
                                    <AntList itemLayout="horizontal" className="items-list">
                                      {incompleteItems.map((it) =>
                                        renderRow(it, 'sortable', isGroceryList),
                                      )}
                                    </AntList>
                                  </SortableContext>
                                </DndContext>
                              ))}
                            {includeCompleted && completedItems.length > 0 && (
                              <>
                                <div className="completed-header">
                                  <span>Completed ({completedItems.length})</span>
                                </div>
                                <AntList
                                  itemLayout="horizontal"
                                  className="items-list completed-list"
                                >
                                  {completedItems.map((it) =>
                                    renderRow(it, 'completed', isGroceryList),
                                  )}
                                </AntList>
                              </>
                            )}
                          </>
                        )}
                      </Space>
                      <button
                        type="button"
                        className="completed-toggle"
                        aria-expanded={includeCompleted}
                        aria-busy={itemsQuery.isPlaceholderData || undefined}
                        onClick={() => setIncludeCompleted(!includeCompleted)}
                      >
                        {includeCompleted ? 'Hide checked-off items' : 'Show checked-off items'}
                      </button>
                      {/* Outside the Space wrapper so sticky pins to the whole tab pane,
                        keeping the bar on screen while scrolling a long list. */}
                      <AddItemBar
                        onCreate={onCreateItem}
                        pantry={pantryQuery.data}
                        listId={listId}
                      />
                    </>
                  ),
                },
                {
                  key: 'notes',
                  label: (
                    <>
                      Notes
                      {listMeta.notes?.trim() && (
                        <span className="tab-dot" role="img" aria-label="has notes" />
                      )}
                    </>
                  ),
                  children: (
                    <Space direction="vertical" style={{ width: '100%' }} size="large">
                      <Input.TextArea
                        className="notes-textarea"
                        value={notesText}
                        onChange={(e) => onNotesChange(e.target.value)}
                        placeholder="Write notes for this list"
                        rows={12}
                      />
                      <div className="notes-actions">
                        {clearedNotes !== null ? (
                          <Button
                            key="undo"
                            kind="text"
                            className="notes-clear is-undo"
                            onClick={onUndoClearNotes}
                            icon={<ArrowCounterClockwise size={18} />}
                          >
                            Undo clear
                          </Button>
                        ) : (
                          <Button
                            key="clear"
                            kind="text"
                            className="notes-clear"
                            onClick={onClearNotes}
                            disabled={!notesText.trim()}
                            icon={<Eraser size={18} />}
                          >
                            Clear all
                          </Button>
                        )}
                        <Button
                          kind="key"
                          className={notesJustSaved ? 'notes-save is-saved' : 'notes-save'}
                          onClick={onSaveNotes}
                          disabled={!notesDirty || notesSaving}
                          icon={
                            notesJustSaved ? (
                              <Check
                                key="saved"
                                size={18}
                                weight="bold"
                                className="notes-saved-check"
                              />
                            ) : (
                              <FloppyDisk size={18} />
                            )
                          }
                        >
                          {notesJustSaved ? 'Saved' : notesSaving ? 'Saving…' : 'Save'}
                        </Button>
                      </div>
                    </Space>
                  ),
                },
              ]}
            />
          </div>
        </Paper>
      </PaperStack>
    </div>
  )
}
