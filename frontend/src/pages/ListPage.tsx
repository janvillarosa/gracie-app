import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@auth/AuthProvider'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getMe,
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
} from '@api/endpoints'
import type { List, ListItem } from '@api/types'
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
  Eye,
  EyeSlash,
  DotsThreeVertical,
  FloppyDisk,
  X,
  Broom,
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
  const navigate = useNavigate()
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
      msgApi.error(err?.message || 'Failed to reorder item')
    }
  }

  // If the list disappears due to partner's vote while viewing, navigate home (avoid firing during refetch/errors)
  const hadListRef = useRef(false)
  useEffect(() => {
    if (listMeta) hadListRef.current = true
    if (listsQuery.isSuccess && !listsQuery.isFetching && hadListRef.current && !listMeta) {
      setRedirecting(true)
      show('List is successfully deleted')
      navigate('/app', { replace: true })
    }
  }, [listsQuery.isSuccess, listsQuery.isFetching, listMeta, navigate])

  const onCreateItem = useStableCallback(
    async (p: { description: string; quantity?: string; unit?: string }) => {
      try {
        await createListItem(apiKey!, roomId!, listId, p)
        qc.invalidateQueries({ queryKey: ['list-items', listId] })
      } catch (e: any) {
        msgApi.error(e?.message || 'Failed to add item')
        throw e
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
      msgApi.error(e?.message || 'Failed to clear items')
    }
  }

  const onToggleComplete = useStableCallback(async (it: ListItem) => {
    if (savingItemId === it.item_id || editingItemId === it.item_id) return
    const next = !it.completed
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
      msgApi.error(e?.message || 'Failed to update item')
    } finally {
      qc.invalidateQueries({ queryKey: ['list-items', listId] })
    }
  })

  const onDeleteItem = useStableCallback(async (it: ListItem) => {
    if (savingItemId === it.item_id) return
    const rollback = await applyOptimistic((items) => items.filter((x) => x.item_id !== it.item_id))
    try {
      await deleteListItem(apiKey!, roomId!, listId, it.item_id)
    } catch (e: any) {
      rollback()
      msgApi.error(e?.message || 'Failed to delete item')
    } finally {
      qc.invalidateQueries({ queryKey: ['list-items', listId] })
    }
  })

  const startEdit = useStableCallback((it: ListItem) => {
    if (savingItemId) return
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
      msgApi.error(e?.message || 'Failed to update item')
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
        show('List is successfully deleted')
        navigate('/app')
      }
    } catch (e: any) {
      msgApi.error(e?.message || 'Failed to vote deletion')
    }
  }
  const onCancelVote = async () => {
    try {
      await cancelListDeletion(apiKey!, roomId!, listId)
      await qc.invalidateQueries({ queryKey: ['lists', roomId] })
    } catch (e: any) {
      msgApi.error(e?.message || 'Failed to cancel vote')
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
      msgApi.success('Notes saved')
    } catch (e: any) {
      msgApi.error(e?.message || 'Failed to save notes')
    } finally {
      setNotesSaving(false)
    }
  }

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
      <div className="container">
        <Card>Loading…</Card>
      </div>
    )
  }
  if (!roomId || (!listMeta && !(redirecting || hadListRef.current))) {
    return (
      <div className="container">
        <Card>
          <Alert type="error" message="List not found." showIcon />
          <div className="spacer" />
          <Button onClick={() => navigate('/app')} icon={<ArrowLeft />}>
            Back to House
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
    {
      key: 'toggle-completed',
      label: includeCompleted ? 'Hide completed' : 'Show completed',
      icon: includeCompleted ? <EyeSlash size={18} /> : <Eye size={18} />,
    },
    { key: 'clear-completed', label: 'Clear completed', icon: <Broom size={18} /> },
    { type: 'divider' as const },
    ...(myVote(listMeta)
      ? [{ key: 'cancel', label: 'Cancel delete vote', danger: true }]
      : [{ key: 'vote', label: 'Vote to delete', danger: true }]),
  ]
  const onMenuClick = ({ key }: { key: string }) => {
    if (key === 'toggle-completed') setIncludeCompleted(!includeCompleted)
    if (key === 'clear-completed') onClearCompleted()
    if (key === 'vote') {
      onVoteDelete()
      show('Vote recorded')
    }
    if (key === 'cancel') {
      onCancelVote()
      show('Vote canceled')
    }
  }
  const groupLabel = groupByCat
    ? isMobile
      ? 'Ungroup'
      : 'Ungroup categories'
    : isMobile
      ? 'Group'
      : 'Group by category'

  const renderRow = (it: ListItem, variant: 'sortable' | 'plain' | 'completed', cat: boolean) => (
    <ItemRow
      key={it.item_id}
      it={it}
      variant={variant}
      showCategory={cat}
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
      <TopNav />
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
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 44,
                      height: 44,
                      background: 'var(--panel-subtle)',
                      border: '1px solid var(--border)',
                      borderRadius: '50%',
                      fontSize: 22,
                      flexShrink: 0,
                      marginRight: 12,
                    }}
                  >
                    {toEmoji(listMeta.icon)}
                  </div>
                ) : null}
                {listMeta.name}
              </Typography.Title>
              <Typography.Text className="list-meta">
                Updated {timeAgo(listMeta.updated_at)}
              </Typography.Text>
              {incompleteCount > 0 && (
                <Typography.Text className="list-meta">
                  {incompleteCount === 1
                    ? '1 unchecked item'
                    : `${incompleteCount} unchecked items`}
                </Typography.Text>
              )}
              {listMeta.description && (
                <Typography.Text className="list-description">
                  {listMeta.description}
                </Typography.Text>
              )}
            </div>
            <div className="list-actions">
              {isGroceryList && (
                <Button
                  type={groupByCat ? 'primary' : 'default'}
                  shape="round"
                  onClick={() => setGroupByCat(!groupByCat)}
                >
                  {groupLabel}
                </Button>
              )}
              <Button onClick={() => navigate('/app')} icon={<ArrowLeft />} shape="round">
                Back
              </Button>
              <Dropdown trigger={['click']} menu={{ items: menuItems, onClick: onMenuClick }}>
                <Button icon={<DotsThreeVertical />} type="text" shape="circle" aria-label="More" />
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
              items={[
                {
                  key: 'items',
                  label: 'Items',
                  children: (
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
                              <AntList itemLayout="horizontal" className="items-list">
                                {completedItems.map((it) =>
                                  renderRow(it, 'completed', isGroceryList),
                                )}
                              </AntList>
                            </>
                          )}
                        </>
                      )}
                      {/* Sticky Add Bar at bottom (always visible) */}
                      <AddItemBar onCreate={onCreateItem} />
                    </Space>
                  ),
                },
                {
                  key: 'notes',
                  label: 'Notes',
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
