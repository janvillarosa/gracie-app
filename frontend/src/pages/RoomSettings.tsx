import React, { useEffect, useState } from 'react'
import { Lightbulb, Moon, Repeat } from '@phosphor-icons/react'
import { message } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '@lib/errors'
import { useTransitionNavigate } from '@lib/viewTransition'
import { useAuth } from '@auth/AuthProvider'
import { cancelDeletion, getMe, getMyRoom, updateRoomSettings, voteDeletion } from '@api/endpoints'
import { DESCRIPTION_RULE, isValidDisplayName, MAX_DESCRIPTION, NAME_RULE } from '@lib/validation'
import { ShareCodeSheet } from '@components/ShareCodeSheet'
import { DeleteVoteSheet } from '@components/DeleteVoteSheet'
import { AVATAR_SIZE, Avatar } from '@components/Avatar'
import { HouseLoader } from '@components/HouseLoader'
import { TopNav } from '@components/TopNav'
import {
  Button,
  DetailGroup,
  Field,
  NavRow,
  SectionLabel,
  SheetIdentity,
  StepSlider,
  Paper,
  PaperStack,
} from '@components/ui'
import { autopilotModeOf, type AutopilotMode, type RoomView } from '@api/types'
import { useDocumentTitle } from '@lib/useDocumentTitle'

const nameProblem = (v: string) => (v && !isValidDisplayName(v) ? NAME_RULE : '')

// Low to high: how much of the shopping the House hands to autopilot. Assist's glyph is the same
// mark its items carry on a list.
const AUTOPILOT_STEPS: { value: AutopilotMode; label: string; icon: React.ReactNode }[] = [
  { value: 'off', label: 'Off', icon: <Moon weight="bold" /> },
  { value: 'suggest', label: 'Suggest', icon: <Lightbulb weight="bold" /> },
  { value: 'assist', label: 'Assist', icon: <Repeat weight="bold" /> },
]

// One line under the chosen mode, in the House's words.
const AUTOPILOT_HELP: Record<AutopilotMode, string> = {
  off: 'Nothing is suggested or added.',
  suggest:
    'Suggests things your House usually adds, a little before they’re due. Nothing changes until someone taps.',
  assist:
    'Adds things to your lists before you shop. You can always undo. It never buys or books anything.',
}

/** House settings, laid out like Trip settings: the House's name (typed in place), what it is
 *  about, who is in it and how to invite someone, then the vote to delete it. Everything saves
 *  as it changes. */
export const RoomSettings: React.FC = () => {
  const { apiKey } = useAuth()
  const navigate = useTransitionNavigate()
  useDocumentTitle('House settings')
  const qc = useQueryClient()
  const roomQuery = useQuery({ queryKey: ['my-room'], queryFn: () => getMyRoom(apiKey as string) })
  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => getMe(apiKey as string) })
  const room = roomQuery.data
  const me = meQuery.data?.user_id
  const [description, setDescription] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (room) setDescription(room.description || '')
  }, [room?.description])

  if (!room) {
    return (
      <div className="container" aria-busy="true">
        <TopNav back={{ to: '/app', label: 'House' }} />
        <div className="route-skeleton">
          <HouseLoader label="Loading your House" />
        </div>
      </div>
    )
  }

  const houseName = room.display_name || 'House'
  const members: { name: string; avatar_key: string; user_id?: string }[] =
    room.members_meta ?? room.members.map((name) => ({ name, avatar_key: name }))
  const memberCount = Math.max(members.length, 1)
  const votes = room.deletion_votes ?? (room.my_deletion_vote ? 1 : 0)
  const othersVoted = votes - (room.my_deletion_vote ? 1 : 0)
  const descError = description.length > MAX_DESCRIPTION ? DESCRIPTION_RULE : ''

  const save = async (payload: { display_name?: string; description?: string }, done: string) => {
    try {
      await updateRoomSettings(apiKey as string, payload)
      message.success(done)
      await qc.invalidateQueries({ queryKey: ['my-room'] })
    } catch (e) {
      message.error(errorMessage(e, 'Couldn’t save your changes. Try again.'))
    }
  }
  const commitDescription = () => {
    if (descError || description === (room.description || '')) return
    void save({ description }, 'Description saved.')
  }

  // Autopilot: a House setting that saves on choice, and rolls back if refused.
  const autopilotMode = autopilotModeOf(room)
  const onAutopilotMode = async (mode: AutopilotMode) => {
    if (mode === autopilotMode) return
    const before = qc.getQueryData<RoomView>(['my-room'])
    qc.setQueryData<RoomView | undefined>(['my-room'], (r) =>
      r ? { ...r, autopilot_mode: mode, suggestions_off: mode === 'off' } : r,
    )
    try {
      await updateRoomSettings(apiKey as string, { autopilot_mode: mode })
      await qc.invalidateQueries({ queryKey: ['my-room'] })
      qc.invalidateQueries({ queryKey: ['suggestions'] })
      qc.invalidateQueries({ queryKey: ['autopilot'] })
    } catch (e) {
      qc.setQueryData(['my-room'], before)
      message.error(errorMessage(e, 'Couldn’t save that. Try again.'))
    }
  }

  const onVote = async () => {
    try {
      const res = await voteDeletion(apiKey as string)
      setConfirming(false)
      if (res.deleted) {
        navigate('/app', { replace: true })
        return
      }
      message.success('Vote recorded.')
      await qc.invalidateQueries({ queryKey: ['my-room'] })
    } catch (e) {
      message.error(errorMessage(e, 'Couldn’t record your vote. Try again.'))
    }
  }
  const onCancelVote = async () => {
    try {
      await cancelDeletion(apiKey as string)
      message.success('Vote cancelled.')
      await qc.invalidateQueries({ queryKey: ['my-room'] })
    } catch (e) {
      message.error(errorMessage(e, 'Couldn’t cancel your vote. Try again.'))
    }
  }

  const voteLine =
    votes === 0
      ? memberCount > 1
        ? 'Deleting takes everyone’s vote.'
        : ''
      : room.my_deletion_vote
        ? `You voted to delete it. ${votes} of ${memberCount} so far.`
        : `${votes} of ${memberCount} voted to delete it.`

  return (
    <div className="container">
      <TopNav back={{ to: '/app', label: houseName }} />
      <PaperStack>
        <Paper className="house-settings">
          <SheetIdentity
            title={houseName}
            onTitle={(v) => void save({ display_name: v }, 'Name saved.')}
            titleLabel="House name"
            validate={nameProblem}
            editHint
            context="House settings"
          />

          <SectionLabel>About</SectionLabel>
          <DetailGroup label="About">
            <div className="ui-fieldrow">
              <span className="ui-navrow-label">Description</span>
              <Field
                aria-label="Description"
                placeholder="Optional"
                value={description}
                error={descError || undefined}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={commitDescription}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
              />
            </div>
          </DetailGroup>

          <SectionLabel>{memberCount === 1 ? 'Just you' : `${memberCount} members`}</SectionLabel>
          <DetailGroup label="Members">
            {members.map((m, idx) => (
              <div className="house-member-row" key={m.user_id ?? idx}>
                {/* The name is right beside it: the face is decoration. */}
                <Avatar seed={m.avatar_key} name={m.name} size={AVATAR_SIZE.row} alt="" eager />
                <span className="house-member-name">{m.name}</span>
                {m.user_id && m.user_id === me && <span className="house-member-you">You</span>}
              </div>
            ))}
            <NavRow label="Invite" value="Get a code" onClick={() => setShareOpen(true)} />
          </DetailGroup>

          <SectionLabel>Lists</SectionLabel>
          <DetailGroup label="Lists">
            <div className="pref autopilot-pref">
              <span className="pref-label" aria-hidden>
                Autopilot
              </span>
              <StepSlider
                label="Autopilot"
                value={autopilotMode}
                steps={AUTOPILOT_STEPS}
                describedBy="autopilot-help"
                onChange={(m) => void onAutopilotMode(m)}
              />
              <p className="pref-help autopilot-help" id="autopilot-help" aria-live="polite">
                {/* Keyed so the new line fades in as the key lands. */}
                <span key={autopilotMode}>{AUTOPILOT_HELP[autopilotMode]}</span>
              </p>
            </div>
          </DetailGroup>

          <footer className="ui-sheet-footer house-settings-footer">
            <span className="ui-sheet-who">{voteLine}</span>
            {room.my_deletion_vote ? (
              <Button kind="text" onClick={() => void onCancelVote()}>
                Cancel my vote
              </Button>
            ) : (
              <Button kind="text" danger onClick={() => setConfirming(true)}>
                {othersVoted + 1 >= memberCount ? 'Delete House' : 'Vote to delete'}
              </Button>
            )}
          </footer>
        </Paper>
      </PaperStack>

      <ShareCodeSheet open={shareOpen} onClose={() => setShareOpen(false)} houseName={houseName} />
      <DeleteVoteSheet
        open={confirming}
        kind="house"
        name={houseName}
        members={memberCount}
        othersVoted={othersVoted}
        onClose={() => setConfirming(false)}
        onConfirm={onVote}
      />
    </div>
  )
}
