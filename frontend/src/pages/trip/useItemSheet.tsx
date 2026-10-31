import React, { useRef } from 'react'
import type { Booking, Trip, TripTodo } from '@api/tripTypes'
import { LIMITS as TRIP_LIMITS } from '@lib/trips/limits'
import { dayBias } from '@lib/trips/placeBias'
import type { Member, useTrips } from '@lib/trips/hooks'
import type { TripStore } from '@lib/trips/store'
import type { BookingActions } from '@components/trips/Bookings'
import { BookingSheet } from '@components/trips/BookingSheet'
import type { MoveTarget } from '@components/trips/MoveMenu'
import { NotePick } from '@components/trips/pickers'
import { bylineFor } from '@components/trips/Spine'
import type { TabId } from '@components/trips/tabs'
import { TodoSheet } from '@components/trips/TodoSheet'
import type { RowActions } from '@components/trips/TodoRow'
import { Sheet, SheetIdentity } from '@components/ui'

type Args = {
  trip: Trip
  state: ReturnType<typeof useTrips>['state']
  store: TripStore
  userId?: string
  members: Member[]
  locked: boolean
  phase: string
  today: string
  nowMs: number
  docked: boolean
  ideasOpen: boolean
  ideasNode: React.ReactNode
  selTodo?: TripTodo
  selBooking?: Booking
  bookingDraft: { title: string; n: number; start?: string } | null
  setBookingDraft: (d: { title: string; n: number; start?: string } | null) => void
  extra: 'notes' | null
  setExtra: (e: 'notes' | null) => void
  setSelected: (id: string | null) => void
  setTab: (t: TabId) => void
  freshId: string | null
  focusTime: string | null
  rowActions: RowActions
  bookingActions: BookingActions
  moveTargets: MoveTarget[]
  bias: { lat: number; lng: number } | null
}

/** The one sheet of the trip screen: an item, a new booking, the trip notes, or (wide screens)
 *  the Ideas. One at a time. Docked over the map when there is a map, otherwise a bottom sheet
 *  or dialog. A sheet that was just closed stays mounted (closed), so focus returns to whatever
 *  opened it. */
export function useItemSheet({
  trip,
  state,
  store,
  userId,
  members,
  locked,
  phase,
  today,
  nowMs,
  docked,
  ideasOpen,
  ideasNode,
  selTodo,
  selBooking,
  bookingDraft,
  setBookingDraft,
  extra,
  setExtra,
  setSelected,
  setTab,
  freshId,
  focusTime,
  rowActions,
  bookingActions,
  moveTargets,
  bias,
}: Args): React.ReactElement | null {
  const closeSelected = () => setSelected(null)
  // On a desk the item is an inspector panel (docked at 1200px and up, an overlay below that).
  const sheetVariant = docked ? 'panel' : 'sheet'
  // A new booking starts at the next full hour today during the trip, else on day one at 09:00,
  // so it never lands in the past by default.
  const defaultStart =
    phase === 'during'
      ? `${today}T${String(Math.min(23, new Date(nowMs).getHours() + 1)).padStart(2, '0')}:00`
      : trip.start_date
        ? `${trip.start_date}T09:00`
        : undefined
  const closeBookingDraft = () => setBookingDraft(null)

  let sheet: React.ReactElement | null = null
  if (selTodo) {
    sheet = (
      <TodoSheet
        variant={sheetVariant}
        open
        onClose={closeSelected}
        todo={selTodo}
        fresh={selTodo.todo_id === freshId}
        focusTime={focusTime === selTodo.todo_id}
        onCopy={bookingActions.copy}
        bookings={trip.bookings}
        days={moveTargets}
        tripTz={trip.tz}
        bias={bias}
        near={dayBias(trip, selTodo.day ?? null)}
        byline={bylineFor(selTodo, userId, members)}
        locked={locked}
        onPatch={(p) => rowActions.patch(selTodo.todo_id, p)}
        onMove={(d) => rowActions.move(selTodo.todo_id, d)}
        onDelete={() => rowActions.remove(selTodo.todo_id)}
      />
    )
  } else if (selBooking) {
    sheet = (
      <BookingSheet
        mode="edit"
        variant={sheetVariant}
        open
        onClose={closeSelected}
        booking={selBooking}
        nowMs={nowMs}
        note={
          state.notes[selBooking.booking_id]
            ? 'A housemate changed this after your offline edit'
            : undefined
        }
        onDismissNote={() => store.dismissNote(selBooking.booking_id)}
        days={moveTargets}
        focusTime={focusTime === selBooking.booking_id}
        tripTz={trip.tz}
        tripEnd={trip.end_date}
        bias={bias}
        near={dayBias(trip, selBooking.starts_at?.slice(0, 10) ?? null)}
        byline={bylineFor(selBooking, userId, members)}
        locked={locked}
        linked={trip.todos
          .filter((t) => t.booking_id === selBooking.booking_id)
          .map((t) => ({ id: t.todo_id, title: t.title }))}
        onOpenTodo={rowActions.open}
        onSave={(id, patch) => bookingActions.save(id, patch)}
        onDelete={() => bookingActions.remove(selBooking.booking_id)}
        onCopy={bookingActions.copy}
      />
    )
  } else if (bookingDraft) {
    sheet = (
      <BookingSheet
        key={`new-booking-${bookingDraft.n}`}
        mode="new"
        variant={sheetVariant}
        open
        onClose={closeBookingDraft}
        initialTitle={bookingDraft.title}
        tripTz={trip.tz}
        bias={bias}
        near={dayBias(trip, (bookingDraft.start ?? defaultStart)?.slice(0, 10) ?? null)}
        days={moveTargets}
        defaultStart={bookingDraft.start ?? defaultStart}
        nowMs={nowMs}
        onSave={(id, patch) => {
          bookingActions.save(id, patch)
          closeBookingDraft()
        }}
        onCopy={bookingActions.copy}
      />
    )
  } else if (extra === 'notes') {
    sheet = (
      <Sheet
        key="notes"
        variant={sheetVariant}
        open
        label="Notes"
        onClose={() => setExtra(null)}
        identity={
          <SheetIdentity
            title="Notes"
            context="Anything the House should know: visa rules, meeting points, the plan B."
          />
        }
      >
        <NotePick
          key={trip.version}
          label="Trip notes"
          placeholder="Add a note"
          value={trip.notes ?? ''}
          max={TRIP_LIMITS.tripNotesBytes}
          onCommit={(v) => store.updateTrip(trip.trip_id, { notes: v })}
        />
      </Sheet>
    )
  } else if (ideasOpen) {
    sheet = (
      <Sheet
        key="ideas"
        variant="panel"
        open
        label="Ideas"
        onClose={() => setTab('plan')}
        identity={
          <SheetIdentity
            title="Ideas"
            context="Places you might go. Move one onto a day when you’re ready."
          />
        }
      >
        {ideasNode}
      </Sheet>
    )
  }
  // A sheet that was just closed stays mounted (closed), so focus returns to what opened it.
  const lastSheet = useRef<React.ReactElement | null>(sheet)
  if (sheet) lastSheet.current = sheet
  return (
    sheet ?? (lastSheet.current ? React.cloneElement(lastSheet.current, { open: false }) : null)
  )
}
