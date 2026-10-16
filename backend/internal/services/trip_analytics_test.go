package services

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
)

func tripRecorder(t *testing.T, e *tripEnv) *analytics.MemRecorder {
	t.Helper()
	reg := analytics.NewRegistry()
	RegisterAnalyticsEvents(reg)
	trips.RegisterAnalyticsEvents(reg)
	rec := analytics.NewMemRecorder(reg)
	e.svc.UseRecorder(rec)
	return rec
}

func TestTripOpsEmitEventsWithLeadTime(t *testing.T) {
	e := newTripEnv(t)
	rec := tripRecorder(t, e)
	ctx := analytics.WithTZ(context.Background(), "UTC")
	start := time.Now().UTC().AddDate(0, 0, 5).Format("2006-01-02")
	end := time.Now().UTC().AddDate(0, 0, 8).Format("2006-01-02")

	batch := []json.RawMessage{
		opJSON(t, "dev-a", 1, "trip.create", "", map[string]any{"title": "Japan", "start_date": start, "end_date": end}),
		opJSON(t, "dev-a", 2, "todo.create", svcTodoID("1"), map[string]any{"title": "Ramen", "category": "food"}),
		opJSON(t, "dev-a", 3, "todo.update", svcTodoID("1"), map[string]any{"done": true}),
		opJSON(t, "dev-a", 4, "todo.update", svcTodoID("1"), map[string]any{"done": false, "day": start, "notes": "x"}),
	}
	if _, err := e.svc.ApplyOps(ctx, e.ua, "room_1", batch); err != nil {
		t.Fatal(err)
	}
	// Replaying the same batch is all duplicates: no new events.
	if _, err := e.svc.ApplyOps(ctx, e.ua, "room_1", batch); err != nil {
		t.Fatal(err)
	}

	want := []string{"trip.created", "todo.created", "todo.checked", "todo.unchecked", "todo.scheduled", "todo.edited"}
	if got := rec.Names(); !reflect.DeepEqual(got, want) {
		t.Fatalf("events\n got %v\nwant %v", got, want)
	}
	evs := rec.Events()
	created := evs[1]
	if created.Subject.Type != "todo" || created.Container == nil || created.Container.Type != "trip" ||
		created.Container.ID != svcTripID || created.Category != "food" || created.ActorID != "user_a" || created.RoomID != "room_1" {
		t.Fatalf("todo.created envelope: %+v", created)
	}
	for _, ev := range evs {
		if ev.Props["days_to_start"] != int64(5) {
			t.Fatalf("%s days_to_start = %v, want 5", ev.Name, ev.Props["days_to_start"])
		}
	}
	if edited := evs[5]; edited.Props["fields"] != "notes" {
		t.Fatalf("edited fields: %+v", edited.Props)
	}
	// Titles are user content and never copied into events.
	for _, ev := range evs {
		if ev.Key != "" {
			t.Fatalf("trip events must not carry a key: %+v", ev)
		}
	}
}

func TestTripEventUsesClientClockWithinBounds(t *testing.T) {
	e := newTripEnv(t)
	rec := tripRecorder(t, e)
	ctx := context.Background()
	if _, err := e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t)); err != nil {
		t.Fatal(err)
	}
	for _, ev := range rec.Events() {
		// opJSON stamps "at" one second in the past: the event keeps the client time, not the ingest time.
		if !ev.OccurredAt.Before(ev.IngestedAt) {
			t.Fatalf("%s occurred %v should precede ingest %v", ev.Name, ev.OccurredAt, ev.IngestedAt)
		}
	}
}

func TestPackingListEmitsTripEvent(t *testing.T) {
	e := newTripEnv(t)
	rec := tripRecorder(t, e)
	ctx := context.Background()
	if _, err := e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t)); err != nil {
		t.Fatal(err)
	}
	before := len(rec.Events())
	if _, err := e.svc.EnsurePackingList(ctx, e.ua, "room_1", svcTripID); err != nil {
		t.Fatal(err)
	}
	evs := rec.Events()[before:]
	if len(evs) != 1 || evs[0].Name != "trip.packing_list_created" || evs[0].Subject.ID != svcTripID {
		t.Fatalf("got %+v", evs)
	}
	// Idempotent: a second call links nothing new.
	if _, err := e.svc.EnsurePackingList(ctx, e.ua, "room_1", svcTripID); err != nil {
		t.Fatal(err)
	}
	if len(rec.Events()) != before+1 {
		t.Fatal("second EnsurePackingList must not emit again")
	}
}
