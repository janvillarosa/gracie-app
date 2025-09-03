import React, { useMemo, useState } from 'react'
import type { RoomView, List } from '@api/types'
import { useAuth } from '@auth/AuthProvider'
import { useNavigate, Link } from 'react-router-dom'
import { createList, getLists, rotateShare, voteListDeletion, cancelListDeletion, updateList } from '@api/endpoints'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLiveQueryOpts } from '@lib/liveQuery'
import { Card, Typography, Space, Button, Modal, Input, List as AntList, Alert, Grid, Dropdown } from 'antd'
import { DotsThreeVertical, CaretRight, ShareNetwork, Plus, ArrowClockwise, Check, FloppyDisk, X } from '@phosphor-icons/react'
import type { MenuProps } from 'antd'
import { IconPicker } from '@components/IconPicker'
import { toEmoji } from '../icons'
import type { ListIcon } from '@api/types'

export const RoomPage: React.FC<{ room: RoomView; roomId: string; userId: string }> = ({ room, roomId, userId }) => {
  const { apiKey, setApiKey } = useAuth()
  const navigate = useNavigate()
  const [shareOpen, setShareOpen] = useState(false)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTarget, setEditTarget] = useState<List | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [newIcon, setNewIcon] = useState<ListIcon | undefined>(undefined)
  const [editIcon, setEditIcon] = useState<ListIcon | undefined>(undefined)
  const [editIconTouched, setEditIconTouched] = useState(false)
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

  // Deletion actions removed from dashboard; keep minimal helpers only if needed elsewhere

  const onCreateList = async () => {
    if (!newName.trim()) return
    setCreating(true)
    setError(null)
    try {
      await createList(apiKey!, roomId, { name: newName.trim(), description: newDesc.trim() || undefined, icon: newIcon })
      setNewName('')
      setNewDesc('')
      setNewIcon(undefined)
      setCreateOpen(false)
      await qc.invalidateQueries({ queryKey: ['lists', roomId] })
    } catch (e: any) {
      setError(e?.message || 'Failed to create list')
    } finally { setCreating(false) }
  }

  const onOpenEdit = (l: List) => {
    setEditTarget(l)
    setEditName(l.name)
    setEditDesc(l.description || '')
    setEditIcon(l.icon as ListIcon | undefined)
    setEditIconTouched(false)
    setEditOpen(true)
  }

  const onSaveEdit = async () => {
    if (!editTarget) return
    if (!editName.trim()) { setError('List name is required'); return }
    setEditing(true)
    setError(null)
    try {
      const body: any = { name: editName.trim(), description: editDesc.trim() || undefined }
      if (editIconTouched) {
        body.icon = editIcon ?? ''
      }
      await updateList(apiKey!, roomId, editTarget.list_id, body)
      setEditOpen(false)
      setEditTarget(null)
      await qc.invalidateQueries({ queryKey: ['lists', roomId] })
    } catch (e: any) {
      setError(e?.message || 'Failed to update list')
    } finally { setEditing(false) }
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
      <div className="paper-stack">
        {/* Bottom meta sheet: title/description/share */}
        <Card className="paper-card paper-meta">
          {(() => {
            const menu: MenuProps['items'] = [
              { key: 'settings', label: 'House Settings' },
              { type: 'divider' as const },
              { key: 'logout', label: 'Logout' },
            ]
            const onMenuClick: MenuProps['onClick'] = ({ key }) => {
              if (key === 'settings') navigate('/app/settings')
              if (key === 'logout') setApiKey(null)
            }
            return isMobile ? (
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <Typography.Title level={2} style={{ margin: 0 }}>{room.display_name || 'House'}</Typography.Title>
                <Space wrap>
                  <Button type="primary" onClick={onShare} icon={<ShareNetwork />}>Share Code</Button>
                  <Dropdown menu={{ items: menu, onClick: onMenuClick }} trigger={['click']}>
                    <Button icon={<DotsThreeVertical />} aria-label="More actions" />
                  </Dropdown>
                </Space>
              </Space>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography.Title level={2} style={{ margin: 0 }}>{room.display_name || 'House'}</Typography.Title>
                <Space>
                  <Button type="primary" onClick={onShare} icon={<ShareNetwork />}>Share Code</Button>
                  <Dropdown menu={{ items: menu, onClick: onMenuClick }} trigger={['click']}>
                    <Button icon={<DotsThreeVertical />} aria-label="More actions" />
                  </Dropdown>
                </Space>
              </div>
            )
          })()}

          {room.description && (
            <Typography.Text type="secondary">{room.description}</Typography.Text>
          )}
          <div>Members: {room.members?.join(', ') || '—'}</div>
        </Card>

        {/* Top list sheet: lists and actions */}
        <Card className="paper-card paper-list">
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 0 }}>Our Lists</Typography.Title>
              <Button type="primary" onClick={() => setCreateOpen(true)} icon={<Plus />}>New List</Button>
            </div>

            {listsQuery.isLoading ? (
              <div>Loading lists…</div>
            ) : lists.length === 0 ? (
              <Typography.Text type="secondary">No lists yet. Add one below.</Typography.Text>
            ) : (
              <AntList
                className="lists-list"
                itemLayout={isMobile ? 'vertical' : 'horizontal'}
                dataSource={lists}
                renderItem={(l) => (
                  <AntList.Item
                    style={{ cursor: 'pointer', paddingBlock: 16 }}
                    onClick={() => navigate(`/app/lists/${l.list_id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        navigate(`/app/lists/${l.list_id}`)
                      }
                    }}
                  >
                    <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <Typography.Link style={{ fontSize: 16 }}>
                          {l.icon ? <span style={{ marginRight: 8 }}>{toEmoji(l.icon)}</span> : null}
                          {l.name}
                        </Typography.Link>
                        {l.description && (
                          <div>
                            <Typography.Text type="secondary">{l.description}</Typography.Text>
                          </div>
                        )}
                      </div>
                      <Space>
                        <span onClick={(e) => e.stopPropagation()}>
                          <Dropdown
                            trigger={["click"]}
                            menu={{
                              items: [
                                { key: 'edit', label: 'Edit details' },
                                ...(l.deletion_votes && l.deletion_votes[userId]
                                  ? [{ key: 'cancel', label: 'Cancel delete vote' }]
                                  : [{ key: 'vote', label: 'Vote to delete' }]),
                              ],
                              onClick: ({ key }) => {
                                if (key === 'edit') onOpenEdit(l)
                                if (key === 'vote') onVoteList(l)
                                if (key === 'cancel') onCancelVoteList(l)
                              },
                            }}
                          >
                            <Button icon={<DotsThreeVertical />} aria-label="List actions" />
                          </Dropdown>
                        </span>
                        <CaretRight style={{ color: 'var(--color-primary)' }} />
                      </Space>
                    </div>
                  </AntList.Item>
                )}
              />
            )}

            {error && <Alert type="error" message={error} showIcon />}
          </Space>
        </Card>
      </div>

      {/* Create List Modal */}
      <Modal
        title="Add List"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setCreateOpen(false)} icon={<X />}>Cancel</Button>
            <Button type="primary" disabled={creating || !newName.trim()} onClick={onCreateList} icon={<Plus />}>Create</Button>
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="List name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
          <Input
            placeholder="Description (optional)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
          />
          <div>
            <Typography.Text type="secondary">Icon (optional)</Typography.Text>
            <IconPicker value={newIcon} onChange={setNewIcon} />
          </div>
        </Space>
      </Modal>

      {/* Edit List Modal */}
      <Modal
        title="Edit List"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setEditOpen(false)} icon={<X />}>Cancel</Button>
            <Button type="primary" disabled={editing || !editName.trim()} onClick={onSaveEdit} icon={<FloppyDisk />}>Save</Button>
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            placeholder="List name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            autoFocus
          />
          <Input
            placeholder="Description (optional)"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
          />
          <div>
            <Typography.Text type="secondary">Icon</Typography.Text>
            <IconPicker
              value={editIcon}
              onChange={(val) => { setEditIcon(val); setEditIconTouched(true) }}
            />
          </div>
        </Space>
      </Modal>
    </div>
  )
}
