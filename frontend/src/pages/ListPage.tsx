import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@auth/AuthProvider'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMe, getListItems, getLists, createListItem, updateListItem, deleteListItem, voteListDeletion, cancelListDeletion } from '@api/endpoints'
import type { List, ListItem } from '@api/types'
import { useLiveQueryOpts } from '@lib/liveQuery'
import { Card, Typography, Space, Button, Input, Checkbox, List as AntList, Alert, Grid } from 'antd'
import { ArrowLeftOutlined, DeleteOutlined, PlusOutlined, EyeOutlined, EyeInvisibleOutlined, CloseCircleOutlined } from '@ant-design/icons'

export const ListPage: React.FC = () => {
  const { apiKey } = useAuth()
  const navigate = useNavigate()
  const { listId = '' } = useParams()
  const [includeCompleted, setIncludeCompleted] = useState(false)
  const [newDesc, setNewDesc] = useState('')
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()
  // Breakpoints hook must be called before any early returns
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  // antd message for toasts
  const show = (msg: string) => {
    // dynamic import to avoid circular; or simply use browser alert fallback
    // eslint-disable-next-line no-alert
    // For simplicity, we keep a minimal toast using alert replacement
    // Consider switching to antd message.useMessage for richer UX
    console.info(msg)
  }
  const [redirecting, setRedirecting] = useState(false)

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

  const onCreateItem = async () => {
    if (!newDesc.trim()) return
    setError(null)
    try {
      await createListItem(apiKey!, roomId!, listId, newDesc.trim())
      setNewDesc('')
      await qc.invalidateQueries({ queryKey: ['list-items', listId] })
    } catch (e: any) { setError(e?.message || 'Failed to add item') }
  }

  const onToggleComplete = async (it: ListItem) => {
    setError(null)
    try {
      await updateListItem(apiKey!, roomId!, listId, it.item_id, { completed: !it.completed })
      await qc.invalidateQueries({ queryKey: ['list-items', listId] })
    } catch (e: any) { setError(e?.message || 'Failed to update item') }
  }

  const onDeleteItem = async (it: ListItem) => {
    setError(null)
    try {
      await deleteListItem(apiKey!, roomId!, listId, it.item_id)
      await qc.invalidateQueries({ queryKey: ['list-items', listId] })
    } catch (e: any) { setError(e?.message || 'Failed to delete item') }
  }

  const myVote = (l?: List) => !!l?.deletion_votes && !!userId && !!l.deletion_votes[userId]
  const onVoteDelete = async () => {
    setError(null)
    try {
      const res = await voteListDeletion(apiKey!, roomId!, listId)
      await qc.invalidateQueries({ queryKey: ['lists', roomId] })
      if (res.deleted) {
        setRedirecting(true)
        show('List is successfully deleted')
        navigate('/app')
      }
    } catch (e: any) { setError(e?.message || 'Failed to vote deletion') }
  }
  const onCancelVote = async () => {
    setError(null)
    try {
      await cancelListDeletion(apiKey!, roomId!, listId)
      await qc.invalidateQueries({ queryKey: ['lists', roomId] })
    } catch (e: any) { setError(e?.message || 'Failed to cancel vote') }
  }

  if (meQuery.isLoading || listsQuery.isLoading || itemsQuery.isLoading) {
    return <div className="container"><Card>Loading…</Card></div>
  }
  if (!roomId) {
    return <div className="container"><Card><Alert type="error" message="List not found." showIcon /><div className="spacer" /><Button onClick={() => navigate('/app')} icon={<ArrowLeftOutlined />}>Back to House</Button></Card></div>
  }
  if (!listMeta) {
    if (redirecting || hadListRef.current) {
      return <div className="container"><Card>Redirecting…</Card></div>
    }
    return <div className="container"><Card><Alert type="error" message="List not found." showIcon /><div className="spacer" /><Button onClick={() => navigate('/app')} icon={<ArrowLeftOutlined />}>Back to House</Button></Card></div>
  }

  const items = itemsQuery.data ?? []

  return (
    <div className="container">
      <Card>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {isMobile ? (
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <Typography.Title level={3} style={{ margin: 0 }}>{listMeta.name}</Typography.Title>
              <Space wrap>
                {myVote(listMeta) ? (
                  <Button onClick={onCancelVote} icon={<CloseCircleOutlined />}>Cancel delete vote</Button>
                ) : (
                  <Button danger onClick={onVoteDelete} icon={<DeleteOutlined />}>Vote to Delete</Button>
                )}
                <Button onClick={() => navigate('/app')} icon={<ArrowLeftOutlined />}>Back</Button>
              </Space>
            </Space>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Title level={3} style={{ margin: 0 }}>{listMeta.name}</Typography.Title>
              <Space>
                {myVote(listMeta) ? (
                  <Button onClick={onCancelVote} icon={<CloseCircleOutlined />}>Cancel delete vote</Button>
                ) : (
                  <Button danger onClick={onVoteDelete} icon={<DeleteOutlined />}>Vote to Delete</Button>
                )}
                <Button onClick={() => navigate('/app')} icon={<ArrowLeftOutlined />}>Back</Button>
              </Space>
            </div>
          )}
          {listMeta.description && <Typography.Text type="secondary">{listMeta.description}</Typography.Text>}
          {isMobile ? (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input
                placeholder="Add an item"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
              <Space>
                <Button type="primary" onClick={onCreateItem} disabled={!newDesc.trim()} icon={<PlusOutlined />}>Add</Button>
                <Button type="default" onClick={() => setIncludeCompleted((v) => !v)} icon={includeCompleted ? <EyeInvisibleOutlined /> : <EyeOutlined />}>
                  {includeCompleted ? 'Hide completed' : 'Show completed'}
                </Button>
              </Space>
            </Space>
          ) : (
            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder="Add an item"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
              <Button type="primary" onClick={onCreateItem} disabled={!newDesc.trim()} icon={<PlusOutlined />}>Add</Button>
              <Button type="default" onClick={() => setIncludeCompleted((v) => !v)} icon={includeCompleted ? <EyeInvisibleOutlined /> : <EyeOutlined />}>
                {includeCompleted ? 'Hide completed' : 'Show completed'}
              </Button>
            </Space.Compact>
          )}
          {items.length === 0 ? (
            <Typography.Text type="secondary">{includeCompleted ? 'No items yet.' : 'No incomplete items.'}</Typography.Text>
          ) : (
            <AntList
              className="items-list"
              dataSource={items}
              renderItem={(it) => (
                <AntList.Item
                  actions={[
                    <Button
                      key="del"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label="Delete item"
                      title="Delete item"
                      onClick={() => onDeleteItem(it)}
                      style={{ paddingInline: 8 }}
                    />
                  ]}
                >
                  <Space>
                    <Checkbox checked={it.completed} onChange={() => onToggleComplete(it)} />
                    <span style={{ textDecoration: it.completed ? 'line-through' : 'none' }}>{it.description}</span>
                  </Space>
                </AntList.Item>
              )}
            />
          )}
          {error && <Alert type="error" message={error} showIcon />}
        </Space>
      </Card>
    </div>
  )
}
