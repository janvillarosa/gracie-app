package trips

import (
	"context"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func TestDeriveTripEvents(t *testing.T) {
	created := time.Date(2026, 6, 1, 23, 30, 0, 0, time.UTC) // Jun 2 in Sydney, still Jun 1 in UTC/NY
	done := time.Date(2026, 6, 10, 12, 0, 0, 0, time.UTC)
	deleted := created.AddDate(0, 0, 20)
	trip := models.Trip{
		TripID: "trip_1", RoomID: "room_1", CreatedBy: "mia", CreatedAt: created,
		TripFields: models.TripFields{StartDate: bfStr("2026-06-11"), TZ: "Europe/Paris"},
		Todos: []models.TripTodo{
			{TodoID: "td1", Done: true, DoneBy: "sam", DoneAt: &done, Category: "Packing", Title: "secret"},
			{TodoID: "td2", Done: false, Category: "Food"},
			{TodoID: "td3", Done: true, DoneAt: nil, Category: "Food"}, // checked but no time: nothing to date it by
			{TodoID: "td4", Done: true, DoneAt: &done, Category: "Food"},
		},
	}

	zone := func(actor string) string {
		if actor == "mia" {
			return "Australia/Sydney"
		}
		return "UTC"
	}
	evs := deriveTripEvents(trip, zone)
	if len(evs) != 3 {
		t.Fatalf("want created + 2 checked, got %d: %+v", len(evs), evs)
	}
	created0 := evs[0]
	// 23:30 UTC Jun 1 is already Jun 2 in Sydney, so one day closer to the Jun 11 start.
	if created0.Name != "trip.created" || created0.ActorID != "mia" || created0.Props["days_to_start"] != int64(9) {
		t.Fatalf("created: %+v", created0)
	}
	if c := evs[1]; c.Name != "todo.checked" || c.ActorID != "sam" || c.Category != "Packing" || c.Props["days_to_start"] != int64(1) ||
		c.Container == nil || *c.Container != (analytics.Ref{Type: "trip", ID: "trip_1"}) || c.Subject.ID != "td1" {
		t.Fatalf("checked: %+v", c)
	}
	if c := evs[2]; c.ActorID != BackfillActor {
		t.Fatalf("a todo with no done_by is attributed to the system actor, got %q", c.ActorID)
	}
	for _, e := range evs {
		if e.Key != "" {
			t.Fatalf("user text leaked into key: %+v", e)
		}
	}

	trip.DeletedAt, trip.DeletedBy = &deleted, "mia"
	evs = deriveTripEvents(trip, zone)
	var del *analytics.Event
	for i := range evs {
		if evs[i].Name == "trip.deleted" {
			del = &evs[i]
		}
	}
	if del == nil || !del.OccurredAt.Equal(deleted) || del.ActorID != "mia" || del.Props != nil {
		t.Fatalf("deleted: %+v", del)
	}

	trip.StartDate = nil
	for _, e := range deriveTripEvents(trip, zone) {
		if e.Props != nil {
			t.Fatalf("a trip with no start date has no lead time: %+v", e)
		}
	}
}

func TestBackfillSourceZonePreferenceAndRoomScope(t *testing.T) {
	at := time.Date(2026, 6, 1, 9, 0, 0, 0, time.UTC)
	trip := models.Trip{TripID: "trip_1", RoomID: "room_1", CreatedBy: "mia", CreatedAt: at, TripFields: models.TripFields{TZ: "Europe/Paris"}}
	var askedRoom string
	walker := func(_ context.Context, roomID string, fn func(models.Trip) error) error {
		askedRoom = roomID
		return fn(trip)
	}
	run := func(tz func(context.Context, string, string) string) (zone string) {
		env := analytics.BackfillEnv{RoomID: "room_1", TZ: tz}
		if err := NewBackfillSource(walker).Each(context.Background(), env, func(_ analytics.Event, hint string) error {
			zone = hint
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		return zone
	}
	if z := run(func(context.Context, string, string) string { return "America/New_York" }); z != "America/New_York" {
		t.Fatalf("the person's own zone wins, got %q", z)
	}
	if askedRoom != "room_1" {
		t.Fatalf("room filter not passed to the walker: %q", askedRoom)
	}
	if z := run(func(context.Context, string, string) string { return "" }); z != "Europe/Paris" {
		t.Fatalf("the trip's zone is the fallback, got %q", z)
	}
	if z := run(nil); z != "Europe/Paris" {
		t.Fatalf("no resolver: trip zone, got %q", z)
	}
}

func bfStr(s string) *string { return &s }
