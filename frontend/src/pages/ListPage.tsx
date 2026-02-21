import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@auth/AuthProvider'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMe, getListItems, getLists, createListItem, updateListItem, deleteListItem, voteListDeletion, cancelListDeletion, reorderListItem, updateList, clearListItems, getRoomPantry } from '@api/endpoints'
import type { List, ListItem, PantryItem } from '@api/types'
import { Card, Typography, Space, Button, Input, Checkbox, List as AntList, Grid, Dropdown, message, Skeleton, Alert, Tabs, Tag } from 'antd'
import { ArrowLeft, Trash, Plus, Eye, EyeSlash, DotsThreeVertical, DotsSixVertical, FloppyDisk, X, Broom } from '@phosphor-icons/react'
import { DndContext, TouchSensor, MouseSensor, KeyboardSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toEmoji } from '../icons'
import { confettiAt } from '@lib/confetti'
import { InlineEditText } from '@components/InlineEditText'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import { TopNav } from '@components/TopNav'

export const ListPage: React.FC = () => {
  const { apiKey } = useAuth()
  const navigate = useNavigate()
  const { listId = '' } = useParams()
  const [includeCompleted, setIncludeCompleted] = useState(false)
  const [newDesc, setNewDesc] = useState('')
  const [groupByCat, setGroupByCat] = useState(() => {
    const saved = localStorage.getItem('gracie_group_by_cat')
    return saved === 'true'
  })

  useEffect(() => {
    localStorage.setItem('gracie_group_by_cat', String(groupByCat))
  }, [groupByCat])

  const addRef = useRef<any>(null)

  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [savingItemId, setSavingItemId] = useState<string | null>(null)
  const checkboxRefs = useRef<Record<string, HTMLElement | null>>({})
  const setCheckboxRef = (id: string) => (el: HTMLElement | null) => { checkboxRefs.current[id] = el }
  const qc = useQueryClient()
  // Breakpoints hook must be called before any early returns
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  // antd message for toasts
  const [msgApi, contextHolder] = message.useMessage()
  const show = (msg: string) => { msgApi.info(msg) }
  const [redirecting, setRedirecting] = useState(false)
  const [activeTab, setActiveTab] = useState<'items' | 'notes'>('items')
  const [notesText, setNotesText] = useState('')
  const [notesSaving, setNotesSaving] = useState(false)
  const tabsWrapRef = useRef<HTMLDivElement | null>(null)
  const [tabVars, setTabVars] = useState<React.CSSProperties>({})

  const timeAgo = (iso: string | Date | undefined) => {
    if (!iso) return 'less than a minute ago'
    const d = typeof iso === 'string' ? new Date(iso) : iso
    const now = new Date()
    const diffMs = d.getTime() - now.getTime()
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    const sec = Math.round(diffMs / 1000)
    const min = Math.round(sec / 60)
    const hr = Math.round(min / 60)
    const day = Math.round(hr / 24)
    if (Math.abs(sec) < 60) return 'less than a minute ago'
    if (Math.abs(min) < 60) return rtf.format(min, 'minute')
    if (Math.abs(hr) < 24) return rtf.format(hr, 'hour')
    return rtf.format(day, 'day')
  }

  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => getMe(apiKey!) })
  const roomId = meQuery.data?.room_id as string | undefined
  const userId = meQuery.data?.user_id as string | undefined

  const parseMs = (v: any, def: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : def }
  const listsQuery = useQuery({
    queryKey: ['lists', roomId],
    queryFn: () => getLists(apiKey!, roomId!),
    enabled: !!roomId,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 5_000,
  })
  const listMeta: List | undefined = useMemo(() => listsQuery.data?.find(l => l.list_id === listId), [listsQuery.data, listId])
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


  const incompleteItems = useMemo(() => sortedItems.filter(it => !it.completed), [sortedItems])

  const incompleteGrouped = useMemo(() => {
    if (!groupByCat) return null
    const groups: Record<string, ListItem[]> = {}
    incompleteItems.forEach(it => {
      const cat = it.category || 'Uncategorized'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(it)
    })
    return groups
  }, [incompleteItems, groupByCat])

  const completedItems = useMemo(() => sortedItems.filter(it => it.completed), [sortedItems])
  const totalCount = items.length
  const completedCount = items.filter(it => it.completed).length
  const incompleteCount = items.filter(it => !it.completed).length
  // Sensors: touch (mobile long-press), mouse (desktop), keyboard (a11y)
  const sensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 10 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const onDragEnd = async (e: DragEndEvent) => {
    const activeId = e.active.id as string
    const overId = (e.over?.id as string) || null
    if (!overId || activeId === overId) return
    const order = incompleteItems.map(it => it.item_id)
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
      const map = new Map(prevData.map(it => [it.item_id, it]))
      // Map new order to index so the local `sortedItems` derivation keeps them stable
      const nextIncomplete = nextOrder.map((id, index) => {
        const item = map.get(id)!
        return { ...item, order: index }
      }).filter(Boolean) as ListItem[]
      const nextCompleted = prevData.filter(it => it.completed)
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

  const SortableRow: React.FC<{ it: ListItem; children: React.ReactNode }> = ({ it, children }) => {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: it.item_id })
    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    } as React.CSSProperties
    return (
      <div ref={setNodeRef} style={style} className="sortable-row">
        <span className="drag-handle" {...attributes} {...listeners} aria-label="Drag to reorder"><DotsSixVertical /></span>
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    )
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

  const parseInput = (input: string) => {
    // Simple regex for quantity and unit parsing
    // Examples: "3 bags Milk", "1.5kg Beef", "2 Bottles Water", "Milk"
    const regex = /^([\d.]+)?\s*([a-zA-Z]+)?\s+(.+)$/
    const match = input.match(regex)
    if (match) {
      const quantity = match[1] || ""
      const unit = match[2] || ""
      const description = match[3] || ""
      // If we found a unit but it looks like a common non-unit word, maybe it's part of description
      const units = ['kg', 'g', 'lb', 'oz', 'bag', 'bags', 'bottle', 'bottles', 'box', 'boxes', 'pack', 'packs', 'can', 'cans']
      if (unit && !units.includes(unit.toLowerCase()) && !quantity) {
        return { description: input.trim(), quantity: "", unit: "" }
      }
      return { description, quantity, unit }
    }
    return { description: input.trim(), quantity: "", unit: "" }
  }

  const onCreateItem = (val?: string) => {
    const text = (val || newDesc).trim()
    if (!text) return
    const { description, quantity, unit } = parseInput(text)
    if (!description) return

    setNewDesc('')
    requestAnimationFrame(() => {
      addRef.current?.focus()
    })

    createListItem(apiKey!, roomId!, listId, { description, quantity, unit })
      .then(() => {
        qc.invalidateQueries({ queryKey: ['list-items', listId] })
      })
      .catch((e: any) => {
        setNewDesc(text)
        addRef.current?.focus()
        msgApi.error(e?.message || 'Failed to add item')
      })
  }

  const onClearCompleted = async () => {
    try {
      await clearListItems(apiKey!, roomId!, listId)
      await qc.invalidateQueries({ queryKey: ['list-items', listId] })
      msgApi.success('Completed items cleared to pantry')
    } catch (e: any) { msgApi.error(e?.message || 'Failed to clear items') }
  }


  const onToggleComplete = async (it: ListItem) => {
    if (savingItemId === it.item_id || editingItemId === it.item_id) return
    try {
      await updateListItem(apiKey!, roomId!, listId, it.item_id, { completed: !it.completed })
      // Play confetti when marking complete
      if (!it.completed) {
        const el = checkboxRefs.current[it.item_id]
        const rect = el?.getBoundingClientRect()
        if (rect) {
          confettiAt(rect.left + rect.width / 2, rect.top + rect.height / 2, { durationMs: 2000 })
        }
      }
      await qc.invalidateQueries({ queryKey: ['list-items', listId] })
    } catch (e: any) { msgApi.error(e?.message || 'Failed to update item') }
  }

  const onDeleteItem = async (it: ListItem) => {
    if (savingItemId === it.item_id) return
    try {
      await deleteListItem(apiKey!, roomId!, listId, it.item_id)
      await qc.invalidateQueries({ queryKey: ['list-items', listId] })
    } catch (e: any) { msgApi.error(e?.message || 'Failed to delete item') }
  }

  const startEdit = (it: ListItem) => {
    if (savingItemId) return
    setEditingItemId(it.item_id)
  }

  const submitEdit = async (it: ListItem, next: string) => {
    const trimmed = next.trim()
    if (!trimmed) return

    // Smart parsing on edit
    const { description, quantity, unit } = parseInput(trimmed)

    const isSame = description === it.description &&
      quantity === (it.quantity || "") &&
      unit === (it.unit || "")

    if (isSame) { setEditingItemId(null); return }

    try {
      setSavingItemId(it.item_id)
      await updateListItem(apiKey!, roomId!, listId, it.item_id, {
        description,
        quantity,
        unit
      })
      setEditingItemId(null)
      await qc.invalidateQueries({ queryKey: ['list-items', listId] })
    } catch (e: any) {
      msgApi.error(e?.message || 'Failed to update item')
    } finally {
      setSavingItemId(null)
    }
  }

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
    } catch (e: any) { msgApi.error(e?.message || 'Failed to vote deletion') }
  }
  const onCancelVote = async () => {
    try {
      await cancelListDeletion(apiKey!, roomId!, listId)
      await qc.invalidateQueries({ queryKey: ['lists', roomId] })
    } catch (e: any) { msgApi.error(e?.message || 'Failed to cancel vote') }
  }

  // Set the document title unconditionally (before any early returns)
  useDocumentTitle(listMeta?.name || 'List')
  // Sync local notes buffer with server when loading or switching lists
  useEffect(() => {
    if (listMeta) setNotesText(listMeta.notes || '')
  }, [listMeta?.list_id, listMeta?.notes])

  const isGroceryList = useMemo(() => {
    const name = listMeta?.name.toLowerCase() || ''
    return name.includes('grocer') || name.includes('shop') || name.includes('pantry') || name.includes('market') || name.includes('food')
  }, [listMeta?.name])

  const getCategoryClass = (cat?: string) => {
    if (!cat) return 'cat-general'
    const c = cat.toLowerCase()
    if (c.includes('produce')) return 'cat-produce'
    if (c.includes('dairy') || c.includes('egg')) return 'cat-dairy'
    if (c.includes('bakery') || c.includes('grain')) return 'cat-bakery' // Bakery exists as Grains & Bakery
    if (c.includes('meat') || c.includes('seafood')) return 'cat-meat'
    if (c.includes('frozen')) return 'cat-frozen'
    if (c.includes('plant')) return 'cat-plant'
    if (c.includes('pantry')) return 'cat-pantry'
    if (c.includes('beverage')) return 'cat-beverages'
    if (c.includes('household')) return 'cat-household'
    return 'cat-general'
  }

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

  // Animate sliding pill indicator for tabs by updating CSS variables
  useEffect(() => {
    const update = () => {
      const wrap = tabsWrapRef.current
      if (!wrap) return
      const list = wrap.querySelector('.ant-tabs-nav .ant-tabs-nav-list') as HTMLElement | null
      const active = wrap.querySelector('.ant-tabs-nav .ant-tabs-tab-active') as HTMLElement | null
      if (!list || !active) return
      const lr = list.getBoundingClientRect()
      const ar = active.getBoundingClientRect()
      const left = Math.max(0, ar.left - lr.left)
      const width = Math.max(0, ar.width)
      setTabVars({ ['--tab-x' as any]: `${left}px`, ['--tab-w' as any]: `${width}px` })
    }
    const id = requestAnimationFrame(update)
    const onResize = () => update()
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', onResize) }
  }, [activeTab, screens.md])

  if (meQuery.isLoading || listsQuery.isLoading || itemsQuery.isLoading) {
    return <div className="container"><Card>Loading…</Card></div>
  }
  if (!roomId) {
    return <div className="container"><Card><Alert type="error" message="List not found." showIcon /><div className="spacer" /><Button onClick={() => navigate('/app')} icon={<ArrowLeft />}>Back to House</Button></Card></div>
  }
  if (!listMeta) {
    if (redirecting || hadListRef.current) {
      return <div className="container"><Card>Redirecting…</Card></div>
    }
    return <div className="container"><Card><Alert type="error" message="List not found." showIcon /><div className="spacer" /><Button onClick={() => navigate('/app')} icon={<ArrowLeft />}>Back to House</Button></Card></div>
  }

  return (
    <div className="container">
      <TopNav />
      {contextHolder}
      <div className="paper-stack">
        {/* Bottom sheet: title + details + actions */}
        <Card className="paper-card paper-meta">
          {isMobile ? (
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <div className="list-header-grid">
                <div className="list-header-title">
                  <Typography.Title level={2} style={{ margin: 0, lineHeight: 1.2 }}>
                    {listMeta.icon ? <span style={{ marginRight: 10 }}>{toEmoji(listMeta.icon)}</span> : null}
                    {listMeta.name}
                  </Typography.Title>
                  <Typography.Text className="list-meta">Updated {timeAgo(listMeta.updated_at)}</Typography.Text>
                  {incompleteCount > 0 && (
                    <Typography.Text className="list-meta">
                      {incompleteCount === 1 ? '1 unchecked item' : `${incompleteCount} unchecked items`}
                    </Typography.Text>
                  )}
                  {listMeta.description && (
                    <Typography.Text className="list-description">{listMeta.description}</Typography.Text>
                  )}
                </div>
                <div className="list-actions">
                  {isGroceryList && (
                    <Button
                      type={groupByCat ? 'primary' : 'default'}
                      onClick={() => setGroupByCat(!groupByCat)}
                    >
                      {groupByCat ? 'Ungroup' : 'Group'}
                    </Button>
                  )}
                  <Button onClick={() => navigate('/app')} icon={<ArrowLeft />}>Back</Button>
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: [
                        {
                          key: 'toggle-completed',
                          label: includeCompleted ? 'Hide completed' : 'Show completed',
                          icon: includeCompleted ? <EyeSlash size={18} /> : <Eye size={18} />
                        },
                        {
                          key: 'clear-completed',
                          label: 'Clear completed',
                          icon: <Broom size={18} />
                        },
                        { type: 'divider' },
                        ...(myVote(listMeta)
                          ? [{ key: 'cancel', label: 'Cancel delete vote', danger: true }]
                          : [{ key: 'vote', label: 'Vote to delete', danger: true }]),
                      ],
                      onClick: ({ key }) => {
                        if (key === 'toggle-completed') setIncludeCompleted(!includeCompleted);
                        if (key === 'clear-completed') onClearCompleted();
                        if (key === 'vote') { onVoteDelete(); show('Vote recorded'); }
                        if (key === 'cancel') { onCancelVote(); show('Vote canceled'); }
                      },
                    }}
                  >
                    <Button icon={<DotsThreeVertical />} aria-label="More" />
                  </Dropdown>
                </div>
              </div>
            </Space>
          ) : (
            <div className="list-header-grid">
              <div className="list-header-title">
                <Typography.Title level={2} style={{ margin: 0, lineHeight: 1.2 }}>
                  {listMeta.icon ? <span style={{ marginRight: 10 }}>{toEmoji(listMeta.icon)}</span> : null}
                  {listMeta.name}
                </Typography.Title>
                <Typography.Text className="list-meta">Updated {timeAgo(listMeta.updated_at)}</Typography.Text>
                {incompleteCount > 0 && (
                  <Typography.Text className="list-meta">
                    {incompleteCount === 1 ? '1 unchecked item' : `${incompleteCount} unchecked items`}
                  </Typography.Text>
                )}
                {listMeta.description && (
                  <Typography.Text className="list-description">{listMeta.description}</Typography.Text>
                )}
              </div>
              <div className="list-actions">
                {isGroceryList && (
                  <Button
                    type={groupByCat ? 'primary' : 'default'}
                    onClick={() => setGroupByCat(!groupByCat)}
                  >
                    {groupByCat ? 'Ungroup categories' : 'Group by category'}
                  </Button>
                )}
                <Button onClick={() => navigate('/app')} icon={<ArrowLeft />}>Back</Button>
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: [
                      {
                        key: 'toggle-completed',
                        label: includeCompleted ? 'Hide completed' : 'Show completed',
                        icon: includeCompleted ? <EyeSlash size={18} /> : <Eye size={18} />
                      },
                      {
                        key: 'clear-completed',
                        label: 'Clear completed',
                        icon: <Broom size={18} />
                      },
                      { type: 'divider' },
                      ...(myVote(listMeta)
                        ? [{ key: 'cancel', label: 'Cancel delete vote', danger: true }]
                        : [{ key: 'vote', label: 'Vote to delete', danger: true }]),
                    ],
                    onClick: ({ key }) => {
                      if (key === 'toggle-completed') setIncludeCompleted(!includeCompleted);
                      if (key === 'clear-completed') onClearCompleted();
                      if (key === 'vote') { onVoteDelete(); show('Vote recorded'); }
                      if (key === 'cancel') { onCancelVote(); show('Vote canceled'); }
                    },
                  }}
                >
                  <Button icon={<DotsThreeVertical />} aria-label="More" />
                </Dropdown>
              </div>
            </div>
          )}
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
                        <div className="empty-state"><Plus size={20} style={{ color: 'var(--color-primary)' }} />
                          <Typography.Text type="secondary">No items yet. Add your first item below.</Typography.Text>
                        </div>
                      ) : (
                        <>
                          {incompleteItems.length > 0 && (
                            groupByCat && incompleteGrouped ? (
                              <div className="grouped-sections">
                                {Object.entries(incompleteGrouped).map(([cat, items]) => (
                                  <div key={cat} className="category-section" style={{ marginBottom: 24 }}>
                                    <div className="category-section-header" style={{ marginBottom: 8 }}>
                                      <Tag className={`category-tag ${getCategoryClass(cat)}`} style={{ fontSize: '12px', padding: '2px 10px', fontWeight: 600 }}>
                                        {cat.toUpperCase()}
                                      </Tag>
                                    </div>
                                    <AntList
                                      itemLayout="horizontal"
                                      className="items-list"
                                      dataSource={items}
                                      renderItem={(it) => (
                                        <AntList.Item
                                          actions={[
                                            <Button
                                              key="del"
                                              type="text"
                                              danger
                                              icon={<Trash />}
                                              onClick={() => onDeleteItem(it)}
                                              style={{ paddingInline: 8 }}
                                              disabled={savingItemId === it.item_id || editingItemId === it.item_id}
                                            />
                                          ]}
                                        >
                                          <div className="item-row">
                                            <span ref={setCheckboxRef(it.item_id)} className="checkbox-anchor">
                                              <Checkbox checked={it.completed} onChange={() => onToggleComplete(it)} disabled={savingItemId === it.item_id || editingItemId === it.item_id} />
                                            </span>
                                            <div className="item-text" onClick={(e) => { e.stopPropagation(); startEdit(it) }}>
                                              {editingItemId === it.item_id ? (
                                                <InlineEditText
                                                  value={`${it.quantity ? it.quantity + (it.unit ? ' ' + it.unit : '') + ' ' : (it.unit ? it.unit + ' ' : '')}${it.description}`}
                                                  onSubmit={(val) => submitEdit(it, val)}
                                                  disabled={savingItemId === it.item_id}
                                                />
                                              ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                  <div style={{ textDecoration: it.completed ? 'line-through' : 'none', fontWeight: 400, fontSize: '15px' }}>
                                                    {it.description}
                                                  </div>
                                                  {(it.quantity || it.unit) && (
                                                    <div className="qty-unit-line">
                                                      <span className="qty-label">Quantity:</span> {it.quantity} {it.unit}
                                                    </div>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        </AntList.Item>
                                      )}
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <DndContext sensors={sensors} onDragEnd={onDragEnd}>
                                <SortableContext items={incompleteItems.map(it => it.item_id)} strategy={verticalListSortingStrategy}>
                                  <AntList
                                    itemLayout="horizontal"
                                    className="items-list"
                                    dataSource={incompleteItems}
                                    renderItem={(it) => (
                                      <AntList.Item
                                        actions={[
                                          <Button
                                            key="del"
                                            type="text"
                                            danger
                                            icon={<Trash />}
                                            aria-label="Delete item"
                                            title="Delete item"
                                            onClick={() => onDeleteItem(it)}
                                            style={{ paddingInline: 8 }}
                                            disabled={savingItemId === it.item_id || editingItemId === it.item_id}
                                          />
                                        ]}
                                      >
                                        <SortableRow it={it}>
                                          <div className="item-row">
                                            <span ref={setCheckboxRef(it.item_id)} className="checkbox-anchor">
                                              <Checkbox checked={it.completed} onChange={() => onToggleComplete(it)} disabled={savingItemId === it.item_id || editingItemId === it.item_id} />
                                            </span>
                                            <div className="item-text" onClick={(e) => { e.stopPropagation(); startEdit(it) }}>
                                              {editingItemId === it.item_id ? (
                                                <InlineEditText
                                                  value={`${it.quantity ? it.quantity + (it.unit ? ' ' + it.unit : '') + ' ' : (it.unit ? it.unit + ' ' : '')}${it.description}`}
                                                  onSubmit={(val) => submitEdit(it, val)}
                                                  disabled={savingItemId === it.item_id}
                                                />
                                              ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                    <div style={{ textDecoration: it.completed ? 'line-through' : 'none', fontWeight: 400, fontSize: '15px' }}>
                                                      {it.description}
                                                    </div>
                                                    {(it.quantity || it.unit) && (
                                                      <div className="qty-unit-line">
                                                        <span className="qty-label">Quantity:</span> {it.quantity} {it.unit}
                                                      </div>
                                                    )}
                                                  </div>
                                                  {isGroceryList && it.category && (
                                                    <div style={{ marginTop: 2 }}>
                                                      <Tag className={`category-tag ${getCategoryClass(it.category)}`}>{it.category}</Tag>
                                                    </div>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        </SortableRow>
                                      </AntList.Item>
                                    )}
                                  />
                                </SortableContext>
                              </DndContext>
                            )
                          )}
                          {includeCompleted && completedItems.length > 0 && (
                            <>
                              <div className="completed-header">
                                <span>Completed ({completedItems.length})</span>
                              </div>
                              <AntList
                                itemLayout="horizontal"
                                className="items-list"
                                dataSource={completedItems}
                                renderItem={(it) => (
                                  <AntList.Item
                                    actions={[
                                      <Button
                                        key="del"
                                        type="text"
                                        danger
                                        icon={<Trash />}
                                        aria-label="Delete item"
                                        title="Delete item"
                                        onClick={() => onDeleteItem(it)}
                                        style={{ paddingInline: 8 }}
                                        disabled={savingItemId === it.item_id || editingItemId === it.item_id}
                                      />
                                    ]}
                                  >
                                    <div className="item-row item-row-completed">
                                      <span ref={setCheckboxRef(it.item_id)} className="checkbox-anchor">
                                        <Checkbox checked={it.completed} onChange={() => onToggleComplete(it)} disabled={savingItemId === it.item_id || editingItemId === it.item_id} />
                                      </span>
                                      <div className="item-text" onClick={(e) => { e.stopPropagation(); startEdit(it) }}>
                                        {editingItemId === it.item_id ? (
                                          <InlineEditText
                                            value={`${it.quantity ? it.quantity + (it.unit ? ' ' + it.unit : '') + ' ' : (it.unit ? it.unit + ' ' : '')}${it.description}`}
                                            onSubmit={(val) => submitEdit(it, val)}
                                            disabled={savingItemId === it.item_id}
                                          />
                                        ) : (
                                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                              <div style={{ textDecoration: 'line-through', opacity: 0.6, fontWeight: 400, fontSize: '15px' }}>
                                                {it.description}
                                              </div>
                                              {(it.quantity || it.unit) && (
                                                <div className="qty-unit-line" style={{ opacity: 0.6 }}>
                                                  <span className="qty-label">Quantity:</span> {it.quantity} {it.unit}
                                                </div>
                                              )}
                                            </div>
                                            {isGroceryList && it.category && (
                                              <div style={{ marginTop: 2, opacity: 0.6 }}>
                                                <Tag className={`category-tag ${getCategoryClass(it.category)}`}>{it.category}</Tag>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </AntList.Item>
                                )}
                              />
                            </>
                          )}
                        </>
                      )}
                      {/* Sticky Add Bar at bottom (always visible) */}
                      <div className="add-bar" role="region" aria-label="Add new item">
                        <div className="add-row">
                          <Input.TextArea
                            ref={addRef}
                            className="add-input"
                            value={newDesc}
                            onChange={(e) => setNewDesc(e.target.value)}
                            placeholder="Add an item"
                            autoSize={{ minRows: 1, maxRows: 3 }}
                            onKeyDown={(e) => {
                              const ne = e as unknown as { key: string; shiftKey: boolean; nativeEvent?: any; isComposing?: boolean; preventDefault: () => void }
                              const composing = (
                                (ne.nativeEvent && (ne.nativeEvent.isComposing || ne.nativeEvent.keyCode === 229)) ||
                                (!!(ne as any).isComposing)
                              )
                              if (ne.key === 'Enter' && !ne.shiftKey && !composing) {
                                e.preventDefault()
                                onCreateItem()
                              }
                            }}
                            aria-label="Add item input"
                          />
                          <Button
                            className="add-btn"
                            type="primary"
                            shape="circle"
                            onClick={() => onCreateItem()}
                            disabled={!newDesc.trim()}
                            icon={<Plus />}
                            size="large"
                            aria-label="Add item"
                          />
                        </div>
                      </div>
                    </Space>
                  ),
                },
                {
                  key: 'notes',
                  label: 'Notes',
                  children: (
                    <Space direction="vertical" style={{ width: '100%' }} size="large">
                      <Input.TextArea
                        value={notesText}
                        onChange={(e) => setNotesText(e.target.value)}
                        placeholder="Write notes for this list"
                        autoSize={{ minRows: 10, maxRows: 30 }}
                      />
                      <div className="notes-actions">
                        <Button danger onClick={() => setNotesText('')} disabled={!notesText.trim()} icon={<X />}>Clear all</Button>
                        <Button type="primary" onClick={onSaveNotes} disabled={!notesDirty || notesSaving} icon={<FloppyDisk />}>Save</Button>
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
