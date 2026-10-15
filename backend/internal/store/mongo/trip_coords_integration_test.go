//go:build integration

package mongo

import (
	"context"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
)

func TestMongoCoordsExpiryIndexAndPurgeRoundTrip(t *testing.T) {
	c := connectOrSkip(t)
	r := NewTripRepo(c)
	ctx := context.Background()
	if err := r.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}

	// the partial index exists
	idxs, _ := r.col().Indexes().List(ctx)
	var found bool
	for idxs.Next(ctx) {
		var d struct {
			Name    string `bson:"name"`
			Partial any    `bson:"partialFilterExpression"`
		}
		if err := idxs.Decode(&d); err == nil && d.Name == "coords_expire_at" && d.Partial != nil {
			found = true
		}
	}
	if !found {
		t.Fatalf("coords_expire_at partial index missing")
	}

	now := time.Now().UTC().Truncate(time.Millisecond)
	old := now.Add(-40 * 24 * time.Hour)
	fresh := now.Add(-time.Hour)
	due := trips.NewShell("trip_"+randHex(16), "room_coords", "u", now)
	due.Version = 2
	due.Destination = &models.Place{PlaceID: "d", Lat: fptr(1), Lng: fptr(2), TZ: "Asia/Tokyo", CoordsFetchedAt: &old, Source: "google"}
	due.Todos = []models.TripTodo{{TodoID: "ttd_1", V: 1, Place: &models.Place{PlaceID: "p", Lat: fptr(1), Lng: fptr(2), CoordsFetchedAt: &fresh, Source: "google"}}}
	trips.RecomputeCoordsExpiry(due)
	notDue := trips.NewShell("trip_"+randHex(16), "room_coords", "u", now)
	notDue.Version = 1
	notDue.Destination = &models.Place{PlaceID: "d", Lat: fptr(1), Lng: fptr(2), CoordsFetchedAt: &fresh, Source: "google"}
	trips.RecomputeCoordsExpiry(notDue)
	plain := trips.NewShell("trip_"+randHex(16), "room_coords", "u", now)
	plain.Version = 1
	for _, tr := range []*models.Trip{due, notDue, plain} {
		if err := r.Insert(ctx, tr); err != nil {
			t.Fatal(err)
		}
	}

	got, err := r.ListCoordsExpired(ctx, now, 50)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, g := range got {
		if g.RoomID == "room_coords" {
			ids = append(ids, g.TripID)
		}
	}
	if len(ids) != 1 || ids[0] != due.TripID {
		t.Fatalf("only the due trip may be listed, got %v", ids)
	}

	// purge it exactly as the service does, with the CAS write
	tr, _ := r.Get(ctx, due.TripID)
	base := tr.Version
	if !trips.PurgeStaleCoords(tr, now) {
		t.Fatal("expected a purge")
	}
	if ok, err := r.ReplaceCAS(ctx, tr, base); err != nil || !ok {
		t.Fatalf("CAS: %v %v", ok, err)
	}
	after, _ := r.Get(ctx, due.TripID)
	if after.Version != base+1 || after.Destination.Lat != nil || after.Destination.CoordsFetchedAt != nil ||
		after.Destination.PlaceID != "d" || after.Destination.TZ != "Asia/Tokyo" || after.Todos[0].Place.Lat == nil {
		t.Fatalf("stored result: %+v dest=%+v", after, after.Destination)
	}
	if after.CoordsExpireAt == nil || !after.CoordsExpireAt.After(now) {
		t.Fatalf("expiry not advanced: %v", after.CoordsExpireAt)
	}
	// second pass finds nothing for our rooms
	again, _ := r.ListCoordsExpired(ctx, now, 50)
	for _, g := range again {
		if g.RoomID == "room_coords" {
			t.Fatalf("still due after purge: %s", g.TripID)
		}
	}
	// a trip whose coordinates are all purged stops being indexed
	tr2, _ := r.Get(ctx, notDue.TripID)
	if tr2.CoordsExpireAt == nil {
		t.Fatalf("fresh trip lost its expiry")
	}
}
