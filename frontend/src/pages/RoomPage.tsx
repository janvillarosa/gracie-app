import React, { useState } from 'react'
import type { RoomView } from '@api/types'
import { useAuth } from '@auth/AuthProvider'
import { useNavigate } from 'react-router-dom'
import { rotateShare } from '@api/endpoints'
import { Modal } from '@components/Modal'

export const RoomPage: React.FC<{ room: RoomView }> = ({ room }) => {
  const { apiKey, setApiKey } = useAuth()
  const navigate = useNavigate()
  const [shareOpen, setShareOpen] = useState(false)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
