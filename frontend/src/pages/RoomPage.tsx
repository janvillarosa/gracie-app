import React, { useEffect, useMemo, useRef, useState } from 'react'
import { errorMessage } from '@lib/errors'
import type { RoomView, List } from '@api/types'
import { useAuth } from '@auth/AuthProvider'
import { useTransitionNavigate } from '@lib/viewTransition'
import {
  createList,
  getLists,
  rotateShare,
  voteListDeletion,
  cancelListDeletion,
  updateList,
} from '@api/endpoints'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLiveQueryOpts } from '@lib/liveQuery'
import {
  Card,
  Typography,
  Space,
  Button,
  Modal,
  Input,
  List as AntList,
  Dropdown,
  message,
} from 'antd'
import {
  DotsThreeVertical,
  CaretRight,
  ShareNetwork,
  Plus,
  FloppyDisk,
  X,
  GearSix,
} from '@phosphor-icons/react'
import type { MenuProps } from 'antd'
import { IconPicker } from '@components/IconPicker'
import { AvatarBadge } from '@components/AvatarBadge'
import { ShareCodeModal } from '@components/ShareCodeModal'
import { TopNav } from '@components/TopNav'
import { TransitionLink } from '@components/TransitionLink'
import { RowSkeleton } from '@components/RowSkeleton'
import { PillNav } from '@components/PillNav'
import { TripNameModal } from '@components/trips/NewTripModal'
import { TripsPanel } from '@components/trips/TripsPanel'
import { useTripState, useTripStoreFor } from '@lib/trips/hooks'
import { localDateKey, tripPhase } from '@lib/trips/schedule'
import { toEmoji } from '../icons'
import type { ListIcon } from '@api/types'
import { useDocumentTitle } from '@lib/useDocumentTitle'

const PILL_KEY = 'bauhouse_house_pill'
export const lastHousePill = (): 'lists' | 'trips' => {
  try {
    return localStorage.getItem(PILL_KEY) === 'trips' ? 'trips' : 'lists'
  } catch {
    return 'lists'
  }
}

export const RoomPage: React.FC<{
  room: RoomView
  roomId: string
  userId: string
  // Which pill the URL asks for: /app is Lists, /app/trips is Trips.
  tab?: 'lists' | 'trips'
}> = ({ room, roomId, userId, tab = 'lists' }) => {
  const { apiKey } = useAuth()
  const navigate = useTransitionNavigate()
  useDocumentTitle(room.display_name || 'House')
  const [shareOpen, setShareOpen] = useState(false)
  const [shareToken, setShareToken] = useState<string | null>(null)

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
  const tripStore = useTripStoreFor(roomId, userId, apiKey)
  const tripState = useTripState(tripStore)
  const [newTripOpen, setNewTripOpen] = useState(false)
  const today = localDateKey()
  const liveNow = Object.values(tripState.trips).some(
    (t) => !t.deleted && tripPhase(t, today) === 'during',
  )
  const onTab = (k: string) => {
    const next = k === 'trips' ? 'trips' : 'lists'
    try {
      localStorage.setItem(PILL_KEY, next)
    } catch {}
    navigate(next === 'trips' ? '/app/trips' : '/app')
  }
  // The pill is remembered for this viewer; the URL is what is shown.
  useEffect(() => {
    try {
      localStorage.setItem(PILL_KEY, tab)
    } catch {}
  }, [tab])

  const onShare = async () => {
    try {
      const r = await rotateShare(apiKey!)
      setShareToken(r.token)
      setShareOpen(true)
    } catch (e: any) {
      message.error(errorMessage(e, 'Couldn’t get your share code. Try again.'))
    }
  }

  const parseMs = (v: any, def: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : def
  }
  const listsMs = parseMs((import.meta as any).env?.VITE_LIVE_QUERY_LISTS_MS, 4000)
  const liveOpts = useLiveQueryOpts(listsMs)
  const listsQuery = useQuery({
    queryKey: ['lists', roomId],
    queryFn: () => getLists(apiKey!, roomId),
    ...liveOpts,
  })
  const lists = listsQuery.data ?? []
  // Rows that replace a skeleton fade in; rows already cached just appear with the sheet.
  const listsWereLoading = useRef(false)
  if (listsQuery.isLoading) listsWereLoading.current = true

  // Deletion actions removed from dashboard; keep minimal helpers only if needed elsewhere

  const onCreateList = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      await createList(apiKey!, roomId, {
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        icon: newIcon,
      })
      setNewName('')
      setNewDesc('')
      setNewIcon(undefined)
      setCreateOpen(false)
      await qc.invalidateQueries({ queryKey: ['lists', roomId] })
    } catch (e: any) {
      message.error(errorMessage(e, 'Couldn’t create the list. Try again.'))
    } finally {
      setCreating(false)
    }
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
    if (!editName.trim()) {
      message.error('Give the list a name.')
      return
    }
    setEditing(true)
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
      message.error(errorMessage(e, 'Couldn’t save the list. Try again.'))
    } finally {
      setEditing(false)
    }
  }

  const onVoteList = async (l: List) => {
    try {
      await voteListDeletion(apiKey!, roomId, l.list_id)
      await qc.invalidateQueries({ queryKey: ['lists', roomId] })
    } catch (e: any) {
      message.error(errorMessage(e, 'Couldn’t record your vote. Try again.'))
    }
  }
  const onCancelVoteList = async (l: List) => {
    try {
      await cancelListDeletion(apiKey!, roomId, l.list_id)
      await qc.invalidateQueries({ queryKey: ['lists', roomId] })
    } catch (e: any) {
      message.error(errorMessage(e, 'Couldn’t cancel your vote. Try again.'))
    }
  }

  return (
    <div className="container">
      <TopNav />
      <div className="paper-stack">
        {/* Bottom meta sheet: title/description/share */}
        <Card className="paper-card paper-meta">
          <Typography.Title level={2} style={{ margin: 0 }}>
            {room.display_name || 'House'}
          </Typography.Title>

          {room.description && (
            <div style={{ marginTop: 8 }}>
              <Typography.Text type="secondary">{room.description}</Typography.Text>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              paddingTop: 15,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Typography.Text type="secondary">Members:</Typography.Text>
              <Space size={8} wrap>
                {(room as any).members_meta?.length ? (
                  (room as any).members_meta.map((m: any, idx: number) => (
                    <AvatarBadge
                      key={idx}
                      seed={m.avatar_key}
                      name={m.name}
                      size={35}
                      style="miniavs"
                    />
                  ))
                ) : (
                  <span>{room.members?.join(', ') || '—'}</span>
                )}
              </Space>
            </div>

            <Space>
              <Button onClick={onShare} icon={<ShareNetwork />} shape="round">
                Share code
              </Button>
              <Button
                icon={<GearSix size={20} />}
                shape="circle"
                type="text"
                aria-label="House settings"
                title="House settings"
                onClick={() => navigate('/app/settings')}
              />
            </Space>
          </div>
        </Card>

        {/* The second sheet: a pill switch between Lists and Trips, with the section's key. */}
        <Card className="paper-card paper-list">
          <PillNav
            label="House sections"
            value={tab}
            onChange={onTab}
            extra={
              tab === 'trips' ? (
                <Button
                  type="primary"
                  shape="round"
                  onClick={() => setNewTripOpen(true)}
                  icon={<Plus />}
                >
                  New trip
                </Button>
              ) : (
                <Button
                  type="primary"
                  shape="round"
                  onClick={() => setCreateOpen(true)}
                  icon={<Plus />}
                >
                  New list
                </Button>
              )
            }
            items={[
              {
                key: 'lists',
                label: 'Lists',
                children: listsQuery.isLoading ? (
                  <RowSkeleton variant="list" rows={3} label="Loading your lists" />
                ) : lists.length === 0 ? (
                  <Typography.Text type="secondary">
                    No lists yet. Create one with New list.
                  </Typography.Text>
                ) : (
                  <AntList
                    className={listsWereLoading.current ? 'lists-list is-arriving' : 'lists-list'}
                    dataSource={lists}
                    renderItem={(l) => {
                      // A trip's packing list says whose it is.
                      const packing = l.name.startsWith('Packing · ')
                      const icon = l.icon ? toEmoji(l.icon) : packing ? '🧳' : null
                      const meta = packing
                        ? `For ${l.name.slice('Packing · '.length)}`
                        : l.description
                      return (
                        <AntList.Item>
                          <TransitionLink to={`/app/lists/${l.list_id}`} className="list-row-link">
                            {icon ? (
                              <span className="list-icon" aria-hidden>
                                {icon}
                              </span>
                            ) : null}
                            <span className="list-row-text">
                              <span className="list-row-name">{packing ? 'Packing' : l.name}</span>
                              {meta && (
                                <Typography.Text type="secondary" className="list-row-desc">
                                  {meta}
                                </Typography.Text>
                              )}
                            </span>
                          </TransitionLink>
                          <Dropdown
                            trigger={['click']}
                            placement="bottomRight"
                            menu={{
                              items: [
                                { key: 'edit', label: 'Edit details' },
                                ...(l.deletion_votes && l.deletion_votes[userId]
                                  ? [{ key: 'cancel', label: 'Cancel delete vote' }]
                                  : [{ key: 'vote', label: 'Vote to delete list' }]),
                              ],
                              onClick: ({ key }) => {
                                if (key === 'edit') onOpenEdit(l)
                                if (key === 'vote') onVoteList(l)
                                if (key === 'cancel') onCancelVoteList(l)
                              },
                            }}
                          >
                            <Button
                              className="list-row-menu"
                              icon={<DotsThreeVertical size={20} weight="bold" />}
                              type="text"
                              shape="circle"
                              aria-label={`Actions for ${l.name}`}
                            />
                          </Dropdown>
                          <CaretRight
                            className="list-row-caret"
                            size={18}
                            weight="bold"
                            aria-hidden
                          />
                        </AntList.Item>
                      )
                    }}
                  />
                ),
              },
              {
                key: 'trips',
                label: 'Trips',
                ariaLabel: liveNow ? 'Trips, one happening now' : undefined,
                children: (
                  <TripsPanel trips={tripState.trips} store={tripStore} ready={tripState.ready} />
                ),
              },
            ]}
          />
        </Card>
      </div>

      {newTripOpen && tripStore && (
        <TripNameModal
          title="Name your trip"
          cta="Create trip"
          onCancel={() => setNewTripOpen(false)}
          onSubmit={(title) => {
            const id = tripStore.createTrip({
              title,
              tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
            })
            setNewTripOpen(false)
            navigate(`/app/trips/${id}`)
          }}
        />
      )}

      <ShareCodeModal
        open={shareOpen}
        token={shareToken}
        onClose={() => setShareOpen(false)}
        onRotate={async () => {
          try {
            const r = await rotateShare(apiKey!)
            setShareToken(r.token)
          } catch (e: any) {
            message.error(errorMessage(e, 'Couldn’t make a new code. Try again.'))
          }
        }}
      />

      {/* Create List Modal */}
      <Modal
        title="Add list"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setCreateOpen(false)} icon={<X />}>
              Cancel
            </Button>
            <Button
              type="primary"
              disabled={creating || !newName.trim()}
              onClick={onCreateList}
              icon={<Plus />}
            >
              Create
            </Button>
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
        title="Edit list"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setEditOpen(false)} icon={<X />}>
              Cancel
            </Button>
            <Button
              type="primary"
              disabled={editing || !editName.trim()}
              onClick={onSaveEdit}
              icon={<FloppyDisk />}
            >
              Save
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size="large" style={{ width: '100%', paddingTop: 8 }}>
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
              onChange={(val) => {
                setEditIcon(val)
                setEditIconTouched(true)
              }}
            />
          </div>
        </Space>
      </Modal>
    </div>
  )
}
