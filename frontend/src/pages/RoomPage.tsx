import React, { useMemo, useState } from 'react'
import type { RoomView, List } from '@api/types'
import { useAuth } from '@auth/AuthProvider'
import { useNavigate, Link } from 'react-router-dom'
import { createList, getLists, rotateShare, voteListDeletion, cancelListDeletion } from '@api/endpoints'
import { Modal } from '@components/Modal'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLiveQueryOpts } from '@lib/liveQuery'

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
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="title">{room.display_name || 'House'}</div>
          <div className="row">
            <button className="button" onClick={onShare}>Share Code</button>
            <button className="button secondary" onClick={() => navigate('/app/settings')}>Settings</button>
            <button className="button secondary" onClick={() => setApiKey(null)}>Logout</button>
          </div>
        </div>

        <div className="spacer" />
        {room.description && <div className="muted">{room.description}</div>}
        <div className="spacer" />
        <div>Members: {room.members?.join(', ') || '—'}</div>
        <div className="spacer" />

        <Modal
          isOpen={shareOpen}
          title="Share House"
          onClose={() => setShareOpen(false)}
          footer={
            <div className="row">
              <button className="button" onClick={onShare}>Get new code</button>
              <button className="button secondary" onClick={() => setShareOpen(false)}>Done</button>
            </div>
          }
        >
          <div>
            {shareToken ? (
              <>
                <div>
                  Code: <code>{shareToken}</code> (5 chars, no I/O/L)
                </div>
                <div className="muted">Share this code with your partner.</div>
              </>
            ) : (
              <div>Generating code…</div>
            )}
          </div>
        </Modal>

        {/* Lists Panel */}
        <div className="spacer" />
        <div className="title">Lists</div>
        <div className="row" style={{ gap: 8 }}>
          <input
            placeholder="New list name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ flex: 1 }}
          />
          <input
            placeholder="Description (optional)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            style={{ flex: 2 }}
          />
          <button className="button" disabled={creating || !newName.trim()} onClick={onCreateList}>Create</button>
        </div>
        <div className="spacer" />
        {listsQuery.isLoading ? (
          <div>Loading lists…</div>
        ) : lists.length === 0 ? (
          <div className="muted">No lists yet. Create the first one above.</div>
        ) : (
          <div>
            {lists.map((l) => (
              <div key={l.list_id} className="row" style={{ alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #eee' }}>
                <div>
                  <div><Link to={`/app/lists/${l.list_id}`}>{l.name}</Link></div>
                  {l.description && <div className="muted" style={{ fontSize: 12 }}>{l.description}</div>}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  {myVote(l) ? (
                    <button className="button secondary" onClick={() => onCancelVoteList(l)}>Cancel vote</button>
                  ) : (
                    <button className="button danger" onClick={() => onVoteList(l)}>Request delete</button>
                  )}
                  <button className="button" onClick={() => navigate(`/app/lists/${l.list_id}`)}>Open</button>
                </div>
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
