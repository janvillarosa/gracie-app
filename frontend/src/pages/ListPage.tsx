import React, { useEffect, useMemo, useRef, useState } from 'react'
import { errorMessage } from '@lib/errors'
import { useParams } from 'react-router-dom'
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
} from '@api/endpoints'
import type { List, ListItem, PantryItem } from '@api/types'
import {
  Card,
  Typography,
  Space,
  Button,
  Input,
  List as AntList,
  Grid,
  Dropdown,
  message,
  Skeleton,
  Alert,
  Tabs,
  Tag,
} from 'antd'
import {
  ArrowLeft,
  Plus,
  DotsThreeVertical,
  FloppyDisk,
  X,
  Broom,
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
import { ItemRow } from '@components/ItemRow'
import { AddItemBar } from '@components/AddItemBar'
import { TopNav } from '@components/TopNav'

export const ListPage: React.FC = () => {
  const { apiKey } = useAuth()
  const navigate = useTransitionNavigate()
  const { listId = '' } = useParams()
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
  const tabsWrapRef = useRef<HTMLDivElement | null>(null)
  const [tabVars, setTabVars] = useState<React.CSSProperties>({})

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
  // Sensors: touch (mobile long-press), mouse (desktop), keyboard (a11y)
  const sensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 10 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

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
    if (inFlight.current === 0) qc.invalidateQueries({ queryKey: ['list-items', listId] })
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
    async (p: { description: string; quantity?: string; unit?: string }) => {
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

  const onClearCompleted = async () => {
    try {
      await clearListItems(apiKey!, roomId!, listId)
      await qc.invalidateQueries({ queryKey: ['list-items', listId] })
      msgApi.success('Completed items cleared to pantry')
    } catch (e: any) {
      msgApi.error(errorMessage(e, 'Couldn’t clear completed items. Try again.'))
    }
  }

  const onToggleComplete = useStableCallback(async (it: ListItem) => {
    if (isTemp(it.item_id)) return
    if (savingItemId === it.item_id || editingItemId === it.item_id) return
    const next = !it.completed
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
          <button type="button" className="undo-btn" onClick={undo}>
            Undo
          </button>
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
  // Sync local notes buffer with server when loading or switching lists
  useEffect(() => {
    if (listMeta) setNotesText(listMeta.notes || '')
  }, [listMeta?.list_id, listMeta?.notes])

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
  const onSaveNotes = async () => {
    if (!roomId || !listId || !notesDirty) return
    try {
      setNotesSaving(true)
      await updateList(apiKey!, roomId, listId, { notes: notesText })
      await qc.invalidateQueries({ queryKey: ['lists', roomId] })
      msgApi.success('Notes saved.')
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

  // Slide the pill indicator under the active tab. A ResizeObserver replaces the window
  // resize listener so we only measure when the tab strip actually changes size.
  useEffect(() => {
    const wrap = tabsWrapRef.current
    if (!ready || !wrap) return
    const list = wrap.querySelector('.ant-tabs-nav .ant-tabs-nav-list') as HTMLElement | null
    if (!list) return
    const update = () => {
      const active = wrap.querySelector('.ant-tabs-nav .ant-tabs-tab-active') as HTMLElement | null
      if (!active) return
      const lr = list.getBoundingClientRect()
      const ar = active.getBoundingClientRect()
      const left = `${Math.max(0, ar.left - lr.left)}px`
      const width = `${Math.max(0, ar.width)}px`
      setTabVars((prev) =>
        (prev as any)['--tab-x'] === left && (prev as any)['--tab-w'] === width
          ? prev
          : { ['--tab-x' as any]: left, ['--tab-w' as any]: width },
      )
    }
    const id = requestAnimationFrame(update)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(list)
    return () => {
      cancelAnimationFrame(id)
      ro?.disconnect()
    }
  }, [activeTab, ready])

  if (meQuery.isLoading || listsQuery.isLoading || itemsQuery.isLoading) {
    return (
      <div className="container" aria-busy="true">
        <TopNav />
        <div className="route-skeleton" role="status" aria-label="Loading list" />
      </div>
    )
  }
  if (!roomId || (!listMeta && !(redirecting || hadListRef.current))) {
    return (
      <div className="container">
        <Card>
          <Alert
            type="error"
            message="We couldn’t find this list. It may have been deleted."
            showIcon
          />
          <div className="spacer" />
          <Button onClick={() => navigate('/app')} icon={<ArrowLeft />}>
            Back to house
          </Button>
        </Card>
      </div>
    )
  }
  if (!listMeta) {
    return (
      <div className="container">
        <Card>Redirecting…</Card>
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
      entering={isEntering(it.item_id)}
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
      <TopNav back={{ to: '/app', label: houseQuery.data?.display_name || 'House' }} />
      {contextHolder}
      <div className="paper-stack">
        {/* Bottom sheet: title + details + actions */}
        <Card className="paper-card paper-meta">
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
                {incompleteCount > 0 ? `${incompleteCount} to get · ` : 'All done · '}
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
                  icon={<DotsThreeVertical />}
                  type="text"
                  shape="circle"
                  aria-label="More list actions"
                />
              </Dropdown>
            </div>
          </div>
        </Card>

        {/* Top sheet: tabs over list content */}
        <Card className="paper-card paper-list">
          <div ref={tabsWrapRef}>
            <Tabs
              className="list-tabs"
              style={tabVars}
              activeKey={activeTab}
              onChange={(k) => setActiveTab(k as 'items' | 'notes')}
              tabBarExtraContent={{
                right:
                  isGroceryList && activeTab === 'items' ? (
                    <button
                      type="button"
                      className="view-toggle"
                      aria-pressed={groupByCat}
                      onClick={() => setGroupByCat(!groupByCat)}
                    >
                      <Rows size={16} aria-hidden />
                      <span>
                        <span className="view-toggle-by">By </span>
                        <span className="view-toggle-word">category</span>
                      </span>
                    </button>
                  ) : null,
              }}
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
                      <Space direction="vertical" style={{ width: '100%' }} size="large">
                        {itemsQuery.isLoading ? (
                          <Skeleton active paragraph={{ rows: 4 }} />
                        ) : items.length === 0 ? (
                          <div className="empty-state">
                            <Plus size={20} style={{ color: 'var(--color-primary)' }} />
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
                                <DndContext sensors={sensors} onDragEnd={onDragEnd}>
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
                        onClick={() => setIncludeCompleted(!includeCompleted)}
                      >
                        {includeCompleted ? 'Hide checked-off items' : 'Show checked-off items'}
                      </button>
                      {/* Outside the Space wrapper so sticky pins to the whole tab pane,
                        keeping the bar on screen while scrolling a long list. */}
                      <AddItemBar onCreate={onCreateItem} pantry={pantryQuery.data} />
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
                        onChange={(e) => setNotesText(e.target.value)}
                        placeholder="Write notes for this list"
                        rows={12}
                      />
                      <div className="notes-actions">
                        <Button
                          danger
                          onClick={() => setNotesText('')}
                          disabled={!notesText.trim()}
                          icon={<X />}
                          shape="round"
                        >
                          Clear all
                        </Button>
                        <Button
                          type="primary"
                          onClick={onSaveNotes}
                          disabled={!notesDirty || notesSaving}
                          icon={<FloppyDisk />}
                          shape="round"
                        >
                          Save
                        </Button>
                      </div>
                    </Space>
                  ),
                },
              ]}
            />
          </div>
        </Card>
      </div>
    </div>
  )
}
