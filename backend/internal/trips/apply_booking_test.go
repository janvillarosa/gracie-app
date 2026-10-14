package trips

import (
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func TestBookingLifecycleWithTwoZones(t *testing.T) {
	h := newTripH(t)
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{
		"kind": "flight", "title": "NH 105", "confirmation_code": "ABC123",
		"starts_at": "2026-11-01T09:30", "start_tz": "Asia/Tokyo",
		"ends_at": "2026-11-01T07:10", "end_tz": "America/Los_Angeles",
	}, t0+10), models.OpApplied, "")
	b := h.trip.Bookings[0]
	if b.ConfirmationCode != "ABC123" || *b.StartTZ != "Asia/Tokyo" || *b.EndTZ != "America/Los_Angeles" || b.V != h.trip.Version {
		t.Fatalf("unexpected booking: %+v", b)
	}
	mustStatus(t, h.do("dev-b", TypeBookingUpdate, bookingID(1), map[string]any{"ends_at": nil}, t0+20), models.OpApplied, "")
	if h.trip.Bookings[0].EndsAt != nil {
		t.Fatalf("ends_at should be cleared")
	}
	mustStatus(t, h.do("dev-b", TypeBookingDelete, bookingID(1), nil, t0+30), models.OpApplied, "")
	if len(h.trip.Bookings) != 0 || len(h.trip.Tombstones) != 1 {
		t.Fatalf("delete should tombstone: %+v", h.trip)
	}
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{"kind": "flight", "title": "again"}, t0+5), models.OpRejected, models.CodeGone)
	mustStatus(t, h.do("dev-a", TypeBookingUpdate, bookingID(1), map[string]any{"title": "x"}, t0+6), models.OpRejected, models.CodeGone)
}

func TestBookingValidationAndCap(t *testing.T) {
	h := newTripH(t)
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{"title": "no kind"}, t0+10), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{"kind": "boat", "title": "x"}, t0+11), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{"kind": "stay", "title": "x", "starts_at": "tomorrow"}, t0+12), models.OpRejected, models.CodeInvalid)
	for i := 0; i < MaxBookings; i++ {
		h.trip.Bookings = append(h.trip.Bookings, models.Booking{BookingID: "tbk_" + padHex(i+100)})
	}
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(2), map[string]any{"kind": "stay", "title": "x"}, t0+13), models.OpRejected, models.CodeCap)
}
