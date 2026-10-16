import React, { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@auth/AuthProvider'
import { getShareCode, rotateShare } from '@api/endpoints'
import { errorMessage } from '@lib/errors'
import { Button, Note, Sheet, SheetActions, SheetIdentity } from '@components/ui'

type Props = {
  open: boolean
  onClose: () => void
  houseName: string
}

type CopyState = 'idle' | 'copied' | 'failed'

/** The House's invite code, set like a ticket slip. Opening it shows the code the House already
 *  has (a code someone was given keeps working); "Get new code" is the only thing that replaces
 *  it. A code lets one person in: after someone joins, the next one is made here. */
export const ShareCodeSheet: React.FC<Props> = ({ open, onClose, houseName }) => {
  const { apiKey } = useAuth()
  const qc = useQueryClient()
  const code = useQuery({
    queryKey: ['share-code'],
    queryFn: () => getShareCode(apiKey as string),
    enabled: open && !!apiKey,
    // Someone may have joined since: ask again every time the sheet opens.
    refetchOnMount: 'always',
    staleTime: 0,
  })
  const token = code.data?.token ?? null
  const [copy, setCopy] = useState<CopyState>('idle')
  const [rotating, setRotating] = useState(false)
  const [rotated, setRotated] = useState(false)
  const [rotateError, setRotateError] = useState('')
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  useEffect(() => {
    if (copy === 'idle') return
    const t = setTimeout(() => setCopy('idle'), 2000)
    return () => clearTimeout(t)
  }, [copy])
  useEffect(() => {
    if (open) return
    setRotated(false)
    setRotateError('')
    setCopy('idle')
  }, [open])

  const onCopy = async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }
  const onShare = async () => {
    if (!token) return
    try {
      await navigator.share({
        title: `Join ${houseName} on Bauhouse`,
        text: `Join ${houseName} on Bauhouse. Your code is ${token}.`,
      })
    } catch {
      // Closing the share sheet rejects; nothing to say.
    }
  }
  const onRotate = async () => {
    setRotating(true)
    setRotateError('')
    try {
      const next = await rotateShare(apiKey as string)
      qc.setQueryData(['share-code'], next)
      setRotated(true)
      setCopy('idle')
    } catch (e) {
      setRotateError(errorMessage(e, 'Couldn’t make a new code. Try again.'))
    } finally {
      setRotating(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      label={`Invite to ${houseName}`}
      className="share-sheet"
      identity={
        <>
          <SheetIdentity
            title={`Invite to ${houseName}`}
            context="Give this code to someone you live with. They enter it under Join a House."
          />
          <div className="share-slip" aria-live="polite" aria-busy={code.isLoading}>
            {token ? (
              <p className="share-code" aria-label={`Invite code ${token.split('').join(' ')}`}>
                {token}
              </p>
            ) : code.isError ? (
              <Note
                role="alert"
                tone="warn"
                action={
                  <Button kind="text" onClick={() => void code.refetch()}>
                    Try again
                  </Button>
                }
              >
                {errorMessage(code.error, 'Couldn’t get your code.')}
              </Note>
            ) : (
              <p className="share-code is-loading" aria-label="Getting your code">
                <span aria-hidden>·····</span>
              </p>
            )}
            {rotated && <p className="share-note">New code. The old one no longer works.</p>}
          </div>
        </>
      }
      actions={
        <SheetActions>
          <Button kind="key" disabled={!token} onClick={() => void onCopy()}>
            {copy === 'copied' ? 'Copied' : copy === 'failed' ? 'Couldn’t copy' : 'Copy code'}
          </Button>
          {canShare && (
            <Button kind="quiet" disabled={!token} onClick={() => void onShare()}>
              Share…
            </Button>
          )}
        </SheetActions>
      }
      footer={
        <footer className="ui-sheet-footer">
          <span className="ui-sheet-who">
            {rotateError ? (
              <span role="alert" className="share-error">
                {rotateError}
              </span>
            ) : (
              'A code lets one person in.'
            )}
          </span>
          <Button kind="text" disabled={rotating || !token} onClick={() => void onRotate()}>
            {rotating ? 'Making a new code…' : 'Get new code'}
          </Button>
        </footer>
      }
    />
  )
}

export default ShareCodeSheet
