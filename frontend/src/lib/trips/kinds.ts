// What bookings are called. Its own module so the schedule and the booking helpers can both use
// it without importing each other.
import type { Booking } from '../../api/tripTypes'

/** What each kind is called where a booking has no title of its own. */
export const KIND_LABEL: Record<Booking['kind'], string> = {
  flight: 'Flight',
  stay: 'Stay',
  train: 'Train',
  car: 'Car',
  ticket: 'Ticket',
  other: 'Booking',
}

/** A booking's name: its title, else what kind it is ("Car"), so no row is left without one. */
export const bookingName = (b: Pick<Booking, 'title' | 'kind'>): string =>
  b.title?.trim() || KIND_LABEL[b.kind]
