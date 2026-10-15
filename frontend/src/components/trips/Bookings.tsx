import React, { useState } from 'react'
import { Button } from '@components/ui'
import { CaretDown, CaretRight, Warning } from '@phosphor-icons/react'
import type { Booking } from '@api/tripTypes'
import {
  bookingHeadline,
  bookingRoute,
  bookingSub,
  groupBookings,
  nextMeta,
  nowMeta,
} from '@lib/trips/bookings'
import { KIND_ICON } from './tripUi'

export type BookingActions = {
  save: (id: string | null, patch: Record<string, unknown>) => void
  remove: (id: string) => void
  copy: (code: string) => void
}

type LineProps = {
  booking: Booking
  past: boolean
  tonight?: boolean
  selected: boolean
  clash?: boolean
  // "Mia changed this after your offline edit", with a way to see theirs.
  note?: { text: string }
  onSeeTheirs?: (id: string) => void
  onOpen: (id: string) => void
}

// In the plan a booking is one quiet line at its time: icon, time, title. The code, both ends
// and the address live in its detail.
export const BookingLine = React.memo<LineProps>(function BookingLine({
  booking: b,
  past,
  tonight,
  selected,
  clash,
  note,
  onSeeTheirs,
  onOpen,
}) {
  const open = tonight ? `tonight-${b.booking_id}` : b.booking_id
  return (
    <li
      id={`row-${open}`}
      data-entry-id={b.booking_id}
      className={[
        'trip-stub',
        past ? 'is-used' : '',
        tonight ? 'is-tonight' : '',
        selected ? 'is-selected' : '',
        clash ? 'is-clash' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        className="trip-stubline"
        aria-haspopup="dialog"
        onClick={() => onOpen(b.booking_id)}
      >
        <span className="trip-stub-icon">{KIND_ICON[b.kind]}</span>
        <span className="trip-time">
          {clash && <Warning className="trip-time-flag" weight="bold" aria-hidden />}
          {tonight ? 'Tonight' : (b.starts_at?.split('T')[1] ?? '')}
        </span>
        <span className="trip-stub-title">{b.title}</span>
        {past && <span className="trip-used">Used</span>}
      </button>
      {note && (
        <div className="trip-note" role="status">
          <span>{note.text}</span>
          <Button kind="text" onClick={() => onSeeTheirs?.(b.booking_id)}>
            See theirs
          </Button>
        </div>
      )}
    </li>
  )
})

type PanelProps = {
  bookings: Booking[]
  nowMs: number
  tripTz?: string
  onOpen: (id: string) => void
}

/** Every booking, in time order: what is under way (Now), what is next (Next), what is coming,
 *  and what is over folded into one line. The kind is the leading icon; there are no groups. */
export const BookingsPanel: React.FC<PanelProps> = ({ bookings, nowMs, tripTz, onOpen }) => {
  const [showUsed, setShowUsed] = useState(false)
  const g = groupBookings(bookings, nowMs, tripTz)
  const row = (b: Booking, opts: { meta?: string; stamp?: boolean; strong?: boolean }) => {
    const headline = bookingHeadline(b)
    return (
      <li key={b.booking_id} className={opts.stamp ? 'trip-bcard is-used' : 'trip-bcard'}>
        <button type="button" className="trip-bcard-main" onClick={() => onOpen(b.booking_id)}>
          <span className="trip-stub-icon">{KIND_ICON[b.kind]}</span>
          <span className="trip-bcard-text">
            <span className="trip-title">{headline}</span>
            <span className={opts.strong ? 'trip-sub is-strong' : 'trip-sub'}>
              {[headline.includes(' → ') ? '' : bookingRoute(b), opts.meta ?? bookingSub(b)]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          {opts.stamp && <span className="trip-used">Used</span>}
        </button>
      </li>
    )
  }
  const live = [
    ...g.now.map((b) => row(b, { meta: nowMeta(b), strong: true })),
    ...(g.next ? [row(g.next, { meta: nextMeta(g.next), strong: true })] : []),
    ...g.upcoming.map((b) => row(b, {})),
  ]
  return (
    <section className="trip-pane-body trip-bookings" aria-label="Bookings">
      {!bookings.length && (
        <p className="trip-empty-text">No bookings yet. Flights, stays and tickets go here.</p>
      )}
      {live.length > 0 && <ul className="trip-list">{live}</ul>}
      {g.used.length > 0 && (
        <div className="trip-group">
          <button
            type="button"
            className="completed-toggle trip-donetoggle"
            aria-expanded={showUsed}
            onClick={() => setShowUsed((v) => !v)}
          >
            {showUsed ? <CaretDown aria-hidden /> : <CaretRight aria-hidden />} {g.used.length} used
            · {showUsed ? 'Hide' : 'Show'}
          </button>
          {showUsed && <ul className="trip-list">{g.used.map((b) => row(b, { stamp: true }))}</ul>}
        </div>
      )}
    </section>
  )
}
