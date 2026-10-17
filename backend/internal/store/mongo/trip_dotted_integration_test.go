//go:build integration

package mongo

import (
	"context"
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

// Per-date day-label clocks use dotted keys ("days.2026-10-24") inside field_at.
// Mongo 5+ accepts dots in field names for whole-document writes; prove it round-trips.
func TestMongoTripRoundtripsDaysStopsAndDottedClocks(t *testing.T) {
	c := connectOrSkip(t)
	r := NewTripRepo(c)
	ctx := context.Background()
	id := "trip_" + randHex(16)
	tr := newTestTrip(id, "room_1")
	tr.Days = map[string]string{"2026-10-24": "Sintra"}
	tr.FieldAt["days.2026-10-24"] = 42
	tr.Stops = []models.Place{{Name: "Lisbon", Locality: "Lisbon", Lat: fptr(38.7), Lng: fptr(-9.1), Source: "manual"}}
	if err := r.Insert(ctx, tr); err != nil {
		t.Fatal(err)
	}
	got, err := r.Get(ctx, id)
	if err != nil || got.Days["2026-10-24"] != "Sintra" || got.FieldAt["days.2026-10-24"] != 42 || got.Stops[0].Locality != "Lisbon" {
		t.Fatalf("roundtrip lost data: %+v err=%v", got, err)
	}
	next := got.Clone()
	next.Version = got.Version + 1
	next.Days["2026-10-25"] = "Porto"
	next.FieldAt["days.2026-10-25"] = 43
	if ok, err := r.ReplaceCAS(ctx, next, got.Version); err != nil || !ok {
		t.Fatalf("CAS replace with dotted keys: %v %v", ok, err)
	}
	again, _ := r.Get(ctx, id)
	if again.Days["2026-10-25"] != "Porto" || again.FieldAt["days.2026-10-25"] != 43 {
		t.Fatalf("second write lost: %+v", again)
	}
}

func TestMongoTripRoundtripsTravellers(t *testing.T) {
	c := connectOrSkip(t)
	r := NewTripRepo(c)
	ctx := context.Background()
	id := "trip_" + randHex(16)
	tr := newTestTrip(id, "room_1")
	tr.Travellers = []string{"user_a", "user_b"}
	if err := r.Insert(ctx, tr); err != nil {
		t.Fatal(err)
	}
	got, err := r.Get(ctx, id)
	if err != nil || len(got.Travellers) != 2 || got.Travellers[1] != "user_b" {
		t.Fatalf("roundtrip lost travellers: %+v err=%v", got.Travellers, err)
	}
	next := got.Clone()
	next.Version = got.Version + 1
	next.Travellers = nil // back to the whole house
	if ok, err := r.ReplaceCAS(ctx, next, got.Version); err != nil || !ok {
		t.Fatalf("CAS: %v %v", ok, err)
	}
	again, _ := r.Get(ctx, id)
	if again.Travellers != nil {
		t.Fatalf("cleared travellers came back: %v", again.Travellers)
	}
}

func fptr(v float64) *float64 { return &v }
