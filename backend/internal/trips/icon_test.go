package trips

import (
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func TestTripIconSetClearInvalidAndDelta(t *testing.T) {
	h := newTripH(t)
	before := h.trip.Version
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"icon": "ROAD_TRIP"}, t0+100), models.OpApplied, "")
	if h.trip.Icon != "ROAD_TRIP" || h.trip.FieldAt["icon"] != t0+100 {
		t.Fatalf("icon=%q clocks=%v", h.trip.Icon, h.trip.FieldAt)
	}
	d := DeltaSince(h.trip, before, true)
	if d.Trip == nil || d.Trip.Icon != "ROAD_TRIP" {
		t.Fatalf("delta lacks icon: %+v", d.Trip)
	}
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"icon": ""}, t0+200), models.OpApplied, "")
	if h.trip.Icon != "" {
		t.Fatalf("not cleared")
	}
	for _, bad := range []string{"suitcase", "ROCKET", " SKI", "SKI "} {
		mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"icon": bad}, t0+300), models.OpRejected, models.CodeInvalid)
	}
	for _, ok := range []string{"SUITCASE", "PLANE", "BEACH", "MOUNTAIN", "CITY", "TRAIN", "ROAD_TRIP", "CAMPING", "MAP", "LANDMARK", "WINE", "SKI"} {
		mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"icon": ok}, t0+400), models.OpApplied, "")
	}
}

func TestTripIconOnCreateAndStaleWriteConflicts(t *testing.T) {
	h := newHarness(t)
	mustStatus(t, h.do("dev-a", TypeTripCreate, "", map[string]any{"title": "Alps", "icon": "SKI"}, t0+100), models.OpApplied, "")
	if h.trip.Icon != "SKI" {
		t.Fatalf("icon on create lost")
	}
	res := h.do("dev-b", TypeTripUpdate, "", map[string]any{"icon": "BEACH"}, t0+50)
	if res.Status != models.OpConflicted || len(res.SkippedFields) != 1 || res.SkippedFields[0] != "icon" || h.trip.Icon != "SKI" {
		t.Fatalf("got %+v icon=%q", res, h.trip.Icon)
	}
}
