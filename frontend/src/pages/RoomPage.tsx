import React, { useState } from 'react'
import type { RoomView } from '@api/types'
import { useAuth } from '@auth/AuthProvider'
import { useNavigate } from 'react-router-dom'
import { rotateShare } from '@api/endpoints'

export const RoomPage: React.FC<{ room: RoomView }> = ({ room }) => {
  const { apiKey, setApiKey } = useAuth()
  const navigate = useNavigate()
  const [share, setShare] = useState<{ token: string } | null>(null)
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

  return (
    <div className="container">
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="title">{room.display_name || 'Room'}</div>
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

        {share && (
          <>
            <div className="spacer" />
            <div className="panel">
              <div className="title">Share</div>
              <div className="spacer" />
              <div>
                Code: <code>{share.token}</code> (5 chars, no I/O/L)
              </div>
              <div className="muted">Share this code with your partner.</div>
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
