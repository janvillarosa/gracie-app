import React, { useEffect, useState } from 'react'
import { Button, Note, Sheet, Paper } from '@components/ui'
import { Dropdown, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { CaretDown, DotsThreeVertical } from '@phosphor-icons/react'
import type { Trip } from '@api/tripTypes'
import { countdown, routeText, shortDay, shortRange, tripPhase } from '@lib/trips/schedule'
import { AVATAR_SIZE } from '@components/Avatar'
import { AvatarStack } from '@components/AvatarStack'
import type { Member } from '@lib/trips/hooks'
import { toTripEmoji } from '../../icons'

// An everyday save takes about a second; saying "Syncing…" for it would push the plan down and
// back on every edit. Only a sync still waiting after this long is worth a line.
const SYNC_NOTICE_MS = 2000

function useSlowSync(pending: boolean): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!pending) {
      setSlow(false)
      return
    }
    const t = setTimeout(() => setSlow(true), SYNC_NOTICE_MS)
    return () => clearTimeout(t)
  }, [pending])
  return slow
}

type HeaderProps = {
  trip: Trip
  today: string
  offline: boolean
  pending: number
  // The device would not keep our changes: they sync, but a reload would lose them.
  persistFailed: boolean
  deletedBy: string
  readOnlyOver: boolean
  members: Member[]
  // Notes about the trip itself: "A housemate changed the name after your offline edit".
  notes: Array<{ key: string; text: string }>
  onDismissNote: (key: string) => void
  onUnlock: () => void
  onRestore: () => void
  onMenu: (key: 'notes' | 'packing' | 'details') => void
  // The packing list carries its state in the menu: "Packing list · 4 of 12 packed".
  packing: { label: string; disabled: boolean }
  // The friendly line opens the list of days (a popover on wide screens, a small sheet elsewhere).
  daysOpen: boolean
  onDaysOpen: (open: boolean) => void
  dayList: React.ReactNode
  // On a desk the line also says how long until the trip, and the title never wraps.
  desk?: boolean
  // Desk only: the band at the foot of the same sheet (Ready to go?, or the Next stop card).
  band?: React.ReactNode
}

const sharedWith = (members: Member[]) => {
  const names = members.map((m) => m.name)
  return names.length < 2
    ? `Shared with ${names[0] ?? 'the House'}`
    : `Shared with ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The top sheet of the stack: the trip's mark and name, one friendly line, who is in it. */
export const TripHeader: React.FC<HeaderProps> = ({
  trip,
  today,
  offline,
  pending,
  persistFailed,
  deletedBy,
  readOnlyOver,
  members,
  notes,
  onDismissNote,
  onUnlock,
  onRestore,
  onMenu,
  packing,
  daysOpen,
  onDaysOpen,
  dayList,
  desk,
  band,
}) => {
  const slowSync = useSlowSync(pending > 0)
  const route = routeText(trip)
  const phase = tripPhase(trip, today)
  const line =
    phase === 'during'
      ? `${countdown(trip, today)} · ${shortDay(today)}`
      : phase === 'draft'
        ? 'No dates yet'
        : [
            route,
            shortRange(trip.start_date, trip.end_date),
            desk && phase === 'before' ? countdown(trip, today).toLowerCase() : '',
          ]
            .filter(Boolean)
            .join(' · ')
  const items: MenuProps['items'] = [
    { key: 'notes', label: 'Notes' },
    { key: 'packing', label: packing.label, disabled: packing.disabled },
    { key: 'details', label: 'Trip settings' },
  ]
  const menuNode = (
    <Dropdown
      trigger={['click']}
      menu={{ items, onClick: ({ key }) => onMenu(key as 'notes' | 'packing' | 'details') }}
    >
      <Button kind="text" iconOnly icon={<DotsThreeVertical />} aria-label="More trip options" />
    </Dropdown>
  )
  const dayLineNode =
    phase === 'draft' ? (
      <Typography.Text className="list-meta">{line}</Typography.Text>
    ) : (
      <Sheet
        variant="chips"
        open={daysOpen}
        onOpen={() => onDaysOpen(true)}
        onClose={() => onDaysOpen(false)}
        label="Days"
        title="Days"
        anchor={
          <button type="button" className="list-meta trip-dayline">
            {line}
            <CaretDown aria-hidden />
          </button>
        }
      >
        {daysOpen ? dayList : null}
      </Sheet>
    )
  const avatarsNode = (
    <AvatarStack
      className="trip-avatars"
      members={members}
      label={sharedWith(members)}
      size={AVATAR_SIZE.small}
    />
  )
  const banner = deletedBy && (
    <div className="trip-banner" role="status">
      <span>{deletedBy} deleted this trip.</span>
      <Button kind="key" onClick={onRestore}>
        Restore
      </Button>
    </div>
  )
  const noteNodes = notes.map((n) => (
    <Note
      key={n.key}
      role="status"
      className="trip-note-trip"
      action={
        <Button kind="text" onClick={() => onDismissNote(n.key)}>
          Got it
        </Button>
      }
    >
      {n.text}
    </Note>
  ))
  const syncing = slowSync && pending > 0
  const status = (offline || syncing || readOnlyOver || persistFailed) && (
    <div className="trip-header-row">
      {(offline || syncing) && (
        <span className="trip-offline" role="status">
          {offline ? 'Saved on this device · syncs when online' : 'Syncing…'}
        </span>
      )}
      {persistFailed && (
        <span className="trip-offline" role="status">
          Not saved on this device
        </span>
      )}
      {readOnlyOver && (
        <span className="trip-offline">
          This trip is over.{' '}
          <button type="button" className="trip-inline-link" onClick={onUnlock}>
            Edit anyway
          </button>
        </span>
      )}
    </div>
  )

  // A desk: one row, [icon] [title over the day line] ... [avatars] [menu], and the sheet's
  // band (Ready to go?, or the Next stop card) at its foot.
  if (desk)
    return (
      <Paper className="paper-meta is-desk">
        {banner}
        <div className="trip-desk-head">
          <span className="list-icon trip-desk-icon" aria-hidden>
            {toTripEmoji(trip.icon)}
          </span>
          <div className="trip-desk-text">
            <Typography.Title level={2} className="trip-desk-title">
              <span className="trip-title-text">{trip.title}</span>
            </Typography.Title>
            <div className="trip-desk-meta">{dayLineNode}</div>
          </div>
          {avatarsNode}
          {menuNode}
        </div>
        {noteNodes}
        {status}
        {band && <div className="trip-head-band">{band}</div>}
      </Paper>
    )

  return (
    <Paper className="paper-meta">
      {banner}
      <div className="list-header-grid">
        <div className="list-header-title">
          <Typography.Title
            level={2}
            style={{ margin: 0, lineHeight: 1.2, display: 'flex', alignItems: 'center' }}
          >
            <span className="list-icon list-icon-title" aria-hidden>
              {toTripEmoji(trip.icon)}
            </span>
            <span className="trip-title-text">{trip.title}</span>
          </Typography.Title>
        </div>
        <div className="list-actions">{menuNode}</div>
        <div className="trip-metaline">
          {dayLineNode}
          {avatarsNode}
        </div>
      </div>
      {noteNodes}
      {status}
    </Paper>
  )
}
