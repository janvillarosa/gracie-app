import React from 'react'
import { Button, Note, Sheet } from '@components/ui'
import { Card, Dropdown, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { CaretDown, DotsThreeVertical } from '@phosphor-icons/react'
import type { Trip } from '@api/tripTypes'
import { countdown, routeText, shortDay, shortRange, tripPhase } from '@lib/trips/schedule'
import { Avatar } from '@components/Avatar'
import type { Member } from '@lib/trips/hooks'
import { toTripEmoji } from '../../icons'

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
}) => {
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
  return (
    <Card className={desk ? 'paper-card paper-meta is-desk' : 'paper-card paper-meta'}>
      {deletedBy && (
        <div className="trip-banner" role="status">
          <span>{deletedBy} deleted this trip.</span>
          <Button kind="key" onClick={onRestore}>
            Restore
          </Button>
        </div>
      )}
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
        <div className="list-actions">
          <Dropdown
            trigger={['click']}
            menu={{ items, onClick: ({ key }) => onMenu(key as 'notes' | 'packing' | 'details') }}
          >
            <Button
              kind="text"
              iconOnly
              icon={<DotsThreeVertical />}
              aria-label="More trip options"
            />
          </Dropdown>
        </div>
        <div className="trip-metaline">
          {phase === 'draft' ? (
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
          )}
          <span className="trip-avatars" role="img" aria-label={sharedWith(members)}>
            {members.slice(0, members.length > 4 ? 3 : 4).map((m) => (
              <Avatar
                key={m.user_id ?? m.name}
                seed={m.avatar_key ?? m.name}
                size={24}
                alt=""
                className="trip-avatar"
              />
            ))}
            {members.length > 4 && (
              <span className="trip-avatar-more" aria-hidden>
                +{members.length - 3}
              </span>
            )}
          </span>
        </div>
      </div>
      {notes.map((n) => (
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
      ))}
      {(offline || pending > 0 || readOnlyOver || persistFailed) && (
        <div className="trip-header-row">
          {(offline || pending > 0) && (
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
      )}
    </Card>
  )
}
