// "Ready to go?": what is still missing before a trip starts. Pure, so it can be tested without a
// screen. The stay check lives only here (it is not an inline gap on the days).
import type { Booking, Trip } from '@api/tripTypes'
import { addDays, diffDays, shortDay, stayEndDay, type DayModel } from './schedule'

export type CheckLine = {
  key: 'travel' | 'stays' | 'days' | 'packing'
  ok: boolean
  text: string
  // Muted after the text: a count ("· 4").
  meta?: string
  // What fixes it: the inline button's label and what it does.
  fix?: {
    label: string
    action:
      | 'add-travel'
      | 'add-stay'
      | 'open-booking'
      | 'show-empty-day'
      | 'open-list'
      | 'make-list'
  }
  // The first date involved (the first night with no stay, the first empty day).
  date?: string
  // The booking it is about (a stay with no check-out).
  bookingId?: string
}

const TRAVEL = new Set(['flight', 'train'])

const dateOf = (dt?: string | null) => (dt ? dt.slice(0, 10) : '')

/** Each night of the trip: every date from the first day up to, not including, the last. */
export function nights(trip: Trip): string[] {
  if (!trip.start_date || !trip.end_date) return []
  const n = diffDays(trip.end_date, trip.start_date)
  return Array.from({ length: Math.max(0, n) }, (_, i) => addDays(trip.start_date as string, i))
}

/** The nights no stay booking covers. A stay covers every night from its start day up to, not
 *  including, its end day; one with no check-out yet runs to the end of the trip. */
export function uncoveredNights(trip: Trip): string[] {
  const stays = trip.bookings.filter((b) => b.kind === 'stay' && b.starts_at)
  return nights(trip).filter(
    (night) =>
      !stays.some((b) => {
        const start = dateOf(b.starts_at)
        const end = stayEndDay(b, trip.end_date) || addDays(start, 1)
        return start <= night && night < end
      }),
  )
}

const travelLine = (travel: Booking[]): Pick<CheckLine, 'text' | 'meta'> =>
  travel.length === 1
    ? { text: `${travel[0].title} booked` }
    : { text: 'Travel booked', meta: String(travel.length) }

type Packing = { listId?: string | null; packed?: number; total?: number }

export function readiness(trip: Trip, days: DayModel[], packing: Packing): CheckLine[] {
  const lines: CheckLine[] = []

  const travel = trip.bookings.filter((b) => TRAVEL.has(b.kind))
  lines.push(
    travel.length
      ? { key: 'travel', ok: true, ...travelLine(travel) }
      : {
          key: 'travel',
          ok: false,
          text: 'No travel booked yet',
          fix: { label: 'Add a booking', action: 'add-travel' },
        },
  )

  if (nights(trip).length > 0) {
    const open = uncoveredNights(trip)
    const noCheckOut = trip.bookings.find((b) => b.kind === 'stay' && b.starts_at && !b.ends_at)
    lines.push(
      open.length === 0 && noCheckOut
        ? {
            key: 'stays',
            ok: false,
            text: `${noCheckOut.title || 'A stay'} has no check-out`,
            fix: { label: 'Add check-out', action: 'open-booking' },
            bookingId: noCheckOut.booking_id,
          }
        : open.length === 0
          ? { key: 'stays', ok: true, text: 'Stay for every night' }
          : {
              key: 'stays',
              ok: false,
              text:
                open.length === 1
                  ? `No stay for ${shortDay(open[0])}`
                  : `No stay for ${shortDay(open[0])} and ${open.length - 1} more`,
              fix: { label: 'Add a stay', action: 'add-stay' },
              date: open[0],
            },
    )
  }

  const empty = days.filter((d) => d.entries.length === 0)
  lines.push(
    empty.length === 0
      ? { key: 'days', ok: true, text: 'Every day has a plan' }
      : {
          key: 'days',
          ok: false,
          text: `${empty.length} ${empty.length === 1 ? 'day' : 'days'} still empty`,
          fix: { label: 'Show', action: 'show-empty-day' },
          date: empty[0].date,
        },
  )

  const done = packing.listId && packing.total !== undefined && packing.packed !== undefined
  lines.push(
    packing.listId
      ? {
          key: 'packing',
          ok: !!done && (packing.total as number) > 0 && packing.packed === packing.total,
          text: done ? `${packing.packed} of ${packing.total} packed` : 'Packing list',
          fix: { label: 'Open list', action: 'open-list' },
        }
      : {
          key: 'packing',
          ok: false,
          text: 'No packing list yet',
          fix: { label: 'Make a packing list', action: 'make-list' },
        },
  )
  return lines
}
