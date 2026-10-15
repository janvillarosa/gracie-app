// Trips wire types. Contract: docs/superpowers/specs/2026-10-14-trips-api-persistence-design.md
// (including the 2026-10-15 amendment). Field names are snake_case exactly as the API sends them.

export type PlaceSource = 'google' | 'pin' | 'manual'

// google: `place_id` is required and Google's name and address are never stored; lat/lng exist
// only with `coords_fetched_at` (at most 30 days old) and may be missing once purged.
// pin / manual: user content (name, address, lat, lng), no place_id.
// `locality` is whatever the user typed. A rendered trip may carry a Google place's name and
// address filled in from the session cache for display; they are stripped from every op
// (lib/trips/places.ts `sanitizePatch`) and never persisted.
export type Place = {
  place_id?: string
  name?: string
  address?: string
  locality?: string
  lat?: number
  lng?: number
  tz?: string
  coords_fetched_at?: string
  source: PlaceSource
}

export type TripCategory =
  | 'food'
  | 'sight'
  | 'activity'
  | 'transport'
  | 'stay'
  | 'shopping'
  | 'other'
export type BookingKind = 'flight' | 'stay' | 'train' | 'car' | 'ticket' | 'other'

export type TripTodo = {
  todo_id: string
  title: string
  done: boolean
  done_by?: string
  done_at?: string
  day?: string | null
  start_time?: string | null
  duration_min?: number | null
  tz?: string
  order: number
  category: TripCategory
  notes?: string
  place?: Place | null
  // The booking this todo is about (a timed entry, a train), when linked.
  booking_id?: string | null
  created_by?: string
  updated_by?: string
  // Server time of the last change (ISO). Optional: used for "changed in the last 24h".
  updated_at?: string
  v?: number
}

export type Booking = {
  booking_id: string
  kind: BookingKind
  title: string
  confirmation_code?: string
  starts_at?: string | null
  ends_at?: string | null
  start_tz?: string | null
  end_tz?: string | null
  // Where it starts (departure, pick-up) and where it ends (arrival, drop-off).
  place?: Place | null
  end_place?: Place | null
  notes?: string
  created_by?: string
  updated_by?: string
  updated_at?: string
  v?: number
}

export type TripFields = {
  title: string
  destination?: Place | null
  notes?: string
  start_date?: string | null
  end_date?: string | null
  tz?: string
  packing_list_id?: string | null
  // One of the House icons (the same set lists use); shown on the trip's sheet.
  icon?: string
  stops?: Place[]
  days?: Record<string, string>
}

export type Trip = TripFields & {
  trip_id: string
  todos: TripTodo[]
  bookings: Booking[]
  version: number
  // Set when a member deleted the trip; it can be restored for 30 days.
  deleted?: { by?: string } | null
  created_by?: string
}

export type TripDelta = {
  trip_id: string
  full: boolean
  base_version: number
  version: number
  deleted?: boolean
  deleted_by?: string
  trip?: TripFields
  todos?: TripTodo[]
  bookings?: Booking[]
  removed_ids?: string[]
}

export type RemovedTrip = { trip_id: string; deleted_by?: string; purged?: boolean }

export type TripOpType =
  | 'trip.create'
  | 'trip.update'
  | 'trip.delete'
  | 'trip.restore'
  | 'todo.create'
  | 'todo.update'
  | 'todo.delete'
  | 'booking.create'
  | 'booking.update'
  | 'booking.delete'

export type TripOp = {
  v: 1
  op_id: string
  client_id: string
  seq: number
  at: number
  type: TripOpType
  trip_id: string
  entity_id?: string
  patch?: Record<string, unknown>
}

export type OpResult = {
  op_id: string
  status: 'applied' | 'duplicate' | 'conflicted' | 'rejected' | 'retry'
  code?: 'gone' | 'invalid' | 'cap' | 'forbidden_or_unknown' | 'unsupported'
  skipped_fields?: string[]
}

export type SyncResponse = {
  server_time: number
  trips: TripDelta[]
  removed: Array<RemovedTrip | string>
}

export type OpsResponse = { server_time: number; results: OpResult[]; trips: TripDelta[] }
