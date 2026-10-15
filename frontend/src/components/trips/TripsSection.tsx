import React, { useMemo } from 'react'
import { Card } from 'antd'
import { useAuth } from '@auth/AuthProvider'
import { TransitionLink } from '@components/TransitionLink'
import { useTripState, useTripStoreFor } from '@lib/trips/hooks'
import { groupTrips, localDateKey } from '@lib/trips/schedule'
import { TripCard } from './TripCard'

const SHOWN = 3

/** The House page's Trips section: what's happening now and next, with a way to the rest. */
export const TripsSection: React.FC<{ roomId: string; userId: string }> = ({ roomId, userId }) => {
  const { apiKey } = useAuth()
  const store = useTripStoreFor(roomId, userId, apiKey)
  const state = useTripState(store)
  const today = localDateKey()
  const groups = useMemo(() => groupTrips(Object.values(state.trips), today), [state.trips, today])
  const ordered = [...groups.now, ...groups.upcoming, ...groups.drafts, ...groups.past]
  const shown = ordered.slice(0, SHOWN)

  return (
    <Card className="paper-card trips-section" aria-label="Trips">
      <div className="trips-head">
        <h3>Our Trips</h3>
        <TransitionLink to="/app/trips" className="trip-link">
          {ordered.length > SHOWN ? `All ${ordered.length} trips` : 'Plan a trip'}
        </TransitionLink>
      </div>
      {shown.length === 0 ? (
        <p className="trip-empty-text">
          {state.ready ? 'No trips yet. Plan one together.' : 'Loading your trips…'}
        </p>
      ) : (
        <div className="trip-cards">
          {shown.map((t) => (
            <TripCard key={t.trip_id} trip={t} today={today} />
          ))}
        </div>
      )}
    </Card>
  )
}
