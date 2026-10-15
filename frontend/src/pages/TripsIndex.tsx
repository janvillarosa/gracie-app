import React, { useMemo, useState } from 'react'
import { Button } from 'antd'
import { Plus } from '@phosphor-icons/react'
import { TopNav } from '@components/TopNav'
import { HouseLoader } from '@components/HouseLoader'
import { PlacePicker } from '@components/trips/PlacePicker'
import { TripCard } from '@components/trips/TripCard'
import { useTransitionNavigate } from '@lib/viewTransition'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import { useTrips } from '@lib/trips/hooks'
import { groupTrips, localDateKey } from '@lib/trips/schedule'
import type { Place } from '@api/tripTypes'
import '../trips.css'

const deviceTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone

const NewTripForm: React.FC<{
  onCreate: (v: { title: string; destination: Place | null; start: string; end: string }) => void
  onCancel: () => void
}> = ({ onCreate, onCancel }) => {
  const [title, setTitle] = useState('')
  const [destination, setDestination] = useState<Place | null>(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [error, setError] = useState('')
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return setError('Give the trip a title.')
    if ((start && !end) || (!start && end)) return setError('Set both dates, or leave both empty.')
    if (start && end && end < start) return setError('The trip can’t end before it starts.')
    onCreate({ title: title.trim(), destination, start, end })
  }
  return (
    <form className="trip-new" onSubmit={submit} aria-label="New trip">
      <label className="trip-label">
        Title
        <input
          className="trip-field"
          value={title}
          maxLength={120}
          // biome-ignore lint/a11y/noAutofocus: the form opens because the user pressed New trip
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <div className="trip-label">
        Destination (optional)
        <PlacePicker label="Destination" value={destination} onChange={setDestination} />
      </div>
      <div className="trip-editor-pair">
        <label className="trip-label">
          Starts (optional)
          <input
            className="trip-field"
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value)
              if (!end || end < e.target.value) setEnd(e.target.value)
            }}
          />
        </label>
        <label className="trip-label">
          Ends (optional)
          <input
            className="trip-field"
            type="date"
            value={end}
            min={start || undefined}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <div role="alert" className="trip-error">
          {error}
        </div>
      )}
      <div className="trip-editor-foot">
        <span />
        <span className="trip-editor-btns">
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="primary" shape="round" htmlType="submit">
            Create trip
          </Button>
        </span>
      </div>
    </form>
  )
}

const Group: React.FC<{
  title: string
  trips: ReturnType<typeof groupTrips>['now']
  today: string
}> = ({ title, trips, today }) =>
  trips.length === 0 ? null : (
    <section className="trip-group" aria-label={title}>
      <h2>{title}</h2>
      <div className="trip-cards">
        {trips.map((t) => (
          <TripCard key={t.trip_id} trip={t} today={today} />
        ))}
      </div>
    </section>
  )

export const TripsIndex: React.FC = () => {
  useDocumentTitle('Trips')
  const navigate = useTransitionNavigate()
  const { store, state, loading, roomName } = useTrips()
  const [creating, setCreating] = useState(false)
  const today = localDateKey()
  const groups = useMemo(() => groupTrips(Object.values(state.trips), today), [state.trips, today])
  const total =
    groups.now.length + groups.upcoming.length + groups.drafts.length + groups.past.length

  if (loading || !store) {
    return (
      <div className="container" aria-busy="true">
        <TopNav back={{ to: '/app', label: 'House' }} />
        <div className="route-skeleton">
          <HouseLoader label="Loading your trips" />
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <TopNav back={{ to: '/app', label: roomName }} />
      <div className="trips-sheet">
        <div className="trips-head">
          <h1>Trips</h1>
          {!creating && (
            <Button type="primary" shape="round" icon={<Plus />} onClick={() => setCreating(true)}>
              New trip
            </Button>
          )}
        </div>
        {state.offline && (
          <p className="trip-offline" role="status">
            Saved on this device · syncs when online
          </p>
        )}
        {creating && (
          <NewTripForm
            onCancel={() => setCreating(false)}
            onCreate={(v) => {
              const patch: Record<string, unknown> = {
                title: v.title,
                tz: v.destination?.tz || deviceTz(),
              }
              if (v.destination) patch.destination = v.destination
              if (v.start && v.end) {
                patch.start_date = v.start
                patch.end_date = v.end
              }
              const id = store.createTrip(patch)
              navigate(`/app/trips/${id}`)
            }}
          />
        )}
        {total === 0 && !creating && (
          <p className="trip-empty-text">
            No trips yet. Start one with New trip, then add days, ideas and bookings together.
          </p>
        )}
        <Group title="Now" trips={groups.now} today={today} />
        <Group title="Upcoming" trips={groups.upcoming} today={today} />
        <Group title="Drafts" trips={groups.drafts} today={today} />
        <Group title="Past" trips={groups.past} today={today} />
      </div>
    </div>
  )
}

export default TripsIndex
