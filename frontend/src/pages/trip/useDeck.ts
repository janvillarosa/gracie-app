import { useMemo } from 'react'
import type { Trip } from '@api/tripTypes'
import { bookingName } from '@lib/trips/bookings'
import { addDays, shortDay, type Schedule, tripPhase } from '@lib/trips/schedule'
import type { Stop, Tomorrow } from '@components/trips/NextStop'

type Args = {
  trip: Trip
  schedule: Schedule
  phase: ReturnType<typeof tripPhase>
  today: string
  nowMs: number
  showNextStop: boolean
  // Bookings the person swiped away from the deck.
  dismissed: ReadonlySet<string>
}

/** The next-stop deck (today's stops in the day's order, only during the trip), the plain
 *  "Next up" line used when the deck is switched off, and tomorrow's first stop. */
export function useDeck({ trip, schedule, phase, today, nowMs, showNextStop, dismissed }: Args) {
  const deckStops = useMemo<Stop[]>(() => {
    if (phase !== 'during' || !showNextStop) return []
    const model = schedule.days.find((d) => d.date === today)
    return (
      model?.entries
        .filter(
          (e) =>
            e.kind === 'todo' || !trip.todos.some((t) => t.booking_id === e.booking.booking_id),
        )
        .map((e): Stop => {
          const clock = (dt?: string | null) => dt?.split('T')[1] ?? ''
          if (e.kind === 'todo') {
            const t = e.todo
            const bk = t.booking_id
              ? trip.bookings.find((x) => x.booking_id === t.booking_id)
              : undefined
            // The heading is only where to go; the rest is a quiet line under it.
            const heading = t.place?.name || t.title
            const time = t.start_time || clock(bk?.starts_at)
            const overdue = !t.done && e.startMs !== null && e.startMs < nowMs
            const sub = [
              heading !== t.title ? t.title : '',
              // Said once: the time, or "Planned for" it once it has passed.
              overdue && time ? `Planned for ${time}` : time,
              bk?.title ?? '',
              bk ? 'Booked' : '',
            ]
              .filter(Boolean)
              .join(' · ')
            return {
              id: t.todo_id,
              kind: 'todo',
              title: t.title,
              heading,
              sub: sub || 'Anytime',
              time: t.start_time ?? '',
              place: t.place,
              notes: t.notes,
              code: bk?.confirmation_code,
              linked: bk
                ? {
                    title: bk.title,
                    kind: bk.kind,
                    line: [clock(bk.starts_at), bk.place?.name].filter(Boolean).join(' · '),
                  }
                : undefined,
              done: t.done,
              planned: overdue,
            }
          }
          const b = e.booking
          const heading = b.place?.name || bookingName(b)
          return {
            id: b.booking_id,
            kind: 'booking',
            title: bookingName(b),
            heading,
            sub: [clock(b.starts_at), heading !== bookingName(b) ? bookingName(b) : '', 'Booked']
              .filter(Boolean)
              .join(' · '),
            time: clock(b.starts_at),
            place: b.place,
            notes: b.notes,
            code: b.confirmation_code,
            bookingKind: b.kind,
            line: [clock(b.starts_at), b.place?.name].filter(Boolean).join(' · '),
            done:
              (e.endMs ?? e.startMs ?? Number.POSITIVE_INFINITY) < nowMs ||
              dismissed.has(b.booking_id),
            planned: false,
          }
        }) ?? []
    )
  }, [schedule.days, phase, today, nowMs, dismissed, trip.bookings, showNextStop])
  const deckTopId = deckStops.find((s) => !s.done)?.id
  // With the deck switched off, a plain "Next up" line leads today's section.
  const nextUp = useMemo(() => {
    if (phase !== 'during' || showNextStop) return null
    const model = schedule.days.find((d) => d.date === today)
    const todos = model?.entries.flatMap((e) => (e.kind === 'todo' ? [e] : [])) ?? []
    if (!todos.length) return null
    const open = todos.filter((e) => !e.todo.done)
    if (!open.length) return { title: '', time: '' }
    const soon = open
      .filter((e) => e.startMs !== null && e.startMs >= nowMs)
      .sort((a, b) => (a.startMs as number) - (b.startMs as number))[0]
    const pick = soon ?? open[0]
    return { title: pick.todo.title, time: pick.todo.start_time ?? '' }
  }, [schedule.days, phase, today, nowMs, showNextStop])
  const tomorrow = useMemo<Tomorrow>(() => {
    const model = schedule.days.find((d) => d.date === addDays(today, 1))
    if (!model) return null
    const first = model.entries.find((e) => e.kind === 'todo')
    const todo = first?.kind === 'todo' ? first.todo : null
    return {
      date: model.date,
      label: model.label || model.suggested || shortDay(model.date),
      first: todo?.title ?? '',
      time: todo?.start_time ?? '',
    }
  }, [schedule.days, today])
  return { deckStops, deckTopId, nextUp, tomorrow }
}
