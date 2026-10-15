import React from 'react'
import { CaretRight } from '@phosphor-icons/react'
import type { Trip } from '@api/tripTypes'
import { TransitionLink } from '@components/TransitionLink'
import { countdown, dateRange, routeText } from '@lib/trips/schedule'

/** One trip as a row on a sheet: title, route, dates, and where we are in it. */
export const TripCard = React.memo<{ trip: Trip; today: string }>(function TripCard({
  trip,
  today,
}) {
  const route = routeText(trip)
  const when = dateRange(trip.start_date, trip.end_date) || 'No dates yet'
  const count = countdown(trip, today)
  return (
    <TransitionLink to={`/app/trips/${trip.trip_id}`} className="trip-card">
      <span className="trip-card-text">
        <span className="trip-card-title">{trip.title}</span>
        <span className="trip-card-sub">{[route, when].filter(Boolean).join(' · ')}</span>
      </span>
      {count && <span className="trip-card-count">{count}</span>}
      <CaretRight className="list-row-caret" size={18} weight="bold" aria-hidden />
    </TransitionLink>
  )
})
