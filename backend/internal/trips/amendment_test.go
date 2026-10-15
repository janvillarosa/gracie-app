package trips

import (
	"fmt"
	"strings"
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func stopPlaces(n int) []map[string]any {
	out := make([]map[string]any, n)
	for i := range out {
		out[i] = map[string]any{"name": fmt.Sprintf("Stop %d", i), "lat": 1.0, "lng": 2.0, "source": "manual"}
	}
	return out
}

func TestDaysPerDateClocksDoNotConflict(t *testing.T) {
	h := newTripH(t)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"days": map[string]string{"2026-10-24": "Sintra"}}, t0+100), models.OpApplied, "")
	// a different member labels another day with an older clock: no conflict
	mustStatus(t, h.do("dev-b", TypeTripUpdate, "", map[string]any{"days": map[string]string{"2026-10-25": "Porto"}}, t0+50), models.OpApplied, "")
	if h.trip.Days["2026-10-24"] != "Sintra" || h.trip.Days["2026-10-25"] != "Porto" {
		t.Fatalf("days=%v", h.trip.Days)
	}
	if h.trip.FieldAt["days.2026-10-24"] == 0 || h.trip.FieldAt["days.2026-10-25"] == 0 {
		t.Fatalf("per-date clocks missing: %v", h.trip.FieldAt)
	}
	// same date, stale clock: conflicted and names the per-date field
	res := h.do("dev-b", TypeTripUpdate, "", map[string]any{"days": map[string]string{"2026-10-24": "Cascais"}}, t0+10)
	if res.Status != models.OpConflicted || len(res.SkippedFields) != 1 || res.SkippedFields[0] != "days.2026-10-24" {
		t.Fatalf("got %+v", res)
	}
	if h.trip.Days["2026-10-24"] != "Sintra" {
		t.Fatalf("stale label won: %v", h.trip.Days)
	}
}

func TestDaysEmptyStringRemovesAndValidation(t *testing.T) {
	h := newTripH(t)
	h.do("dev-a", TypeTripUpdate, "", map[string]any{"days": map[string]string{"2026-10-24": "Sintra"}}, t0+100)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"days": map[string]string{"2026-10-24": ""}}, t0+200), models.OpApplied, "")
	if _, ok := h.trip.Days["2026-10-24"]; ok || h.trip.Days != nil {
		t.Fatalf("label not removed: %v", h.trip.Days)
	}
	long := strings.Repeat("x", 41)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"days": map[string]string{"2026-10-24": long}}, t0+300), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"days": map[string]string{"not-a-date": "x"}}, t0+301), models.OpRejected, models.CodeInvalid)
}

func TestDaysCap(t *testing.T) {
	h := newTripH(t)
	h.trip.Days = map[string]string{}
	for i := 0; i < MaxDays; i++ {
		h.trip.Days[fmt.Sprintf("2027-%02d-%02d", 1+i/28, 1+i%28)] = "d"
	}
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"days": map[string]string{"2026-10-24": "one too many"}}, t0+100), models.OpRejected, models.CodeCap)
	// editing an existing label at the cap is fine
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"days": map[string]string{"2027-01-01": "renamed"}}, t0+101), models.OpApplied, "")
}

func TestStopsSetWholeListWithOneClock(t *testing.T) {
	h := newTripH(t)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"stops": stopPlaces(3)}, t0+100), models.OpApplied, "")
	if len(h.trip.Stops) != 3 || h.trip.FieldAt["stops"] != t0+100 {
		t.Fatalf("stops=%v clock=%v", h.trip.Stops, h.trip.FieldAt)
	}
	res := h.do("dev-b", TypeTripUpdate, "", map[string]any{"stops": stopPlaces(1)}, t0+50)
	if res.Status != models.OpConflicted || res.SkippedFields[0] != "stops" || len(h.trip.Stops) != 3 {
		t.Fatalf("got %+v stops=%d", res, len(h.trip.Stops))
	}
	mustStatus(t, h.do("dev-b", TypeTripUpdate, "", map[string]any{"stops": nil}, t0+500), models.OpApplied, "")
	if len(h.trip.Stops) != 0 {
		t.Fatalf("stops not cleared")
	}
}

func TestStopsCapAndValidation(t *testing.T) {
	h := newTripH(t)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"stops": stopPlaces(MaxStops)}, t0+100), models.OpApplied, "")
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"stops": stopPlaces(MaxStops + 1)}, t0+200), models.OpRejected, models.CodeCap)
	bad := []map[string]any{{"name": "x", "lat": 99.0, "lng": 0.0, "source": "manual"}}
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"stops": bad}, t0+201), models.OpRejected, models.CodeInvalid)
}

func TestLocalityValidated(t *testing.T) {
	h := newTripH(t)
	pl := map[string]any{"name": "Cafe", "locality": "Lisbon", "lat": 38.7, "lng": -9.1, "source": "manual"}
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"destination": pl}, t0+100), models.OpApplied, "")
	if h.trip.Destination.Locality != "Lisbon" {
		t.Fatalf("locality lost")
	}
	pl["locality"] = strings.Repeat("x", 121)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"destination": pl}, t0+200), models.OpRejected, models.CodeInvalid)
}

func TestCreatedByUpdatedByServerSetAndNotPatchable(t *testing.T) {
	h := newTripH(t)
	h.actor = "user_a"
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "x"}, t0+10), models.OpApplied, "")
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{"kind": "stay", "title": "y"}, t0+11), models.OpApplied, "")
	td, bk := h.trip.Todos[0], h.trip.Bookings[0]
	if td.CreatedBy != "user_a" || td.UpdatedBy != "user_a" || bk.CreatedBy != "user_a" || bk.UpdatedBy != "user_a" {
		t.Fatalf("creator not set: %+v %+v", td, bk)
	}
	h.actor = "user_b"
	mustStatus(t, h.do("dev-b", TypeTodoUpdate, todoID(1), map[string]any{"title": "x2"}, t0+20), models.OpApplied, "")
	mustStatus(t, h.do("dev-b", TypeBookingUpdate, bookingID(1), map[string]any{"title": "y2"}, t0+21), models.OpApplied, "")
	td, bk = h.trip.Todos[0], h.trip.Bookings[0]
	if td.CreatedBy != "user_a" || td.UpdatedBy != "user_b" || bk.CreatedBy != "user_a" || bk.UpdatedBy != "user_b" {
		t.Fatalf("update attribution wrong: %+v %+v", td, bk)
	}
	// a fully skipped (stale) update changes nothing, including updated_by
	h.actor = "user_c"
	h.do("dev-c", TypeTodoUpdate, todoID(1), map[string]any{"title": "stale"}, t0+5)
	if h.trip.Todos[0].UpdatedBy != "user_b" {
		t.Fatalf("updated_by changed by a no-op update")
	}
	// neither field is settable from a patch (strict decode => unsupported)
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"created_by": "evil"}, t0+30), models.OpRejected, models.CodeUnsupported)
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"updated_by": "evil"}, t0+31), models.OpRejected, models.CodeUnsupported)
	mustStatus(t, h.do("dev-a", TypeBookingUpdate, bookingID(1), map[string]any{"created_by": "evil"}, t0+32), models.OpRejected, models.CodeUnsupported)
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(2), map[string]any{"title": "z", "created_by": "evil"}, t0+33), models.OpRejected, models.CodeUnsupported)
}

func TestCloneCopiesDays(t *testing.T) {
	tr := &models.Trip{TripFields: models.TripFields{Days: map[string]string{"2026-10-24": "a"}}}
	c := tr.Clone()
	c.Days["2026-10-24"] = "b"
	if tr.Days["2026-10-24"] != "a" {
		t.Fatalf("clone shares Days map")
	}
}
