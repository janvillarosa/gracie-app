package models

import "testing"

func TestTripCloneIsDeep(t *testing.T) {
	day := "2026-11-01"
	orig := &Trip{
		TripID:     "trip_x",
		FieldAt:    map[string]int64{"title": 1},
		Acked:      map[string]int64{"dev": 1},
		Todos:      []TripTodo{{TodoID: "ttd_1", Day: &day, FieldAt: map[string]int64{"title": 1}}},
		Bookings:   []Booking{{BookingID: "tbk_1", FieldAt: map[string]int64{"kind": 1}}},
		Tombstones: []Tombstone{{ID: "ttd_0", V: 2}},
	}
	c := orig.Clone()
	c.FieldAt["title"] = 99
	c.Acked["dev"] = 99
	c.Todos[0].FieldAt["title"] = 99
	c.Todos[0].Title = "changed"
	c.Bookings[0].FieldAt["kind"] = 99
	c.Tombstones[0].V = 99
	if orig.FieldAt["title"] != 1 || orig.Acked["dev"] != 1 ||
		orig.Todos[0].FieldAt["title"] != 1 || orig.Todos[0].Title != "" ||
		orig.Bookings[0].FieldAt["kind"] != 1 || orig.Tombstones[0].V != 2 {
		t.Fatalf("Clone shared state with the original")
	}
}
