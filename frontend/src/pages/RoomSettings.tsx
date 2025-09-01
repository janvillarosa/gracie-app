import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@auth/AuthProvider'
import { rotateShare, voteDeletion, cancelDeletion, updateRoomSettings } from '@api/endpoints'
import { Modal } from '@components/Modal'
import { useQueryClient } from '@tanstack/react-query'

const NAME_RE = /^[A-Za-z0-9 ]+$/

export const RoomSettings: React.FC = () => {
  const { apiKey } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const nameValid = useMemo(() => !displayName || (displayName.length <= 64 && NAME_RE.test(displayName)), [displayName])

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (displayName && !nameValid) {
      setError('Display name must be alphanumeric with spaces, up to 64 chars')
      return
    }
    if (description.length > 512) {
      setError('Description too long')
      return
    }
    setSaving(true)
    try {
      await updateRoomSettings(apiKey!, { display_name: displayName || undefined, description })
      setSuccess('Saved')
      qc.invalidateQueries({ queryKey: ['my-room'] })
    } catch (e: any) {
      setError(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const onShare = async () => {
    setError(null)
    setSuccess(null)
    try {
      const r = await rotateShare(apiKey!)
      setShareToken(r.token)
      setShareOpen(true)
    } catch (e: any) {
      setError(e?.message || 'Failed to rotate share code')
    }
  }

  const onVoteDelete = async () => {
    setError(null)
    setSuccess(null)
    try {
      const res = await voteDeletion(apiKey!)
      if (res.deleted) {
        // Room deleted; go back to dashboard
        navigate('/app', { replace: true })
      } else {
        setSuccess('Deletion vote recorded')
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to vote deletion')
    }
  }

  const onCancelVote = async () => {
    setError(null)
    setSuccess(null)
    try {
      await cancelDeletion(apiKey!)
      setSuccess('Deletion vote canceled')
    } catch (e: any) {
      setError(e?.message || 'Failed to cancel vote')
    }
  }

  return (
    <div className="container">
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="title">House Settings</div>
          <button className="button secondary" onClick={() => navigate('/app')}>Back</button>
        </div>
        <div className="spacer" />
        <form className="col" onSubmit={onSave}>
          <input className="input" placeholder="Display name (alphanumeric + spaces)" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <textarea className="input" placeholder="Description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          <button className="button" disabled={saving || (!displayName && !description) || !nameValid}>Save</button>
        </form>
        <div className="spacer" />
        <div className="row">
          <button className="button" onClick={onShare}>Get share code</button>
          <button className="button danger" onClick={onVoteDelete}>Vote to delete house</button>
          <button className="button secondary" onClick={onCancelVote}>Cancel vote</button>
        </div>
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
        {success && (
          <>
            <div className="spacer" />
            <div>{success}</div>
          </>
        )}
      </div>
    </div>
  )
}
