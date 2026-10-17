import React, { useMemo, useState } from 'react'
import { Button, EmptyState } from '@components/ui'
import { Dropdown, List as AntList, Typography, message } from 'antd'
import type { MenuProps } from 'antd'
import { CaretRight, DotsThreeVertical } from '@phosphor-icons/react'
import type { Trip } from '@api/tripTypes'
import { TransitionLink } from '@components/TransitionLink'
import { useTransitionNavigate } from '@lib/viewTransition'
import type { TripStore } from '@lib/trips/store'
import { countdown, groupTrips, localDateKey, shortRange, tripPhase } from '@lib/trips/schedule'
import { TripIconDisc } from '@components/IconDiscs'
import { TripNameModal } from './NewTripModal'

const metaFor = (t: Trip, today: string, kind: 'now' | 'upcoming' | 'draft' | 'past') => {
  if (kind === 'now') return countdown(t, today)
  if (kind === 'draft') return 'No dates yet'
  const range = shortRange(t.start_date, t.end_date)
  return kind === 'upcoming' ? [countdown(t, today), range].filter(Boolean).join(' · ') : range
}

type RowProps = {
  trip: Trip
  meta: string
  now: boolean
  onRename: (t: Trip) => void
  onDelete: (t: Trip) => void
  onSettings: (t: Trip) => void
}

const TripRow = React.memo(function TripRow({
  trip,
  meta,
  now,
  onRename,
  onDelete,
  onSettings,
}: RowProps) {
  const items: MenuProps['items'] = [
    { key: 'rename', label: 'Rename' },
    { key: 'settings', label: 'Trip settings' },
    { key: 'delete', label: 'Delete', danger: true },
  ]
  return (
    <AntList.Item className="trip-list-row">
      <TransitionLink to={`/app/trips/${trip.trip_id}`} className="list-row-link">
        <TripIconDisc icon={trip.icon} />
        <span className="list-row-text">
          <span className="list-row-name">{trip.title}</span>
          <Typography.Text
            type="secondary"
            className={now ? 'list-row-desc is-now' : 'list-row-desc'}
          >
            {meta}
          </Typography.Text>
        </span>
      </TransitionLink>
      <Dropdown
        trigger={['click']}
        placement="bottomRight"
        menu={{
          items,
          onClick: ({ key }) => {
            if (key === 'rename') onRename(trip)
            if (key === 'settings') onSettings(trip)
            if (key === 'delete') onDelete(trip)
          },
        }}
      >
        <Button
          kind="text"
          iconOnly
          className="list-row-menu"
          icon={<DotsThreeVertical size={20} weight="bold" />}
          aria-label={`Actions for ${trip.title}`}
        />
      </Dropdown>
      <CaretRight className="list-row-caret" size={18} weight="bold" aria-hidden />
    </AntList.Item>
  )
})

type Props = { trips: Record<string, Trip>; store: TripStore | null; ready: boolean }

/** The Trips pill of the House sheet: rows that mirror the Lists rows. The trip happening now
 *  leads, then what's coming up, then drafts; finished trips fold into one quiet line. */
export const TripsPanel: React.FC<Props> = ({ trips, store, ready }) => {
  const navigate = useTransitionNavigate()
  const today = localDateKey()
  const groups = useMemo(() => groupTrips(Object.values(trips), today), [trips, today])
  const [showPast, setShowPast] = useState(false)
  const [renaming, setRenaming] = useState<Trip | null>(null)
  const total = groups.now.length + groups.upcoming.length + groups.drafts.length

  const onDelete = (t: Trip) => {
    store?.deleteTrip(t.trip_id)
    message.open({
      key: `del-${t.trip_id}`,
      duration: 6,
      content: (
        <span>
          Deleted {t.title}.{' '}
          <Button
            kind="text"
            onClick={() => {
              store?.restoreTrip(t.trip_id)
              message.destroy(`del-${t.trip_id}`)
            }}
          >
            Restore
          </Button>
        </span>
      ),
    })
  }
  const settings = (t: Trip) => navigate(`/app/trips/${t.trip_id}/settings`)

  const kindOf = (t: Trip): 'now' | 'upcoming' | 'draft' | 'past' => {
    const p = tripPhase(t, today)
    return p === 'during' ? 'now' : p === 'before' ? 'upcoming' : p === 'after' ? 'past' : 'draft'
  }
  const rows = (list: Trip[]) => (
    <AntList
      className="lists-list"
      dataSource={list}
      renderItem={(t) => (
        <TripRow
          key={t.trip_id}
          trip={t}
          meta={metaFor(t, today, kindOf(t))}
          now={kindOf(t) === 'now'}
          onRename={setRenaming}
          onDelete={onDelete}
          onSettings={settings}
        />
      )}
    />
  )

  return (
    <>
      {total === 0 && groups.past.length === 0 ? (
        ready ? (
          <EmptyState title="No trips yet">Where to first? Start one with New trip.</EmptyState>
        ) : (
          <Typography.Text type="secondary">Loading your trips…</Typography.Text>
        )
      ) : (
        rows([...groups.now, ...groups.upcoming, ...groups.drafts])
      )}
      {groups.past.length > 0 && (
        <>
          <button
            type="button"
            className="completed-toggle"
            aria-expanded={showPast}
            onClick={() => setShowPast((v) => !v)}
          >
            {showPast
              ? 'Hide past trips'
              : `${groups.past.length} past ${groups.past.length === 1 ? 'trip' : 'trips'} · Show`}
          </button>
          {showPast && rows(groups.past)}
        </>
      )}
      {renaming && (
        <TripNameModal
          title="Rename trip"
          cta="Save"
          context="The new name shows for everyone in the House."
          initial={renaming.title}
          onCancel={() => setRenaming(null)}
          onSubmit={(name) => {
            store?.updateTrip(renaming.trip_id, { title: name })
            setRenaming(null)
          }}
        />
      )}
    </>
  )
}
