import React, { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@auth/AuthProvider'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMe, getListItems, getLists, createListItem, updateListItem, deleteListItem, voteListDeletion, cancelListDeletion } from '@api/endpoints'
import type { List, ListItem } from '@api/types'

export const ListPage: React.FC = () => {
  const { apiKey } = useAuth()
  const navigate = useNavigate()
  const { listId = '' } = useParams()
  const [includeCompleted, setIncludeCompleted] = useState(false)
  const [newDesc, setNewDesc] = useState('')
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()

  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => getMe(apiKey!) })
  const roomId = meQuery.data?.room_id as string | undefined
  const userId = meQuery.data?.user_id as string | undefined

  const listsQuery = useQuery({
    queryKey: ['lists', roomId],
    queryFn: () => getLists(apiKey!, roomId!),
    enabled: !!roomId,
  })
  const listMeta: List | undefined = useMemo(() => listsQuery.data?.find(l => l.list_id === listId), [listsQuery.data, listId])

  const itemsQuery = useQuery({
    queryKey: ['list-items', listId, includeCompleted],
    queryFn: () => getListItems(apiKey!, roomId!, listId, includeCompleted),
    enabled: !!roomId && !!listId,
  })

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
      await voteListDeletion(apiKey!, roomId!, listId)
      await qc.invalidateQueries({ queryKey: ['lists', roomId] })
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
    return <div className="container"><div className="panel">Loading…</div></div>
  }
  if (!roomId || !listMeta) {
    return <div className="container"><div className="panel"><div className="error">List not found.</div><div className="spacer" /><button className="button" onClick={() => navigate('/app')}>Back to House</button></div></div>
  }

  const items = itemsQuery.data ?? []

  return (
    <div className="container">
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="title">{listMeta.name}</div>
          <div className="row" style={{ gap: 8 }}>
            {myVote(listMeta) ? (
              <button className="button secondary" onClick={onCancelVote}>Cancel delete vote</button>
            ) : (
              <button className="button danger" onClick={onVoteDelete}>Request delete</button>
            )}
            <button className="button secondary" onClick={() => navigate('/app')}>Back</button>
          </div>
        </div>
        {listMeta.description && <div className="muted">{listMeta.description}</div>}

        <div className="spacer" />
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input
            placeholder="Add an item"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="button" onClick={onCreateItem} disabled={!newDesc.trim()}>Add</button>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={includeCompleted} onChange={(e) => setIncludeCompleted(e.target.checked)} />
            Show completed
          </label>
        </div>

        <div className="spacer" />
        {items.length === 0 ? (
          <div className="muted">{includeCompleted ? 'No items yet.' : 'No incomplete items.'}</div>
        ) : (
          <div>
            {items.map((it) => (
              <div key={it.item_id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #eee' }}>
                <label className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={it.completed} onChange={() => onToggleComplete(it)} />
                  <span style={{ textDecoration: it.completed ? 'line-through' : 'none' }}>{it.description}</span>
                </label>
                <button className="button secondary" onClick={() => onDeleteItem(it)}>Delete</button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <>
            <div className="spacer" />
            <div className="error">{error}</div>
          </>
        )}
      </div>
    </div>
  )
}

