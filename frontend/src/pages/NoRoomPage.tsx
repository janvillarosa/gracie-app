import React, { useState } from 'react'
import { message } from 'antd'
import { Plus } from '@phosphor-icons/react'
import { errorMessage } from '@lib/errors'
import { useAuth } from '@auth/AuthProvider'
import {
  createRoom,
  updateRoomSettings,
  isConflict,
  isForbidden,
  joinRoomByToken,
} from '@api/endpoints'
import { CreateHouseSheet } from '@components/CreateHouseSheet'
import { Button, Paper, PaperStack } from '@components/ui'
import { useTransitionNavigate } from '@lib/viewTransition'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import { TopNav } from '@components/TopNav'

const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ0123456789' // no I, O, L
const CODE_LENGTH = 5

/** Not in a House yet: start one (the one key), or join one with a housemate's code. */
export const NoRoomPage: React.FC = () => {
  const { apiKey } = useAuth()
  const navigate = useTransitionNavigate()
  useDocumentTitle('Join or create a House')
  const [token, setToken] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  const tokenValid =
    token.length === CODE_LENGTH && [...token].every((c) => TOKEN_ALPHABET.includes(c))

  const onCreate = async (vals: { display_name?: string; description?: string }) => {
    setCreating(true)
    try {
      await createRoom(apiKey as string)
      if (vals.display_name || typeof vals.description === 'string') {
        await updateRoomSettings(apiKey as string, {
          display_name: vals.display_name,
          description: vals.description ?? '',
        })
      }
      setCreateOpen(false)
      navigate('/app', { replace: true })
    } catch (e) {
      message.error(errorMessage(e, 'Couldn’t create your House. Try again.'))
    } finally {
      setCreating(false)
    }
  }

  const onJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!tokenValid || joining) return
    setJoining(true)
    setJoinError('')
    try {
      await joinRoomByToken(apiKey as string, token)
      window.location.reload()
    } catch (err) {
      if (isForbidden(err)) setJoinError('That code doesn’t match a House. Check it and try again.')
      else if (isConflict(err)) setJoinError('You’re already in this House.')
      else setJoinError(errorMessage(err, 'Couldn’t join that House. Try again.'))
      setJoining(false)
    }
  }

  return (
    <div className="container">
      <TopNav />
      <PaperStack>
        <Paper className="no-room">
          <h1 className="no-room-title">You’re not in a House yet</h1>
          <p className="no-room-lede">
            A House is the people you live with, sharing the same lists and trips.
          </p>

          <section className="no-room-part" aria-labelledby="start-house">
            <h2 id="start-house" className="no-room-heading">
              Start a House
            </h2>
            <p className="no-room-text">
              You’ll be the only member until someone joins with your code.
            </p>
            <Button kind="key" icon={<Plus aria-hidden />} onClick={() => setCreateOpen(true)}>
              Create a House
            </Button>
          </section>

          <section className="no-room-part" aria-labelledby="join-house">
            <h2 id="join-house" className="no-room-heading">
              Join a House
            </h2>
            <p className="no-room-text" id="join-hint">
              Ask a housemate for the code. They’ll find it under Invite.
            </p>
            <form className="join-row" onSubmit={onJoin} noValidate>
              <input
                className={joinError ? 'join-code has-error' : 'join-code'}
                aria-label="House code"
                aria-describedby={joinError ? 'join-error' : 'join-hint'}
                aria-invalid={!!joinError}
                placeholder="K7M2Q"
                value={token}
                maxLength={CODE_LENGTH}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => {
                  setJoinError('')
                  setToken(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                }}
              />
              <Button kind="quiet" type="submit" disabled={!tokenValid || joining}>
                {joining ? 'Joining…' : 'Join'}
              </Button>
            </form>
            {joinError && (
              <p id="join-error" role="alert" className="ui-field-error">
                {joinError}
              </p>
            )}
          </section>

          <CreateHouseSheet
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            onSubmit={onCreate}
            submitting={creating}
          />
        </Paper>
      </PaperStack>
    </div>
  )
}
