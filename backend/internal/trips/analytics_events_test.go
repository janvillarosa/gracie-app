package trips

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func eventNames(t *testing.T, trip *models.Trip, typ string, patch map[string]any) []string {
	t.Helper()
	var raw json.RawMessage
	if patch != nil {
		b, err := json.Marshal(patch)
		if err != nil {
			t.Fatal(err)
		}
		raw = b
	}
	op := models.Op{V: 1, OpID: "op-1", ClientID: "dev-a", Seq: 1, At: now0.UnixMilli(), Type: typ, TripID: trip.TripID, Patch: raw}
	var out []string
	for _, e := range EventsFor(trip, op, models.OpResult{Status: models.OpApplied}, "user_a", now0, "UTC") {
		out = append(out, e.Name)
		if e.Name == "trip.away_changed" && (e.Props != nil || e.Key != "" || e.RoomID != trip.RoomID) {
			t.Fatalf("away_changed carries only the room: %+v", e)
		}
	}
	return out
}

func hasName(names []string, n string) bool {
	for _, x := range names {
		if x == n {
			return true
		}
	}
	return false
}

func TestEventsForEmitsAwayChangedOnDatesTravellersAndZone(t *testing.T) {
	dated := &models.Trip{TripID: testTripID, RoomID: "room_1"}
	dated.StartDate, dated.EndDate = sp("2026-07-01"), sp("2026-07-10")
	for _, f := range []string{"start_date", "end_date", "travellers", "tz"} {
		if names := eventNames(t, dated, TypeTripUpdate, map[string]any{f: nil}); !hasName(names, "trip.away_changed") || !hasName(names, "trip.updated") {
			t.Fatalf("%s: %v", f, names)
		}
	}
	for _, f := range []string{"title", "notes", "icon", "stops", "days"} {
		if names := eventNames(t, dated, TypeTripUpdate, map[string]any{f: nil}); hasName(names, "trip.away_changed") {
			t.Fatalf("%s must not move the calendar: %v", f, names)
		}
	}
	for _, typ := range []string{TypeTripDelete, TypeTripRestore} {
		if names := eventNames(t, dated, typ, nil); !hasName(names, "trip.away_changed") {
			t.Fatalf("%s of a dated trip: %v", typ, names)
		}
	}
	if names := eventNames(t, dated, TypeTripCreate, map[string]any{"title": "x"}); !hasName(names, "trip.away_changed") {
		t.Fatalf("creating a dated trip: %v", names)
	}
	undated := &models.Trip{TripID: testTripID, RoomID: "room_1"}
	for _, typ := range []string{TypeTripDelete, TypeTripRestore, TypeTripCreate} {
		if names := eventNames(t, undated, typ, map[string]any{"title": "x"}); hasName(names, "trip.away_changed") {
			t.Fatalf("%s of an undated trip: %v", typ, names)
		}
	}
	// a skipped (conflicted) field did not change anything
	op := models.Op{V: 1, OpID: "op-1", ClientID: "dev-a", Seq: 1, At: now0.UnixMilli(), Type: TypeTripUpdate, TripID: testTripID,
		Patch: json.RawMessage(`{"start_date":"2026-07-02","title":"y"}`)}
	for _, e := range EventsFor(dated, op, models.OpResult{Status: models.OpConflicted, SkippedFields: []string{"start_date"}}, "user_a", now0, "UTC") {
		if e.Name == "trip.away_changed" {
			t.Fatal("a skipped date is not a change")
		}
	}
	_ = time.Now
}
