import React, { useState } from 'react'
import type { Room } from '@api/types'
import { useAuth } from '@auth/AuthProvider'
import { rotateShare, voteDeletion, cancelDeletion } from '@api/endpoints'

export const RoomPage: React.FC<{ room: Room }> = ({ room }) => {
  const { apiKey, setApiKey } = useAuth()
  const [share, setShare] = useState<{ room_id: string; token: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onShare = async () => {
    setError(null)
    try {
      const r = await rotateShare(apiKey!)
      setShare(r)
    } catch (e: any) {
      setError(e?.message || 'Failed to get share token')
    }
  }

  const onVoteDelete = async () => {
    setError(null)
    try {
      const res = await voteDeletion(apiKey!)
      if (res.deleted) {
        // After deletion, user has no room; simplest is reload dashboard
        window.location.reload()
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to vote deletion')
    }
  }

  const onCancelVote = async () => {
    setError(null)
    try {
      await cancelDeletion(apiKey!)
      alert('Vote canceled')
    } catch (e: any) {
      setError(e?.message || 'Failed to cancel vote')
    }
  }

  return (
    <div className="container">
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="title">Room {room.room_id}</div>
          <button className="button secondary" onClick={() => setApiKey(null)}>Logout</button>
        </div>

        <div className="spacer" />
        <div>Members: {room.member_ids.join(', ') || '—'}</div>
        <div className="spacer" />

        <div className="row">
          <button className="button" onClick={onShare}>Get 5-char share code</button>
          <button className="button danger" onClick={onVoteDelete}>Vote to delete room</button>
          <button className="button secondary" onClick={onCancelVote}>Cancel delete vote</button>
        </div>

        {share && (
          <>
            <div className="spacer" />
            <div className="panel">
              <div className="title">Share</div>
              <div className="spacer" />
              <div>
                Room ID: <code>{share.room_id}</code>
              </div>
              <div>
                Code: <code>{share.token}</code> (5 chars, no I/O/L)
              </div>
              <div className="muted">Share both Room ID and Code with your partner.</div>
            </div>
          </>
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

