package analytics_test

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
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

type countingCalendar struct {
	calls map[string]int
	away  predict.Away
}

func (c *countingCalendar) HouseAway(_ context.Context, roomID string) (predict.Away, error) {
	c.calls[roomID]++
	return c.away, nil
}

func (c *countingCalendar) MemberAway(_ context.Context, roomID, userID string) (predict.Away, error) {
	return nil, nil
}

func TestAwayCalendarIsAskedOncePerRoomPerTick(t *testing.T) {
	r := newRig(t0.Add(40 * 24 * time.Hour))
	cal := &countingCalendar{calls: map[string]int{}}
	r.worker = r.worker.WithAway(cal)
	for i := 0; i < 5; i++ {
		at := t0.Add(time.Duration(i) * 7 * 24 * time.Hour)
		r.add(ev("item.added", "mia", "room_a", "milk", at), ev("item.added", "mia", "room_a", "eggs", at),
			ev("item.added", "sam", "room_b", "milk", at))
	}
	if _, err := r.worker.FoldOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if cal.calls["room_a"] != 1 || cal.calls["room_b"] != 1 {
		t.Fatalf("one lookup per room per tick: %v", cal.calls)
	}
	r.add(ev("item.added", "mia", "room_a", "milk", r.now.Add(-time.Minute))) // ingested after the watermark
	r.now = r.now.Add(5 * time.Minute)
	if _, err := r.worker.FoldOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if cal.calls["room_a"] != 2 {
		t.Fatalf("the cache lasts one tick only: %v", cal.calls)
	}
}

func TestForecastIsLearnedInHomeTime(t *testing.T) {
	r := newRig(t0.Add(120 * 24 * time.Hour))
	// weekly adds, a 10 day holiday after the 6th, then weekly again a week of home time later
	trip := predict.Away{{Opens: t0.Add(36 * 24 * time.Hour), Closes: t0.Add(46 * 24 * time.Hour)}}
	r.worker = r.worker.WithAway(&countingCalendar{calls: map[string]int{}, away: trip})
	for i := 0; i < 6; i++ {
		r.add(ev("item.added", "mia", "room_a", "milk", t0.Add(time.Duration(7*i)*24*time.Hour)))
		r.add(ev("item.added", "mia", "room_a", "milk", t0.Add(time.Duration(52+7*i)*24*time.Hour)))
	}
	if _, err := r.worker.FoldOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	iv := r.aggs.Key("room_a:item:milk")["intervals"].(analytics.KeyIntervals)
	if iv.Version != 3 || iv.Add == nil || iv.Add.EWMADays != 7 || iv.Add.CV > 1e-9 || math.Abs(iv.EWMADays-7) > 1e-9 {
		t.Fatalf("home-time forecast: %+v add %+v", iv, iv.Add)
	}
}
