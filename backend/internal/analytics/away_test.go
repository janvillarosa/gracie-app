package analytics_test

import (
	"context"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
)

func intervalsV(doc map[string]any) int {
	iv, ok := doc["intervals"].(analytics.KeyIntervals)
	if !ok {
		return -1
	}
	return iv.Version
}

// TestAwayChangeRequeuesOnlyThatRoom: moving a trip re-learns that house's forecasts within one
// fold tick, and only that house's.
func TestAwayChangeRequeuesOnlyThatRoom(t *testing.T) {
	reg := registry()
	trips.RegisterAnalyticsEvents(reg)
	r := newRig(t0.Add(40 * 24 * time.Hour))
	r.worker = analytics.NewWorker(r.events, r.aggs, reg).WithClock(func() time.Time { return r.now })
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		at := t0.Add(time.Duration(i) * 7 * 24 * time.Hour)
		r.add(ev("item.added", "mia", "room_a", "milk", at), ev("item.added", "sam", "room_b", "milk", at))
	}
	if _, err := r.worker.FoldOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if intervalsV(r.aggs.Key("room_a:item:milk")) != analytics.ForecastVersion || intervalsV(r.aggs.Key("room_b:item:milk")) != analytics.ForecastVersion {
		t.Fatal("both forecasts should be current after the first fold")
	}

	moved := analytics.Event{Name: "trip.away_changed", Source: analytics.SourceServer, ActorID: "mia", RoomID: "room_a",
		Subject: analytics.Ref{Type: "trip", ID: "trip_1"}, OccurredAt: r.now}
	analytics.Stamp(&moved, r.now, "UTC", 400*24*time.Hour)
	moved.EventID = "moved"
	r.add(moved)
	batch := analytics.Fold(reg, []analytics.Event{moved})
	if _, ok := batch.Requeue["room_a"]; !ok || len(batch.Requeue) != 1 {
		t.Fatalf("the fold should requeue room_a only: %v", batch.Requeue)
	}
	if len(batch.Periods) != 0 {
		t.Fatal("a requeue signal is not behavior: nothing is counted")
	}
	if _, ok := batch.Dirty["h:room_a"]; !ok {
		t.Fatal("the house profile (run rhythm) is recomputed too")
	}
	r.now = r.now.Add(5 * time.Minute) // one fold tick later
	if _, err := r.worker.FoldOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if v := intervalsV(r.aggs.Key("room_a:item:milk")); v != 0 {
		t.Fatalf("room_a's forecast should be stale, v=%d", v)
	}
	if v := intervalsV(r.aggs.Key("room_b:item:milk")); v != analytics.ForecastVersion {
		t.Fatalf("room_b's forecast must be untouched, v=%d", v)
	}
	if n, err := r.worker.RefreshStale(ctx, 500); err != nil || n != 1 {
		t.Fatalf("one stale forecast rebuilt in the same tick, got %d %v", n, err)
	}
}
