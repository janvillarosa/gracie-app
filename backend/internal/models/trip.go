package models

import (
	"encoding/json"
	"time"
)

// Per-op result statuses and rejection codes (see the Trips spec).
const (
	OpApplied    = "applied"
	OpDuplicate  = "duplicate"
	OpConflicted = "conflicted"
	OpRejected   = "rejected"
	OpRetry      = "retry"

	CodeGone               = "gone"
	CodeInvalid            = "invalid"
	CodeCap                = "cap"
	CodeForbiddenOrUnknown = "forbidden_or_unknown"
	CodeUnsupported        = "unsupported"
)

// Place is a self-contained snapshot of a location.
type Place struct {
	Name    string `bson:"name" json:"name"`
	Address string `bson:"address,omitempty" json:"address,omitempty"`
	// Locality is the town or city (from Photon city/town/village); empty for manual places.
	Locality string  `bson:"locality,omitempty" json:"locality,omitempty"`
	Lat      float64 `bson:"lat" json:"lat"`
	Lng      float64 `bson:"lng" json:"lng"`
	TZ       string  `bson:"tz,omitempty" json:"tz,omitempty"`
	OSMRef   string  `bson:"osm_ref,omitempty" json:"osm_ref,omitempty"`
	Source   string  `bson:"source" json:"source"` // photon | pin | manual
}

// TripTodo is a checkbox item inside a trip. Day == nil means "Ideas".
type TripTodo struct {
	TodoID      string     `bson:"todo_id" json:"todo_id"`
	Title       string     `bson:"title" json:"title"`
	Done        bool       `bson:"done" json:"done"`
	DoneBy      string     `bson:"done_by,omitempty" json:"done_by,omitempty"`
	DoneAt      *time.Time `bson:"done_at,omitempty" json:"done_at,omitempty"`
	Day         *string    `bson:"day,omitempty" json:"day,omitempty"`
	StartTime   *string    `bson:"start_time,omitempty" json:"start_time,omitempty"`
	DurationMin *int       `bson:"duration_min,omitempty" json:"duration_min,omitempty"`
	TZ          string     `bson:"tz,omitempty" json:"tz,omitempty"`
	Order       float64    `bson:"order" json:"order"`
	Category    string     `bson:"category" json:"category"`
	Notes       string     `bson:"notes,omitempty" json:"notes,omitempty"`
	Place       *Place     `bson:"place,omitempty" json:"place,omitempty"`
	// BookingID optionally links the todo to a booking of the same trip; cleared when that booking is deleted.
	BookingID *string          `bson:"booking_id,omitempty" json:"booking_id,omitempty"`
	CreatedBy string           `bson:"created_by,omitempty" json:"created_by,omitempty"`
	UpdatedBy string           `bson:"updated_by,omitempty" json:"updated_by,omitempty"`
	V         int64            `bson:"v" json:"v"`
	FieldAt   map[string]int64 `bson:"field_at" json:"-"`
}

// Booking is a vault entry (flight, stay, ticket...).
type Booking struct {
	BookingID        string           `bson:"booking_id" json:"booking_id"`
	Kind             string           `bson:"kind" json:"kind"`
	Title            string           `bson:"title" json:"title"`
	ConfirmationCode string           `bson:"confirmation_code,omitempty" json:"confirmation_code,omitempty"`
	StartsAt         *string          `bson:"starts_at,omitempty" json:"starts_at,omitempty"`
	EndsAt           *string          `bson:"ends_at,omitempty" json:"ends_at,omitempty"`
	StartTZ          *string          `bson:"start_tz,omitempty" json:"start_tz,omitempty"`
	EndTZ            *string          `bson:"end_tz,omitempty" json:"end_tz,omitempty"`
	Place            *Place           `bson:"place,omitempty" json:"place,omitempty"`
	Notes            string           `bson:"notes,omitempty" json:"notes,omitempty"`
	CreatedBy        string           `bson:"created_by,omitempty" json:"created_by,omitempty"`
	UpdatedBy        string           `bson:"updated_by,omitempty" json:"updated_by,omitempty"`
	V                int64            `bson:"v" json:"v"`
	FieldAt          map[string]int64 `bson:"field_at" json:"-"`
}

// Tombstone records a deleted todo/booking so deletes sync and creates cannot revive it.
type Tombstone struct {
	ID string    `bson:"id" json:"id"`
	V  int64     `bson:"v" json:"v"`
	At time.Time `bson:"at" json:"at"`
}

// TripFields are the trip's own editable fields (sent whole in deltas when changed).
type TripFields struct {
	Title         string  `bson:"title" json:"title"`
	Destination   *Place  `bson:"destination,omitempty" json:"destination,omitempty"`
	Notes         string  `bson:"notes,omitempty" json:"notes,omitempty"`
	StartDate     *string `bson:"start_date,omitempty" json:"start_date,omitempty"`
	EndDate       *string `bson:"end_date,omitempty" json:"end_date,omitempty"`
	TZ            string  `bson:"tz,omitempty" json:"tz,omitempty"`
	PackingListID *string `bson:"packing_list_id,omitempty" json:"packing_list_id,omitempty"`
	// Icon is one of the trips icon enum values (see package trips); empty means none.
	Icon string `bson:"icon,omitempty" json:"icon,omitempty"`
	// Stops is a hand-entered ordered route (cap 12). Display only; replaced as a whole list.
	Stops []Place `bson:"stops,omitempty" json:"stops,omitempty"`
	// Days maps "YYYY-MM-DD" to a short label (cap 60 entries); each date has its own clock.
	Days map[string]string `bson:"days,omitempty" json:"days,omitempty"`
}

// Trip is the persisted aggregate (collection "trips").
// Pointer fields (Place, *string, *time.Time) are treated as immutable values:
// code replaces them, never mutates through them, so Clone may share them.
type Trip struct {
	TripID     string `bson:"trip_id" json:"trip_id"`
	RoomID     string `bson:"room_id" json:"room_id"`
	TripFields `bson:",inline"`
	Todos      []TripTodo `bson:"todos" json:"todos"`
	Bookings   []Booking  `bson:"bookings" json:"bookings"`

	Version    int64            `bson:"version" json:"version"` // +1 per write that changed data
	V          int64            `bson:"v" json:"v"`             // version when TripFields last changed
	FieldAt    map[string]int64 `bson:"field_at" json:"-"`
	Acked      map[string]int64 `bson:"acked" json:"-"`              // highest applied op seq per client_id
	AckedAt    map[string]int64 `bson:"acked_at,omitempty" json:"-"` // ms since epoch each client_id was last seen
	Tombstones []Tombstone      `bson:"tombstones,omitempty" json:"-"`
	TombFloor  int64            `bson:"tomb_floor" json:"-"`

	DeletedAt *time.Time `bson:"deleted_at,omitempty" json:"deleted_at,omitempty"`
	DeletedBy string     `bson:"deleted_by,omitempty" json:"deleted_by,omitempty"`
	PurgeAt   *time.Time `bson:"purge_at,omitempty" json:"-"`

	CreatedBy string    `bson:"created_by" json:"created_by"`
	CreatedAt time.Time `bson:"created_at" json:"created_at"`
	UpdatedAt time.Time `bson:"updated_at" json:"updated_at"`
}

func cloneClock(m map[string]int64) map[string]int64 {
	out := make(map[string]int64, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// Clone returns a copy that is safe to mutate (maps and slices are copied).
func (t *Trip) Clone() *Trip {
	c := *t
	if t.Days != nil {
		c.Days = make(map[string]string, len(t.Days))
		for k, v := range t.Days {
			c.Days[k] = v
		}
	}
	c.FieldAt = cloneClock(t.FieldAt)
	c.Acked = cloneClock(t.Acked)
	c.AckedAt = cloneClock(t.AckedAt)
	c.Tombstones = append([]Tombstone(nil), t.Tombstones...)
	c.Todos = make([]TripTodo, len(t.Todos))
	for i, td := range t.Todos {
		td.FieldAt = cloneClock(td.FieldAt)
		c.Todos[i] = td
	}
	c.Bookings = make([]Booking, len(t.Bookings))
	for i, b := range t.Bookings {
		b.FieldAt = cloneClock(b.FieldAt)
		c.Bookings[i] = b
	}
	return &c
}

// Op is one client mutation. Patch is decoded per op type by package trips.
type Op struct {
	V        int             `json:"v"`
	OpID     string          `json:"op_id"`
	ClientID string          `json:"client_id"`
	Seq      int64           `json:"seq"`
	At       int64           `json:"at"` // client clock, ms since epoch
	Type     string          `json:"type"`
	TripID   string          `json:"trip_id"`
	EntityID string          `json:"entity_id,omitempty"`
	Patch    json.RawMessage `json:"patch,omitempty"`
}

// OpResult is the per-op outcome returned to the client.
type OpResult struct {
	OpID          string   `json:"op_id"`
	Status        string   `json:"status"`
	Code          string   `json:"code,omitempty"`
	SkippedFields []string `json:"skipped_fields,omitempty"`
}

// TripDelta is what a client needs to move one trip from BaseVersion to Version.
type TripDelta struct {
	TripID      string      `json:"trip_id"`
	Full        bool        `json:"full"`
	BaseVersion int64       `json:"base_version"`
	Version     int64       `json:"version"`
	Deleted     bool        `json:"deleted,omitempty"`
	DeletedBy   string      `json:"deleted_by,omitempty"`
	Trip        *TripFields `json:"trip,omitempty"`
	Todos       []TripTodo  `json:"todos,omitempty"`
	Bookings    []Booking   `json:"bookings,omitempty"`
	RemovedIDs  []string    `json:"removed_ids,omitempty"`
}

// RemovedTrip tells a client to drop a trip (soft-deleted, restorable) or that it was purged.
type RemovedTrip struct {
	TripID    string `json:"trip_id"`
	DeletedBy string `json:"deleted_by,omitempty"`
	Purged    bool   `json:"purged,omitempty"`
}
