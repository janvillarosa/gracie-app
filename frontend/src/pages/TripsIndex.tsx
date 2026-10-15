import React, { useMemo, useState } from 'react'
import { Button, Input, Modal } from 'antd'
import { Plus } from '@phosphor-icons/react'
import { TopNav } from '@components/TopNav'
import { HouseLoader } from '@components/HouseLoader'
import { TripCard } from '@components/trips/TripCard'
import { useTransitionNavigate } from '@lib/viewTransition'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import { useTrips } from '@lib/trips/hooks'
import { groupTrips, localDateKey } from '@lib/trips/schedule'
import '../trips.css'

const deviceTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone

// New trip asks one thing: the name. Dates, a destination and the route come later, from the
// trip's details or from the nudge in an empty plan.
const NewTripModal: React.FC<{ onCreate: (title: string) => void; onCancel: () => void }> = ({
  onCreate,
  onCancel,
}) => {
  const [title, setTitle] = useState('')
  const submit = () => {
    if (title.trim()) onCreate(title.trim())
  }
  return (
    <Modal
      open
      title="Name your trip"
      onCancel={onCancel}
      destroyOnClose
      footer={
        <Button type="primary" shape="round" disabled={!title.trim()} onClick={submit}>
          Create trip
        </Button>
      }
    >
      <Input
        aria-label="Trip name"
        placeholder="Autumn in Lisbon"
        value={title}
        maxLength={120}
        // biome-ignore lint/a11y/noAutofocus: the sheet opens because the user pressed New trip
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
        onPressEnter={submit}
      />
    </Modal>
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
          <Button type="primary" shape="round" icon={<Plus />} onClick={() => setCreating(true)}>
            New trip
          </Button>
        </div>
        {state.offline && (
          <p className="trip-offline" role="status">
            Saved on this device · syncs when online
          </p>
        )}
        {creating && (
          <NewTripModal
            onCancel={() => setCreating(false)}
            onCreate={(title) => {
              const id = store.createTrip({ title, tz: deviceTz() })
              navigate(`/app/trips/${id}`)
            }}
          />
        )}
        {total === 0 && !creating && (
          <p className="trip-empty-text">
            No trips yet. Start one with New trip and plan it together.
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
