import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@auth/AuthProvider'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMe, getListItems, getLists, createListItem, updateListItem, deleteListItem, voteListDeletion, cancelListDeletion } from '@api/endpoints'
import type { List, ListItem } from '@api/types'
import { useLiveQueryOpts } from '@lib/liveQuery'
import { Card, Typography, Space, Button, Input, Checkbox, List as AntList, Grid, Dropdown, message, Skeleton, Alert } from 'antd'
import { ArrowLeft, Trash, Plus, Eye, EyeSlash, DotsThreeVertical } from '@phosphor-icons/react'
import { toEmoji } from '../icons'
import { confettiAt } from '@lib/confetti'
import { InlineEditText } from '@components/InlineEditText'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import { BrandLogo } from '@components/BrandLogo'

export const ListPage: React.FC = () => {
  const { apiKey } = useAuth()
  const navigate = useNavigate()
  const { listId = '' } = useParams()
  const [includeCompleted, setIncludeCompleted] = useState(false)
  const [newDesc, setNewDesc] = useState('')
  const addRef = useRef<HTMLTextAreaElement | null>(null)
  
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
  const listsMs = parseMs((import.meta as any).env?.VITE_LIVE_QUERY_LISTS_MS, 4000)
  const itemsMs = parseMs((import.meta as any).env?.VITE_LIVE_QUERY_ITEMS_MS, 2000)
  const listsLive = useLiveQueryOpts(listsMs)
  const listsQuery = useQuery({
    queryKey: ['lists', roomId],
    queryFn: () => getLists(apiKey!, roomId!),
    enabled: !!roomId,
    ...listsLive,
  })
  const listMeta: List | undefined = useMemo(() => listsQuery.data?.find(l => l.list_id === listId), [listsQuery.data, listId])

  const itemsLive = useLiveQueryOpts(itemsMs)
  const itemsQuery = useQuery({
    queryKey: ['list-items', listId, includeCompleted],
    queryFn: () => getListItems(apiKey!, roomId!, listId, includeCompleted),
    enabled: !!roomId && !!listId,
    ...itemsLive,
  })

  // Always derive items and sorted views before any early returns to keep hook order stable
  const items = itemsQuery.data ?? []
  const sortedItems = useMemo(() => {
    const copy = [...items]
    copy.sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1))
    return copy
  }, [items])
  const incompleteItems = useMemo(() => sortedItems.filter(it => !it.completed), [sortedItems])
  const completedItems = useMemo(() => sortedItems.filter(it => it.completed), [sortedItems])

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

  const onCreateItem = () => {
    const desc = newDesc.trim()
    if (!desc) return
    // Optimistic UX: clear input immediately and keep focus for rapid entry
    setNewDesc('')
    // Keep focus so user can continue typing
    requestAnimationFrame(() => {
      addRef.current?.focus()
    })
    // Fire-and-forget create; reconcile via invalidate
    createListItem(apiKey!, roomId!, listId, desc)
      .then(() => qc.invalidateQueries({ queryKey: ['list-items', listId] }))
      .catch((e: any) => {
        // Restore text so the user can retry
        setNewDesc(desc)
        addRef.current?.focus()
        msgApi.error(e?.message || 'Failed to add item')
      })
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
    if (trimmed === it.description.trim()) { setEditingItemId(null); return }
    try {
      setSavingItemId(it.item_id)
      await updateListItem(apiKey!, roomId!, listId, it.item_id, { description: trimmed })
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
      <BrandLogo />
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
                  {listMeta.description && (
                    <Typography.Text className="list-description">{listMeta.description}</Typography.Text>
                  )}
                </div>
                <div className="list-actions">
                  <Button onClick={() => setIncludeCompleted((v) => !v)} icon={includeCompleted ? <EyeSlash /> : <Eye />}>
                    {includeCompleted ? 'Hide' : 'Show'} completed
                  </Button>
                  <Button onClick={() => navigate('/app')} icon={<ArrowLeft />}>Back</Button>
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: myVote(listMeta)
                        ? [{ key: 'cancel', label: 'Cancel delete vote' }]
                        : [{ key: 'vote', label: 'Vote to delete' }],
                      onClick: ({ key }) => {
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
                {listMeta.description && (
                  <Typography.Text className="list-description">{listMeta.description}</Typography.Text>
                )}
              </div>
              <div className="list-actions">
                <Button onClick={() => setIncludeCompleted((v) => !v)} icon={includeCompleted ? <EyeSlash /> : <Eye />}>
                  {includeCompleted ? 'Hide' : 'Show'} completed
                </Button>
                <Button onClick={() => navigate('/app')} icon={<ArrowLeft />}>Back</Button>
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: myVote(listMeta)
                      ? [{ key: 'cancel', label: 'Cancel delete vote' }]
                      : [{ key: 'vote', label: 'Vote to delete' }],
                    onClick: ({ key }) => {
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

        {/* Top sheet: list items; sticky add bar is rendered at the bottom */}
        <Card className="paper-card paper-list">
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
                        <div className="item-row">
                          <span ref={setCheckboxRef(it.item_id)} className="checkbox-anchor">
                            <Checkbox checked={it.completed} onChange={() => onToggleComplete(it)} disabled={savingItemId === it.item_id || editingItemId === it.item_id} />
                          </span>
                          <div className="item-text" onClick={(e) => { e.stopPropagation(); startEdit(it) }}>
                            {editingItemId === it.item_id ? (
                              <InlineEditText
                                value={it.description}
                                onSubmit={(val) => submitEdit(it, val)}
                                disabled={savingItemId === it.item_id}
                              />
                            ) : (
                              <span style={{ textDecoration: it.completed ? 'line-through' : 'none' }}>{it.description}</span>
                            )}
                          </div>
                        </div>
                      </AntList.Item>
                    )}
                  />
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
                                  value={it.description}
                                  onSubmit={(val) => submitEdit(it, val)}
                                  disabled={savingItemId === it.item_id}
                                />
                              ) : (
                                <span style={{ textDecoration: it.completed ? 'line-through' : 'none' }}>{it.description}</span>
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
            {/* Sticky Add Bar at bottom */}
            <div className="add-bar" role="region" aria-label="Add new item">
              <div className="add-row">
                <Input.TextArea
                  ref={addRef}
                  className="add-input"
                  placeholder="Add an item"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
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
                  onClick={onCreateItem}
                  disabled={!newDesc.trim()}
                  icon={<Plus />}
                  size="large"
                  aria-label="Add item"
                />
              </div>
            </div>
          
          </Space>
        </Card>
      </div>
    </div>
  )
}
