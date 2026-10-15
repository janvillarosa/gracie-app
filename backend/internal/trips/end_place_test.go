package trips

import (
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func place(name, tz string) map[string]any {
	m := map[string]any{"name": name, "lat": 35.0, "lng": 135.0, "source": "photon", "locality": name}
	if tz != "" {
		m["tz"] = tz
	}
	return m
}

func TestBookingEndPlaceSetClearDeltaAndTZDerivation(t *testing.T) {
	h := newTripH(t)
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{
		"kind": "flight", "title": "NH 105", "place": place("Tokyo HND", "Asia/Tokyo"), "end_place": place("Lisbon LIS", "Europe/Lisbon"),
	}, t0+10), models.OpApplied, "")
	b := h.trip.Bookings[0]
	if b.EndPlace == nil || b.EndPlace.Name != "Lisbon LIS" || b.EndPlace.Locality != "Lisbon LIS" || b.FieldAt["end_place"] != t0+10 {
		t.Fatalf("end_place not stored: %+v", b)
	}
	if b.EndTZ == nil || *b.EndTZ != "Europe/Lisbon" || b.StartTZ != nil {
		t.Fatalf("end_tz derived, start_tz not: start=%v end=%v", b.StartTZ, b.EndTZ)
	}

	before := h.trip.Version
	d := DeltaSince(h.trip, before-1, true)
	if len(d.Bookings) != 1 || d.Bookings[0].EndPlace == nil {
		t.Fatalf("delta lacks end_place: %+v", d.Bookings)
	}

	// an explicit end_tz in the same patch wins over derivation
	mustStatus(t, h.do("dev-a", TypeBookingUpdate, bookingID(1), map[string]any{"end_place": place("Porto OPO", "Europe/Lisbon"), "end_tz": "Europe/London"}, t0+20), models.OpApplied, "")
	if *h.trip.Bookings[0].EndTZ != "Europe/London" {
		t.Fatalf("explicit end_tz overridden: %v", *h.trip.Bookings[0].EndTZ)
	}
	// a place without tz leaves end_tz alone
	mustStatus(t, h.do("dev-a", TypeBookingUpdate, bookingID(1), map[string]any{"end_place": place("Somewhere", "")}, t0+30), models.OpApplied, "")
	if *h.trip.Bookings[0].EndTZ != "Europe/London" {
		t.Fatalf("end_tz changed without a tz on the place")
	}

	mustStatus(t, h.do("dev-a", TypeBookingUpdate, bookingID(1), map[string]any{"end_place": nil}, t0+40), models.OpApplied, "")
	if h.trip.Bookings[0].EndPlace != nil || h.trip.Bookings[0].Place == nil {
		t.Fatalf("null should clear only end_place: %+v", h.trip.Bookings[0])
	}
}

func TestBookingEndPlaceConflictAndValidation(t *testing.T) {
	h := newTripH(t)
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{"kind": "train", "title": "x", "end_place": place("A", "")}, t0+100), models.OpApplied, "")
	res := h.do("dev-b", TypeBookingUpdate, bookingID(1), map[string]any{"end_place": place("B", "")}, t0+50)
	if res.Status != models.OpConflicted || len(res.SkippedFields) != 1 || res.SkippedFields[0] != "end_place" || h.trip.Bookings[0].EndPlace.Name != "A" {
		t.Fatalf("got %+v", res)
	}

	bad := place("C", "")
	bad["from_the_future"] = 1
	mustStatus(t, h.do("dev-a", TypeBookingUpdate, bookingID(1), map[string]any{"end_place": bad}, t0+200), models.OpRejected, models.CodeUnsupported)
	badCoord := place("C", "")
	badCoord["lat"] = 123.0
	mustStatus(t, h.do("dev-a", TypeBookingUpdate, bookingID(1), map[string]any{"end_place": badCoord}, t0+201), models.OpRejected, models.CodeInvalid)
	longLoc := place("C", "")
	longLoc["locality"] = string(make([]byte, 0)) + "x"
	for i := 0; i < 121; i++ {
		longLoc["locality"] = longLoc["locality"].(string) + "x"
	}
	mustStatus(t, h.do("dev-a", TypeBookingUpdate, bookingID(1), map[string]any{"end_place": longLoc}, t0+202), models.OpRejected, models.CodeInvalid)
}
