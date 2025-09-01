import React, { useMemo, useState } from 'react'
import { useAuth } from '@auth/AuthProvider'
import { createRoom, isConflict, isForbidden, joinRoomByToken } from '@api/endpoints'

const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ0123456789' // no I, O, L

export const NoRoomPage: React.FC = () => {
  const { apiKey, setApiKey } = useAuth()
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const tokenValid = useMemo(() => token.length === 5 && [...token].every((c) => TOKEN_ALPHABET.includes(c)), [token])

  const onCreate = async () => {
    setError(null)
    setLoading(true)
    try {
      await createRoom(apiKey!)
      window.location.reload()
    } catch (e: any) {
      setError(e?.message || 'Failed to create house')
    } finally {
      setLoading(false)
    }
  }

  const onJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await joinRoomByToken(apiKey!, token.trim().toUpperCase())
      window.location.reload()
    } catch (e: any) {
      if (isForbidden(e)) setError('Invalid code for this house.')
      else if (isConflict(e)) setError('Join not allowed: the house may be full.')
      else setError(e?.message || 'Failed to join house')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="title">You are not in a house yet</div>
          <button className="button secondary" onClick={() => setApiKey(null)}>Logout</button>
        </div>
        <div className="spacer" />
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="col" style={{ flex: 1 }}>
            <div className="title">Create a new house</div>
            <button className="button" onClick={onCreate} disabled={loading}>Create solo house</button>
            <div className="muted">You will be the only member until someone joins.</div>
          </div>
          <form className="col" style={{ flex: 1 }} onSubmit={onJoin}>
            <div className="title">Join an existing house</div>
            <input
              className="input"
              placeholder="5-char code (no I/O/L)"
              value={token}
              onChange={(e) => setToken(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              maxLength={5}
            />
            <button className="button" disabled={!tokenValid || loading}>Join house</button>
          </form>
        </div>
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
