import React, { useEffect, useRef, useState } from 'react'
import { errorMessage } from '@lib/errors'
import { deviceZone } from '@lib/trips/limits'
import type { RoomView, List, ListIcon } from '@api/types'
import { useAuth } from '@auth/AuthProvider'
import { useNavigate } from 'react-router-dom'
import { useTransitionNavigate } from '@lib/viewTransition'
import {
  createList,
  getLists,
  voteListDeletion,
  cancelListDeletion,
  updateList,
} from '@api/endpoints'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLiveQueryOpts } from '@lib/liveQuery'
import { Card, List as AntList, Dropdown, message } from 'antd'
import {
  DotsThreeVertical,
  CaretRight,
  Plus,
  GearSix,
  ListBullets,
  UserPlus,
} from '@phosphor-icons/react'
import { IconPicker } from '@components/IconPicker'
import { AvatarStack } from '@components/AvatarStack'
import { ShareCodeSheet } from '@components/ShareCodeSheet'
import { DeleteVoteSheet } from '@components/DeleteVoteSheet'
import { TopNav } from '@components/TopNav'
import { TransitionLink } from '@components/TransitionLink'
import { RowSkeleton } from '@components/RowSkeleton'
import { PillNav } from '@components/PillNav'
import { TripNameModal } from '@components/trips/NewTripModal'
import { TripsPanel } from '@components/trips/TripsPanel'
import { useTripState, useTripStoreFor } from '@lib/trips/hooks'
import { localDateKey, tripPhase } from '@lib/trips/schedule'
import { toEmoji } from '../icons'
import {
  Button,
  DetailGroup,
  EmptyState,
  Field,
  NavRow,
  Sheet,
  SheetActions,
  Stamp,
} from '@components/ui'
import { useDocumentTitle } from '@lib/useDocumentTitle'

const PILL_KEY = 'bauhouse_house_pill'
export const lastHousePill = (): 'lists' | 'trips' => {
  try {
    return localStorage.getItem(PILL_KEY) === 'trips' ? 'trips' : 'lists'
  } catch {
    return 'lists'
  }
}

type Member = { name: string; avatar_key: string; user_id?: string }

/** "Just you", "Mia and Sam", "Mia, Sam and Jo", "Mia, Sam and 2 more". */
export const memberLine = (members: Member[], me?: string): string => {
  if (members.length <= 1)
    return members.length && members[0].user_id !== me ? members[0].name : 'Just you'
  const names = members.map((m) => m.name)
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`
}

const packingOf = (l: List) => l.name.startsWith('Packing · ')

export const RoomPage: React.FC<{
  room: RoomView
  roomId: string
  userId: string
  // Which pill the URL asks for: /app is Lists, /app/trips is Trips.
  tab?: 'lists' | 'trips'
}> = ({ room, roomId, userId, tab = 'lists' }) => {
  const { apiKey } = useAuth()
  const navigate = useTransitionNavigate()
  // A pill switch is not a new page: PillNav slides its own pane, so no whole-page cross-fade.
  const navigateInPlace = useNavigate()
  const houseName = room.display_name || 'House'
  useDocumentTitle(houseName)
  const qc = useQueryClient()
  const members: Member[] =
    room.members_meta ?? room.members.map((name) => ({ name, avatar_key: name }))
  const memberCount = Math.max(members.length, 1)

  const [shareOpen, setShareOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newIcon, setNewIcon] = useState<ListIcon | undefined>(undefined)
  // Edit list: the sheet autosaves each field as it is committed.
  const [editTarget, setEditTarget] = useState<List | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editIcon, setEditIcon] = useState<ListIcon | undefined>(undefined)
  const [deleting, setDeleting] = useState<List | null>(null)

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
    navigateInPlace(next === 'trips' ? '/app/trips' : '/app')
  }
  // The pill is remembered for this viewer; the URL is what is shown.
  useEffect(() => {
    try {
      localStorage.setItem(PILL_KEY, tab)
    } catch {}
  }, [tab])

  const parseMs = (v: unknown, def: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : def
  }
  const listsMs = parseMs(import.meta.env?.VITE_LIVE_QUERY_LISTS_MS, 4000)
  const liveOpts = useLiveQueryOpts(listsMs)
  const listsQuery = useQuery({
    queryKey: ['lists', roomId],
    queryFn: () => getLists(apiKey as string, roomId),
    ...liveOpts,
  })
  const lists = listsQuery.data ?? []
  // Rows that replace a skeleton fade in; rows already cached just appear with the sheet.
  const listsWereLoading = useRef(false)
  if (listsQuery.isLoading) listsWereLoading.current = true
  const refreshLists = () => qc.invalidateQueries({ queryKey: ['lists', roomId] })

  const votesOf = (l: List) => Object.keys(l.deletion_votes ?? {})
  const othersVoted = (l: List) => votesOf(l).filter((id) => id !== userId).length
  const iVoted = (l: List) => !!l.deletion_votes?.[userId]
  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.name

  const closeCreate = () => {
    setCreateOpen(false)
    setNewName('')
    setNewDesc('')
    setNewIcon(undefined)
  }
  const onCreateList = async () => {
    if (!newName.trim() || creating) return
    setCreating(true)
    try {
      await createList(apiKey as string, roomId, {
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        icon: newIcon,
      })
      closeCreate()
      await refreshLists()
    } catch (e) {
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
  }
  const saveList = async (
    l: List,
    body: { name?: string; description?: string; icon?: ListIcon | '' },
  ) => {
    try {
      const updated = await updateList(apiKey as string, roomId, l.list_id, body)
      setEditTarget((t) => (t && t.list_id === l.list_id ? { ...t, ...updated } : t))
      await refreshLists()
    } catch (e) {
      message.error(errorMessage(e, 'Couldn’t save the list. Try again.'))
    }
  }
  // Commits whatever changed in the text fields: on blur, on Enter and on close.
  const commitEdit = () => {
    if (!editTarget) return
    const name = editName.trim()
    const desc = editDesc.trim()
    const body: { name?: string; description?: string } = {}
    if (name && name !== editTarget.name) body.name = name
    if (desc !== (editTarget.description || '')) body.description = desc
    if (!name) setEditName(editTarget.name)
    if (Object.keys(body).length) void saveList(editTarget, body)
  }
  const closeEdit = () => {
    commitEdit()
    setEditTarget(null)
  }

  const onVoteList = async (l: List) => {
    try {
      const r = await voteListDeletion(apiKey as string, roomId, l.list_id)
      setDeleting(null)
      setEditTarget(null)
      message.success(r.deleted ? `Deleted ${l.name}.` : 'Vote recorded.')
      await refreshLists()
    } catch (e) {
      message.error(errorMessage(e, 'Couldn’t record your vote. Try again.'))
    }
  }
  const onCancelVoteList = async (l: List) => {
    try {
      await cancelListDeletion(apiKey as string, roomId, l.list_id)
      setEditTarget((t) => (t && t.list_id === l.list_id ? { ...t, deletion_votes: undefined } : t))
      await refreshLists()
    } catch (e) {
      message.error(errorMessage(e, 'Couldn’t cancel your vote. Try again.'))
    }
  }

  // Who has voted to delete a list, in words, for its sheet's footer.
  const voteLine = (l: List) => {
    const ids = votesOf(l)
    if (!ids.length) return ''
    const names = ids.map((id) => (id === userId ? 'You' : (nameOf(id) ?? 'Someone')))
    return `${names.join(' and ')} voted to delete it.`
  }

  const listRows = (
    <AntList
      className={listsWereLoading.current ? 'lists-list is-arriving' : 'lists-list'}
      dataSource={lists}
      renderItem={(l) => {
        // A trip's packing list says whose it is.
        const packing = packingOf(l)
        const icon = l.icon ? toEmoji(l.icon) : packing ? '🧳' : null
        const meta = packing ? `For ${l.name.slice('Packing · '.length)}` : l.description
        const votes = votesOf(l).length
        return (
          <AntList.Item>
            <TransitionLink to={`/app/lists/${l.list_id}`} className="list-row-link">
              <span className={icon ? 'list-icon' : 'list-icon is-blank'} aria-hidden>
                {icon ?? <ListBullets weight="bold" />}
              </span>
              <span className="list-row-text">
                <span className="list-row-name">{packing ? 'Packing' : l.name}</span>
                {meta && <span className="list-row-desc">{meta}</span>}
                {votes > 0 && (
                  <span className="list-row-vote">
                    <Stamp>{`Delete vote ${votes} of ${memberCount}`}</Stamp>
                  </span>
                )}
              </span>
            </TransitionLink>
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              menu={{
                items: [
                  { key: 'edit', label: 'Edit details' },
                  iVoted(l)
                    ? { key: 'cancel', label: 'Cancel my delete vote' }
                    : {
                        key: 'vote',
                        label: othersVoted(l) + 1 >= memberCount ? 'Delete list' : 'Vote to delete',
                        danger: true,
                      },
                ],
                onClick: ({ key }) => {
                  if (key === 'edit') onOpenEdit(l)
                  if (key === 'vote') setDeleting(l)
                  if (key === 'cancel') void onCancelVoteList(l)
                },
              }}
            >
              <Button
                kind="text"
                iconOnly
                className="list-row-menu"
                icon={<DotsThreeVertical size={20} weight="bold" />}
                aria-label={`Actions for ${l.name}`}
              />
            </Dropdown>
            <CaretRight className="list-row-caret" size={18} weight="bold" aria-hidden />
          </AntList.Item>
        )
      }}
    />
  )

  return (
    <div className="container">
      <TopNav />
      <div className="paper-stack">
        {/* Bottom meta sheet: the House, who is in it, and the way to invite someone. */}
        <Card className="paper-card paper-meta house-meta">
          <h1 className="house-title">{houseName}</h1>
          {room.description && <p className="house-desc">{room.description}</p>}
          <div className="house-meta-row">
            <div className="house-members">
              <AvatarStack members={members} label={`Members: ${memberLine(members, userId)}`} />
              {/* Said by the stack's label already; this is for the eye. */}
              <span className="house-members-line" aria-hidden>
                {memberLine(members, userId)}
              </span>
            </div>
            <div className="house-meta-actions">
              <Button
                kind="quiet"
                icon={<UserPlus aria-hidden />}
                onClick={() => setShareOpen(true)}
              >
                Invite
              </Button>
              <Button
                kind="text"
                iconOnly
                icon={<GearSix size={20} aria-hidden />}
                aria-label="House settings"
                title="House settings"
                onClick={() => navigate('/app/settings')}
              />
            </div>
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
                  kind="key"
                  // Not before the device's own copy has loaded, so nothing is made out of order.
                  disabled={!tripState.ready}
                  onClick={() => setNewTripOpen(true)}
                  icon={<Plus aria-hidden />}
                >
                  New trip
                </Button>
              ) : (
                <Button kind="key" onClick={() => setCreateOpen(true)} icon={<Plus aria-hidden />}>
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
                ) : listsQuery.isError && lists.length === 0 ? (
                  <EmptyState
                    title="Couldn’t load your lists"
                    action={
                      <Button kind="quiet" onClick={() => void listsQuery.refetch()}>
                        Try again
                      </Button>
                    }
                  >
                    {errorMessage(listsQuery.error, 'Check your connection.')}
                  </EmptyState>
                ) : lists.length === 0 ? (
                  <EmptyState title="No lists yet">
                    Groceries, chores, a wish list: start one with New list.
                  </EmptyState>
                ) : (
                  listRows
                ),
              },
              {
                key: 'trips',
                label: (
                  <span className="pill-label">
                    Trips
                    {liveNow && tab !== 'trips' && <span className="pill-dot" aria-hidden />}
                  </span>
                ),
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
          context="Dates and places can come later."
          onCancel={() => setNewTripOpen(false)}
          onSubmit={(title) => {
            const id = tripStore.createTrip({
              title,
              // The canonical zone name, or nothing when the browser cannot say.
              ...(deviceZone() ? { tz: deviceZone() } : {}),
            })
            setNewTripOpen(false)
            navigate(`/app/trips/${id}`)
          }}
        />
      )}

      <ShareCodeSheet open={shareOpen} onClose={() => setShareOpen(false)} houseName={houseName} />

      {/* New list: the name is the title, typed in place; one key. */}
      <Sheet
        open={createOpen}
        label="New list"
        onClose={closeCreate}
        dirty={!creating && (!!newName.trim() || !!newDesc.trim() || !!newIcon)}
        identity={
          <div className="ui-sheet-identity">
            <div className="ui-sheet-identity-text">
              <Field
                className="ui-sheet-title"
                placeholder="List name"
                aria-label="List name"
                value={newName}
                maxLength={120}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void onCreateList()
                }}
                // biome-ignore lint/a11y/noAutofocus: the sheet opens because the user asked for it
                autoFocus
              />
              <p className="ui-sheet-context">Everyone in {houseName} can see it.</p>
            </div>
          </div>
        }
        actions={
          <SheetActions>
            <Button
              kind="key"
              disabled={creating || !newName.trim()}
              onClick={() => void onCreateList()}
            >
              {creating ? 'Creating…' : 'Create list'}
            </Button>
          </SheetActions>
        }
        details={
          <DetailGroup label="Details">
            <div className="ui-fieldrow">
              <span className="ui-navrow-label">Description</span>
              <Field
                aria-label="Description"
                placeholder="Optional"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
            </div>
            <NavRow
              label="Icon"
              value={newIcon ? toEmoji(newIcon) : 'None'}
              empty={!newIcon}
              picker={{
                title: 'Icon',
                content: (close) => (
                  <IconPicker
                    value={newIcon}
                    onChange={(v) => {
                      setNewIcon(v)
                      close()
                    }}
                  />
                ),
              }}
            />
          </DetailGroup>
        }
      />

      {/* Edit list: everything saves as it changes; the vote to delete is the footer. */}
      <Sheet
        open={!!editTarget}
        label={editTarget ? `Edit ${editTarget.name}` : 'Edit list'}
        onClose={closeEdit}
        identity={
          <div className="ui-sheet-identity">
            <div className="ui-sheet-identity-text">
              <Field
                className="ui-sheet-title"
                placeholder="List name"
                aria-label="List name"
                value={editName}
                maxLength={120}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
              />
              <p className="ui-sheet-context">In {houseName}</p>
            </div>
          </div>
        }
        details={
          <DetailGroup label="Details">
            <div className="ui-fieldrow">
              <span className="ui-navrow-label">Description</span>
              <Field
                aria-label="Description"
                placeholder="Optional"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
              />
            </div>
            <NavRow
              label="Icon"
              value={editIcon ? toEmoji(editIcon) : 'None'}
              empty={!editIcon}
              picker={{
                title: 'Icon',
                content: (close) => (
                  <IconPicker
                    value={editIcon}
                    onChange={(v) => {
                      setEditIcon(v)
                      close()
                      if (editTarget) void saveList(editTarget, { icon: v ?? '' })
                    }}
                  />
                ),
              }}
            />
          </DetailGroup>
        }
        footer={
          editTarget && (
            <footer className="ui-sheet-footer">
              <span className="ui-sheet-who">{voteLine(editTarget)}</span>
              {iVoted(editTarget) ? (
                <Button kind="text" onClick={() => void onCancelVoteList(editTarget)}>
                  Cancel my vote
                </Button>
              ) : (
                <Button kind="text" danger onClick={() => setDeleting(editTarget)}>
                  {othersVoted(editTarget) + 1 >= memberCount ? 'Delete list' : 'Vote to delete'}
                </Button>
              )}
            </footer>
          )
        }
      />

      {deleting && (
        <DeleteVoteSheet
          open
          kind="list"
          name={deleting.name}
          members={memberCount}
          othersVoted={othersVoted(deleting)}
          onClose={() => setDeleting(null)}
          onConfirm={() => onVoteList(deleting)}
        />
      )}
    </div>
  )
}
