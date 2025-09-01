import React, { useMemo, useState } from 'react'
import type { RoomView, List } from '@api/types'
import { useAuth } from '@auth/AuthProvider'
import { useNavigate, Link } from 'react-router-dom'
import { createList, getLists, rotateShare, voteListDeletion, cancelListDeletion } from '@api/endpoints'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLiveQueryOpts } from '@lib/liveQuery'
import { Card, Typography, Space, Button, Modal, Input, List as AntList, Alert, Grid, Dropdown } from 'antd'
import { MoreOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'

export const RoomPage: React.FC<{ room: RoomView; roomId: string; userId: string }> = ({ room, roomId, userId }) => {
  const { apiKey, setApiKey } = useAuth()
  const navigate = useNavigate()
  const [shareOpen, setShareOpen] = useState(false)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const qc = useQueryClient()
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md

  const onShare = async () => {
    setError(null)
    try {
      const r = await rotateShare(apiKey!)
      setShareToken(r.token)
      setShareOpen(true)
    } catch (e: any) {
      setError(e?.message || 'Failed to get share token')
    }
  }

  const parseMs = (v: any, def: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : def }
  const listsMs = parseMs((import.meta as any).env?.VITE_LIVE_QUERY_LISTS_MS, 4000)
  const liveOpts = useLiveQueryOpts(listsMs)
  const listsQuery = useQuery({ queryKey: ['lists', roomId], queryFn: () => getLists(apiKey!, roomId), ...liveOpts })
  const lists = listsQuery.data ?? []

  const myVote = useMemo(() => {
    // a simple helper to check if I voted on a given list
    return (l: List) => !!l.deletion_votes && !!l.deletion_votes[userId]
  }, [userId])

  const onCreateList = async () => {
    if (!newName.trim()) return
    setCreating(true)
    setError(null)
    try {
      await createList(apiKey!, roomId, { name: newName.trim(), description: newDesc.trim() || undefined })
      setNewName('')
      setNewDesc('')
      await qc.invalidateQueries({ queryKey: ['lists', roomId] })
    } catch (e: any) {
      setError(e?.message || 'Failed to create list')
    } finally { setCreating(false) }
  }

  const onVoteList = async (l: List) => {
    setError(null)
    try {
      await voteListDeletion(apiKey!, roomId, l.list_id)
      await qc.invalidateQueries({ queryKey: ['lists', roomId] })
    } catch (e: any) { setError(e?.message || 'Failed to vote') }
  }
  const onCancelVoteList = async (l: List) => {
    setError(null)
    try {
      await cancelListDeletion(apiKey!, roomId, l.list_id)
      await qc.invalidateQueries({ queryKey: ['lists', roomId] })
    } catch (e: any) { setError(e?.message || 'Failed to cancel vote') }
  }

  return (
    <div className="container">
      <Card>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {isMobile ? (
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <Typography.Title level={3} style={{ margin: 0 }}>{room.display_name || 'House'}</Typography.Title>
              <Space wrap>
                <Button type="primary" onClick={onShare}>Share Code</Button>
                <Button onClick={() => navigate('/app/settings')}>Settings</Button>
                <Button onClick={() => setApiKey(null)}>Logout</Button>
              </Space>
            </Space>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Title level={3} style={{ margin: 0 }}>{room.display_name || 'House'}</Typography.Title>
              <Space>
                <Button type="primary" onClick={onShare}>Share Code</Button>
                <Button onClick={() => navigate('/app/settings')}>Settings</Button>
                <Button onClick={() => setApiKey(null)}>Logout</Button>
              </Space>
            </div>
          )}

          {room.description && (
            <Typography.Text type="secondary">{room.description}</Typography.Text>
          )}
          <div>Members: {room.members?.join(', ') || '—'}</div>

          <Modal
            title="Share House"
            open={shareOpen}
            onCancel={() => setShareOpen(false)}
            footer={
              <Space>
                <Button type="primary" onClick={onShare}>Get new code</Button>
                <Button onClick={() => setShareOpen(false)}>Done</Button>
              </Space>
            }
          >
            <div>
              {shareToken ? (
                <>
                  <div>
                    Code: <code>{shareToken}</code> (5 chars, no I/O/L)
                  </div>
                  <Typography.Text type="secondary">Share this code with your partner.</Typography.Text>
                </>
              ) : (
                <div>Generating code…</div>
              )}
            </div>
          </Modal>

          <div>
            <Typography.Title level={4} style={{ marginTop: 0 }}>Lists</Typography.Title>
            {isMobile ? (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input
                  placeholder="New list name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <Input
                  placeholder="Description (optional)"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
                <Button type="primary" disabled={creating || !newName.trim()} onClick={onCreateList}>Create</Button>
              </Space>
            ) : (
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  placeholder="New list name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <Input
                  placeholder="Description (optional)"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
                <Button type="primary" disabled={creating || !newName.trim()} onClick={onCreateList}>Create</Button>
              </Space.Compact>
            )}
          </div>

          {listsQuery.isLoading ? (
            <div>Loading lists…</div>
          ) : lists.length === 0 ? (
            <Typography.Text type="secondary">No lists yet. Create the first one above.</Typography.Text>
          ) : (
            <AntList
              itemLayout={isMobile ? 'vertical' : 'horizontal'}
              dataSource={lists}
              renderItem={(l) => {
                if (isMobile) {
                  const items: MenuProps['items'] = [
                    {
                      key: 'toggle',
                      label: myVote(l) ? 'Cancel vote' : 'Request delete',
                      danger: !myVote(l),
                    },
                  ]
                  return (
                    <AntList.Item
                      actions={[
                        <Button key="open" type="primary" onClick={() => navigate(`/app/lists/${l.list_id}`)}>Open</Button>,
                        <Dropdown key="more" menu={{ items, onClick: ({ key }) => {
                          if (key === 'toggle') {
                            myVote(l) ? onCancelVoteList(l) : onVoteList(l)
                          }
                        } }}>
                          <Button icon={<MoreOutlined />} />
                        </Dropdown>,
                      ]}
                    >
                      <AntList.Item.Meta
                        title={<Link to={`/app/lists/${l.list_id}`}>{l.name}</Link>}
                        description={l.description ? <Typography.Text type="secondary">{l.description}</Typography.Text> : null}
                      />
                    </AntList.Item>
                  )
                }
                return (
                  <AntList.Item
                    actions={[
                      myVote(l)
                        ? <Button key="cancel" onClick={() => onCancelVoteList(l)}>Cancel vote</Button>
                        : <Button key="reqdel" danger onClick={() => onVoteList(l)}>Request delete</Button>,
                      <Button key="open" type="primary" onClick={() => navigate(`/app/lists/${l.list_id}`)}>Open</Button>,
                    ]}
                  >
                    <AntList.Item.Meta
                      title={<Link to={`/app/lists/${l.list_id}`}>{l.name}</Link>}
                      description={l.description ? <Typography.Text type="secondary">{l.description}</Typography.Text> : null}
                    />
                  </AntList.Item>
                )
              }}
            />
          )}

          {error && <Alert type="error" message={error} showIcon />}
        </Space>
      </Card>
    </div>
  )
}
