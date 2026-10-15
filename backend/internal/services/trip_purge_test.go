package services

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
)

func f64(v float64) *float64 { return &v }

func seedStaleTrip(t *testing.T, e *tripEnv, id string) {
	t.Helper()
	old := time.Now().UTC().Add(-40 * 24 * time.Hour)
	fresh := time.Now().UTC().Add(-time.Hour)
	tr := trips.NewShell(id, "room_1", "user_a", time.Now().UTC())
	tr.Title, tr.Version, tr.V = "Lisbon", 3, 3
	tr.Destination = &models.Place{PlaceID: "dest", Lat: f64(38.7), Lng: f64(-9.1), TZ: "Europe/Lisbon", CoordsFetchedAt: &old, Source: "google"}
	tr.Todos = []models.TripTodo{
		{TodoID: "ttd_old", V: 2, Place: &models.Place{PlaceID: "p1", Lat: f64(1), Lng: f64(2), CoordsFetchedAt: &old, Source: "google"}},
		{TodoID: "ttd_new", V: 2, Place: &models.Place{PlaceID: "p2", Lat: f64(1), Lng: f64(2), CoordsFetchedAt: &fresh, Source: "google"}},
	}
	trips.RecomputeCoordsExpiry(tr)
	if err := e.repos.Trips.Insert(context.Background(), tr); err != nil {
		t.Fatal(err)
	}
}

func TestPurgeStaleCoordsRewritesOnlyDueTripsAndIsIdempotent(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	seedStaleTrip(t, e, svcTripID)
	// a trip with only fresh or user-content places is never read, let alone rewritten
	clean := trips.NewShell(svcTripID2, "room_1", "user_a", time.Now().UTC())
	clean.Title, clean.Version = "Clean", 1
	if err := e.repos.Trips.Insert(ctx, clean); err != nil {
		t.Fatal(err)
	}

	n, err := e.svc.PurgeStaleCoords(ctx)
	if err != nil || n != 1 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	got, _ := e.repos.Trips.Get(ctx, svcTripID)
	if got.Version != 4 || got.V != 4 {
		t.Fatalf("version=%d v=%d", got.Version, got.V)
	}
	if d := got.Destination; d.Lat != nil || d.Lng != nil || d.CoordsFetchedAt != nil || d.PlaceID != "dest" || d.TZ != "Europe/Lisbon" {
		t.Fatalf("destination: %+v", d)
	}
	if td := got.Todos[0]; td.Place.Lat != nil || td.V != 4 || td.UpdatedBy != models.SystemActor {
		t.Fatalf("stale todo: %+v", td)
	}
	if td := got.Todos[1]; td.Place.Lat == nil || td.V != 2 {
		t.Fatalf("fresh todo touched: %+v", td)
	}
	if got.CoordsExpireAt == nil || !got.CoordsExpireAt.After(time.Now()) {
		t.Fatalf("expiry should now track the fresh coordinate: %v", got.CoordsExpireAt)
	}
	if c, _ := e.repos.Trips.Get(ctx, svcTripID2); c.Version != 1 {
		t.Fatalf("clean trip rewritten")
	}

	// clients syncing from version 3 receive the change
	resp, err := e.svc.Sync(ctx, e.ua, "room_1", map[string]int64{svcTripID: 3, svcTripID2: 1})
	if err != nil || len(resp.Trips) != 1 || resp.Trips[0].TripID != svcTripID || len(resp.Trips[0].Todos) != 1 || resp.Trips[0].Trip == nil {
		t.Fatalf("sync after purge: %+v %v", resp, err)
	}

	again, err := e.svc.PurgeStaleCoords(ctx)
	if err != nil || again != 0 {
		t.Fatalf("second run must be a no-op: n=%d err=%v", again, err)
	}
	if g, _ := e.repos.Trips.Get(ctx, svcTripID); g.Version != 4 {
		t.Fatalf("idempotency broken: version %d", g.Version)
	}
}

func TestPurgeLoopRunsAtStartupAndPeriodicallyUntilCancelled(t *testing.T) {
	e := newTripEnv(t)
	ctx, cancel := context.WithCancel(context.Background())
	seedStaleTrip(t, e, svcTripID)
	done := make(chan struct{})
	go func() { e.svc.RunCoordsPurge(ctx, 20*time.Millisecond, 5*time.Millisecond); close(done) }()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if g, _ := e.repos.Trips.Get(context.Background(), svcTripID); g.Version == 4 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if g, _ := e.repos.Trips.Get(context.Background(), svcTripID); g.Version != 4 {
		t.Fatalf("startup run did not purge")
	}
	// a trip that goes stale later is picked up by a periodic run
	seedStaleTrip(t, e, svcTripID2)
	for time.Now().Before(deadline) {
		if g, _ := e.repos.Trips.Get(context.Background(), svcTripID2); g.Version == 4 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if g, _ := e.repos.Trips.Get(context.Background(), svcTripID2); g.Version != 4 {
		t.Fatalf("periodic run did not purge")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatalf("loop did not stop on cancel")
	}
}

type fixedZone struct{ calls *int }

func (f fixedZone) TZ(lat, lng float64) string { *f.calls++; return "Europe/Lisbon" }

func TestApplyOpsDerivesTZForGoogleCoordsWhenMissing(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	calls := 0
	e.svc.UseTZ(fixedZone{&calls})
	place := map[string]any{"place_id": "ChIJx", "lat": 38.7, "lng": -9.1, "source": "google", "coords_fetched_at": time.Now().UTC().Format(time.RFC3339)}
	resp, err := e.svc.ApplyOps(ctx, e.ua, "room_1", []json.RawMessage{
		opJSON(t, "dev-a", 1, "trip.create", "", map[string]any{"title": "Lisbon", "destination": place}),
	})
	if err != nil || resp.Results[0].Status != models.OpApplied {
		t.Fatalf("%+v %v", resp, err)
	}
	got, _ := e.repos.Trips.Get(ctx, svcTripID)
	if got.Destination.TZ != "Europe/Lisbon" || got.TZ != "Europe/Lisbon" || calls != 1 {
		t.Fatalf("tz: dest=%q trip=%q calls=%d", got.Destination.TZ, got.TZ, calls)
	}
	if got.CoordsExpireAt == nil {
		t.Fatalf("expiry not tracked on write")
	}
}
