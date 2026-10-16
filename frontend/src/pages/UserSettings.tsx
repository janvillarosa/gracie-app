import React, { useEffect, useState } from 'react'
import { message } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '@lib/errors'
import { useAuth } from '@auth/AuthProvider'
import { useTransitionNavigate } from '@lib/viewTransition'
import {
  changeMyPassword,
  deleteMyAccount,
  getMe,
  getMyRoom,
  isConflict,
  isUnauthorized,
  updateMyProfile,
} from '@api/endpoints'
import type { User } from '@api/types'
import { AVATAR_SIZE, Avatar } from '@components/Avatar'
import { HouseLoader } from '@components/HouseLoader'
import { TopNav } from '@components/TopNav'
import { TripsPreference } from '@components/trips/TripsPreference'
import {
  Button,
  DetailGroup,
  Field,
  NavRow,
  SectionLabel,
  Sheet,
  SheetActions,
  SheetIdentity,
  Paper,
  PaperStack,
} from '@components/ui'
import { useDocumentTitle } from '@lib/useDocumentTitle'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const EMAIL_RULE = 'Enter an email address, like you@example.com.'
const MIN_PASSWORD = 8

/** Account settings, laid out like Trip and House settings: who you are (avatar, name typed in
 *  place, email), how you sign in, what is just for you, then deleting the account. Everything
 *  saves as it changes; the password has its own small sheet. */
export const UserSettings: React.FC = () => {
  const { apiKey, signOut } = useAuth()
  const navigate = useTransitionNavigate()
  useDocumentTitle('Account settings')
  const qc = useQueryClient()
  const meQuery = useQuery<User>({ queryKey: ['me'], queryFn: () => getMe(apiKey as string) })
  // Only for the way back ("‹ Elm Street"); someone without a House goes back to /app all the same.
  const roomQuery = useQuery({
    queryKey: ['my-room'],
    queryFn: () => getMyRoom(apiKey as string),
    retry: false,
  })
  const me = meQuery.data
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (me) setEmail(me.username || '')
  }, [me?.username])

  const back = { to: '/app', label: roomQuery.data?.display_name || 'House' }
  if (!me) {
    return (
      <div className="container" aria-busy="true">
        <TopNav back={back} />
        <div className="route-skeleton">
          <HouseLoader label="Loading your account" />
        </div>
      </div>
    )
  }

  const saveProfile = async (body: { name?: string; username?: string }, done: string) => {
    try {
      await updateMyProfile(apiKey as string, body)
      message.success(done)
      await qc.invalidateQueries({ queryKey: ['me'] })
      return true
    } catch (e) {
      if (body.username && isConflict(e))
        setEmailError('That email is already used by another account.')
      else message.error(errorMessage(e, 'Couldn’t save that. Try again.'))
      return false
    }
  }
  const commitEmail = () => {
    const v = email.trim()
    if (v === (me.username || '')) return
    if (!EMAIL_RE.test(v)) {
      setEmailError(EMAIL_RULE)
      return
    }
    void saveProfile({ username: v }, 'Email saved.')
  }

  const onDelete = async () => {
    try {
      await deleteMyAccount(apiKey as string)
      setDeleting(false)
      await signOut('expired')
      navigate('/login', { replace: true })
    } catch (e) {
      message.error(errorMessage(e, 'Couldn’t delete your account. Try again.'))
    }
  }

  return (
    <div className="container">
      <TopNav back={back} />
      <PaperStack>
        <Paper className="account-settings">
          <SheetIdentity
            tile
            editHint
            leading={
              <Avatar
                seed={me.avatar_key || me.name || me.user_id}
                size={AVATAR_SIZE.tile}
                name={me.name}
                eager
                alt=""
              />
            }
            title={me.name}
            onTitle={(v) => void saveProfile({ name: v }, 'Name saved.')}
            titleLabel="Your name"
            context={
              roomQuery.data
                ? `In ${roomQuery.data.display_name || 'your House'}`
                : 'Account settings'
            }
          />

          <SectionLabel>Signing in</SectionLabel>
          <DetailGroup label="Signing in">
            <div className="ui-fieldrow">
              <span className="ui-navrow-label">Email</span>
              <Field
                aria-label="Email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="you@example.com"
                value={email}
                error={emailError || undefined}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setEmailError('')
                }}
                onBlur={commitEmail}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
              />
            </div>
            <NavRow label="Password" value="Change" onClick={() => setPasswordOpen(true)} />
          </DetailGroup>

          <SectionLabel>Just for you</SectionLabel>
          <DetailGroup label="Just for you">
            <TripsPreference />
          </DetailGroup>

          <footer className="ui-sheet-footer account-settings-footer">
            <span className="ui-sheet-who">Your avatar is made from your account.</span>
            <Button kind="text" danger onClick={() => setDeleting(true)}>
              Delete account
            </Button>
          </footer>
        </Paper>
      </PaperStack>

      <PasswordSheet
        open={passwordOpen}
        needsCurrent={!!me.username}
        onClose={() => setPasswordOpen(false)}
      />
      <DeleteAccountSheet
        open={deleting}
        houseName={roomQuery.data?.display_name}
        alone={(roomQuery.data?.members.length ?? 1) <= 1}
        onClose={() => setDeleting(false)}
        onConfirm={onDelete}
      />
    </div>
  )
}

/** Change password: the current one (when the account has one), the new one twice. Problems
 *  are said under the field they are about; the key works once all three are right. */
const PasswordSheet: React.FC<{ open: boolean; needsCurrent: boolean; onClose: () => void }> = ({
  open,
  needsCurrent,
  onClose,
}) => {
  const { apiKey, setApiKey } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [currentError, setCurrentError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) return
    setCurrent('')
    setNext('')
    setAgain('')
    setCurrentError('')
  }, [open])

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD
  const mismatch = again.length > 0 && again !== next
  const ready =
    next.length >= MIN_PASSWORD && again === next && (!needsCurrent || current.length > 0)

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!ready || saving) return
    setSaving(true)
    try {
      const res = await changeMyPassword(apiKey as string, {
        current_password: current || undefined,
        new_password: next,
      })
      // Changing the password signs other devices out; this one carries on with the new key.
      setApiKey(res.api_key)
      message.success('Password changed.')
      onClose()
    } catch (err) {
      if (isUnauthorized(err)) setCurrentError('That isn’t your current password.')
      else message.error(errorMessage(err, 'Couldn’t change your password. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      label="Change password"
      dirty={!saving && (!!current || !!next || !!again)}
      identity={
        <SheetIdentity
          title="Change password"
          context={`At least ${MIN_PASSWORD} characters. Other devices will need to sign in again.`}
        />
      }
      actions={
        <SheetActions>
          <Button kind="key" type="submit" form="password-form" disabled={!ready || saving}>
            {saving ? 'Changing…' : 'Change password'}
          </Button>
        </SheetActions>
      }
      details={
        <form id="password-form" onSubmit={submit} noValidate>
          <DetailGroup label="Password">
            {needsCurrent && (
              <div className="ui-fieldrow">
                <span className="ui-navrow-label">Current</span>
                <Field
                  aria-label="Current password"
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  error={currentError || undefined}
                  onChange={(e) => {
                    setCurrent(e.target.value)
                    setCurrentError('')
                  }}
                />
              </div>
            )}
            <div className="ui-fieldrow">
              <span className="ui-navrow-label">New</span>
              <Field
                aria-label="New password"
                type="password"
                autoComplete="new-password"
                value={next}
                error={tooShort ? `Use at least ${MIN_PASSWORD} characters.` : undefined}
                onChange={(e) => setNext(e.target.value)}
              />
            </div>
            <div className="ui-fieldrow">
              <span className="ui-navrow-label">Again</span>
              <Field
                aria-label="New password again"
                type="password"
                autoComplete="new-password"
                value={again}
                error={mismatch ? 'This doesn’t match the new password.' : undefined}
                onChange={(e) => setAgain(e.target.value)}
              />
            </div>
          </DetailGroup>
        </form>
      }
    />
  )
}

/** Deleting the account: what goes with it, then type DELETE, then the red key. */
const DeleteAccountSheet: React.FC<{
  open: boolean
  houseName?: string
  alone: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
}> = ({ open, houseName, alone, onClose, onConfirm }) => {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) setTyped('')
  }, [open])
  const house = houseName || 'your House'
  const context = !houseName
    ? 'Your account and everything about it are deleted. This can’t be undone.'
    : alone
      ? `You’re the only one in ${house}, so it goes too, with its lists and trips. This can’t be undone.`
      : `You leave ${house}; its lists and trips stay with everyone else. This can’t be undone.`
  return (
    <Sheet
      variant="confirm"
      open={open}
      onClose={onClose}
      label="Delete your account?"
      identity={<SheetIdentity title="Delete your account?" context={context} />}
      actions={
        <SheetActions>
          <Button kind="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            kind="key"
            danger
            disabled={typed !== 'DELETE' || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
              } finally {
                setBusy(false)
              }
            }}
          >
            Delete account
          </Button>
        </SheetActions>
      }
      details={
        <DetailGroup label="Confirm">
          <div className="ui-fieldrow">
            <span className="ui-navrow-label">Type DELETE</span>
            <Field
              aria-label="Type DELETE to confirm"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="DELETE"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        </DetailGroup>
      }
    />
  )
}

export default UserSettings
