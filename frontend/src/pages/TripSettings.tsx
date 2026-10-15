import React, { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, Card, Divider, Drawer, Modal, Typography } from 'antd'
import { CaretRight } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@auth/AuthProvider'
import { HouseLoader } from '@components/HouseLoader'
import { IconPicker } from '@components/IconPicker'
import { TopNav } from '@components/TopNav'
import { RangeCalendar } from '@components/trips/RangeCalendar'
import { TripsPreference } from '@components/trips/TripsPreference'
import { WhereSheet } from '@components/trips/WhereSheet'
import { TransitionLink } from '@components/TransitionLink'
import { getListItems, getLists } from '@api/endpoints'
import { createPackingList } from '@api/tripEndpoints'
import type { Place } from '@api/tripTypes'
import { errorMessage } from '@lib/errors'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import { useTrips } from '@lib/trips/hooks'
import { diffDays, routeText, shortRange } from '@lib/trips/schedule'
import { useTransitionNavigate } from '@lib/viewTransition'
import { TRIP_ICONS, TRIP_ICON_EMOJI, toTripEmoji, type TripIcon } from '../icons'
import '../trips.css'

type Sheet = 'icon' | 'where' | 'when' | null

/** One setting as a list row: what it is, its value in muted type, and the yellow chevron. */
const SettingRow: React.FC<{
  label: string
  value: string
  onClick?: () => void
  to?: string
  disabled?: boolean
  note?: string
}> = ({ label, value, onClick, to, disabled, note }) => {
  const inner = (
    <>
      <span className="list-row-text">
        <span className="list-row-name">{label}</span>
        <Typography.Text type="secondary" className="list-row-desc">
          {note ?? value}
        </Typography.Text>
      </span>
      <CaretRight className="list-row-caret is-inline" size={18} weight="bold" aria-hidden />
    </>
  )
  return to ? (
    <TransitionLink to={to} className="settings-row">
      {inner}
    </TransitionLink>
  ) : (
    <button type="button" className="settings-row" onClick={onClick} disabled={disabled}>
      {inner}
    </button>
  )
}

/** Trip settings: what is shared with the House, then what is just for you. Everything saves
 *  as it changes, through the same outbox as the rest of the trip. */
export const TripSettings: React.FC = () => {
  const { tripId = '' } = useParams()
  const { apiKey } = useAuth()
  const navigate = useTransitionNavigate()
  const { store, state, loading } = useTrips()
  const trip = state.trips[tripId]
  const [sheet, setSheet] = useState<Sheet>(null)
  const [confirming, setConfirming] = useState(false)
  const [packBusy, setPackBusy] = useState(false)
  const [packError, setPackError] = useState('')
  useDocumentTitle('Trip settings')

  const roomId = store?.roomId
  const lists = useQuery({
    queryKey: ['lists', roomId],
    queryFn: () => getLists(apiKey as string, roomId as string),
    enabled: !!roomId && !!apiKey,
  })
  // The link counts only if the list still exists.
  const linked = trip?.packing_list_id
    ? lists.data?.find((l) => l.list_id === trip.packing_list_id && !l.is_deleted)
    : undefined
  const items = useQuery({
    queryKey: ['list-items', linked?.list_id],
    queryFn: () => getListItems(apiKey as string, roomId as string, linked?.list_id as string),
    enabled: !!linked && !!roomId,
  })

  if (loading || !store || (!trip && !state.synced)) {
    return (
      <div className="container" aria-busy="true">
        <TopNav />
        <div className="route-skeleton">
          <HouseLoader label="Loading the trip" />
        </div>
      </div>
    )
  }
  if (!trip) {
    return (
      <div className="container">
        <TopNav />
        <div className="trip-missing">
          <h1>We can’t find this trip</h1>
          <Link to="/app/trips" className="trip-link">
            See all trips
          </Link>
        </div>
      </div>
    )
  }

  const online = !state.offline && (typeof navigator === 'undefined' || navigator.onLine !== false)
  const patch = (p: Record<string, unknown>) => store.updateTrip(trip.trip_id, p)
  // "Where" is one list: the first place is the destination.
  const stops: Place[] = trip.stops?.length
    ? trip.stops
    : trip.destination
      ? [trip.destination]
      : []
  const setStops = (next: Place[]) => patch({ stops: next, destination: next[0] ?? null })
  const days = trip.start_date && trip.end_date ? diffDays(trip.end_date, trip.start_date) + 1 : 0
  const when = trip.start_date
    ? `${shortRange(trip.start_date, trip.end_date)} · ${days} ${days === 1 ? 'day' : 'days'}`
    : 'Add dates'

  const makePacking = async () => {
    setPackBusy(true)
    setPackError('')
    try {
      await createPackingList(apiKey as string, store.roomId, trip.trip_id)
      await store.flush()
      await lists.refetch()
    } catch (e) {
      setPackError(errorMessage(e, 'Couldn’t make the list. Try again.'))
    } finally {
      setPackBusy(false)
    }
  }

  const count = items.data?.length
  return (
    <div className="container">
      <TopNav back={{ to: `/app/trips/${trip.trip_id}`, label: trip.title }} />
      <Card>
        <div className="settings-identity">
          <button
            type="button"
            className="list-icon settings-icon"
            aria-label="Change icon"
            onClick={() => setSheet('icon')}
          >
            {toTripEmoji(trip.icon)}
          </button>
          <input
            key={trip.title}
            className="trip-sheet-title"
            aria-label="Trip name"
            defaultValue={trip.title}
            maxLength={120}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (!v) e.target.value = trip.title
              else if (v !== trip.title) patch({ title: v })
            }}
          />
        </div>

        <section className="settings-group" aria-label="This trip">
          <Typography.Title level={4}>This trip</Typography.Title>
          <SettingRow
            label="Where"
            value={routeText(trip) || 'Add a place'}
            onClick={() => setSheet('where')}
          />
          <SettingRow label="When" value={when} onClick={() => setSheet('when')} />
          {linked ? (
            <SettingRow
              label="Packing list"
              value={
                count === undefined ? 'Open the list' : `${count} ${count === 1 ? 'item' : 'items'}`
              }
              to={`/app/lists/${linked.list_id}`}
            />
          ) : (
            <SettingRow
              label="Packing list"
              value="Make a packing list"
              note={
                online ? (packBusy ? 'Making it…' : 'Make a packing list') : 'Connect to make one'
              }
              onClick={makePacking}
              disabled={!online || packBusy}
            />
          )}
          {packError && (
            <p role="alert" className="trip-error">
              {packError}
            </p>
          )}
        </section>

        <Divider className="settings-divider" />

        <section className="settings-group" aria-label="Just for you">
          <Typography.Title level={4}>Just for you</Typography.Title>
          <TripsPreference />
        </section>

        <div className="settings-danger">
          <button type="button" className="trip-delete" onClick={() => setConfirming(true)}>
            Delete trip
          </button>
        </div>
      </Card>

      {sheet === 'icon' && (
        <Drawer
          open
          placement="bottom"
          height="auto"
          title="Trip icon"
          onClose={() => setSheet(null)}
          destroyOnClose
        >
          <IconPicker<TripIcon>
            value={(trip.icon as TripIcon | undefined) ?? 'SUITCASE'}
            options={TRIP_ICONS}
            emoji={TRIP_ICON_EMOJI}
            allowNone={false}
            onChange={(v) => {
              patch({ icon: v ?? 'SUITCASE' })
              setSheet(null)
            }}
          />
        </Drawer>
      )}
      {sheet === 'where' && (
        <Drawer
          open
          placement="bottom"
          height="80%"
          title="Where"
          onClose={() => setSheet(null)}
          destroyOnClose
        >
          <WhereSheet stops={stops} tz={trip.tz} onChange={setStops} />
        </Drawer>
      )}
      {sheet === 'when' && (
        <Drawer
          open
          placement="bottom"
          height="auto"
          title="When"
          onClose={() => setSheet(null)}
          destroyOnClose
        >
          <RangeCalendar
            start={trip.start_date}
            end={trip.end_date}
            onChange={(s, e) => patch({ start_date: s, end_date: e })}
          />
        </Drawer>
      )}
      <Modal
        open={confirming}
        title={`Delete ${trip.title}?`}
        onCancel={() => setConfirming(false)}
        okText="Delete"
        okButtonProps={{ danger: true }}
        onOk={() => {
          store.deleteTrip(trip.trip_id)
          setConfirming(false)
          navigate(`/app/trips/${trip.trip_id}`)
        }}
      >
        Anyone in the House can restore it for 30 days.
      </Modal>
    </div>
  )
}

export default TripSettings
