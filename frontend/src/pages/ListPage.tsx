import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@auth/AuthProvider'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMe, getListItems, getLists, createListItem, updateListItem, deleteListItem, voteListDeletion, cancelListDeletion } from '@api/endpoints'
import type { List, ListItem } from '@api/types'
import { useLiveQueryOpts } from '@lib/liveQuery'
import { Card, Typography, Space, Button, Input, Checkbox, List as AntList, Alert, Grid, Dropdown, message } from 'antd'
import { ArrowLeftOutlined, DeleteOutlined, PlusOutlined, EyeOutlined, EyeInvisibleOutlined, CloseCircleOutlined, MoreOutlined } from '@ant-design/icons'

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

  // Always derive items and sortedItems before any early returns to keep hook order stable
  const items = itemsQuery.data ?? []
  const sortedItems = useMemo(() => {
    const copy = [...items]
    copy.sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1))
    return copy
  }, [items])

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

  // sortedItems defined earlier to maintain consistent hook order

  return (
    <div className="container">
      {contextHolder}
      <Card>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {isMobile ? (
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <Typography.Title level={2} style={{ margin: 0 }}>{listMeta.name}</Typography.Title>
              <Typography.Text type="secondary">Updated {timeAgo(listMeta.updated_at)}</Typography.Text>
              {listMeta.description && (
                <Typography.Text type="secondary" style={{ marginTop: 4 }}>{listMeta.description}</Typography.Text>
              )}
              <Space wrap>
                <Button onClick={() => setIncludeCompleted((v) => !v)} icon={includeCompleted ? <EyeInvisibleOutlined /> : <EyeOutlined />}>
                  {includeCompleted ? 'Hide completed' : 'Show completed'}
                </Button>
                <Button onClick={() => navigate('/app')} icon={<ArrowLeftOutlined />}>Back</Button>
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
                  <Button icon={<MoreOutlined />} aria-label="More" />
                </Dropdown>
              </Space>
            </Space>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <Typography.Title level={2} style={{ margin: 0 }}>{listMeta.name}</Typography.Title>
                <Typography.Text type="secondary">Updated {timeAgo(listMeta.updated_at)}</Typography.Text>
                {listMeta.description && (
                  <Typography.Text type="secondary" style={{ marginTop: 4 }}>{listMeta.description}</Typography.Text>
                )}
              </div>
              <Space>
                <Button onClick={() => setIncludeCompleted((v) => !v)} icon={includeCompleted ? <EyeInvisibleOutlined /> : <EyeOutlined />}>
                  {includeCompleted ? 'Hide completed' : 'Show completed'}
                </Button>
                <Button onClick={() => navigate('/app')} icon={<ArrowLeftOutlined />}>Back</Button>
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
                  <Button icon={<MoreOutlined />} aria-label="More" />
                </Dropdown>
              </Space>
            </div>
          )}
          {/* description now displayed under the title to reduce top padding */}
          {isMobile ? (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input
                placeholder="Add an item"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                size="large"
              />
              <Button type="primary" onClick={onCreateItem} disabled={!newDesc.trim()} icon={<PlusOutlined />} size="large">Add</Button>
            </Space>
          ) : (
            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder="Add an item"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                size="large"
              />
              <Button type="primary" onClick={onCreateItem} disabled={!newDesc.trim()} icon={<PlusOutlined />} size="large">Add</Button>
            </Space.Compact>
          )}
          {items.length === 0 ? (
            <Typography.Text type="secondary">{includeCompleted ? 'No items yet.' : 'No incomplete items.'}</Typography.Text>
          ) : (
            <AntList
              className="items-list"
              dataSource={sortedItems}
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
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', width: '100%' }}>
                    <Checkbox checked={it.completed} onChange={() => onToggleComplete(it)} />
                    <div style={{ flex: 1, minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                      <span style={{ textDecoration: it.completed ? 'line-through' : 'none' }}>{it.description}</span>
                    </div>
                  </div>
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
