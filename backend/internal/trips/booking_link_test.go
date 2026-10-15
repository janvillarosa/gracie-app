package trips

import (
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func linkFixture(t *testing.T) *harness {
	h := newTripH(t)
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{"kind": "flight", "title": "NH 105"}, t0+10), models.OpApplied, "")
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "Check in", "booking_id": bookingID(1)}, t0+11), models.OpApplied, "")
	return h
}

func TestTodoBookingLinkCreateClearAndRelink(t *testing.T) {
	h := linkFixture(t)
	td := h.trip.Todos[0]
	if td.BookingID == nil || *td.BookingID != bookingID(1) || h.trip.FieldAt == nil || td.FieldAt["booking_id"] != t0+11 {
		t.Fatalf("link not stored with clock: %+v", td)
	}
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"booking_id": nil}, t0+20), models.OpApplied, "")
	if h.trip.Todos[0].BookingID != nil {
		t.Fatalf("null should clear")
	}
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"booking_id": bookingID(1)}, t0+30), models.OpApplied, "")
	if h.trip.Todos[0].BookingID == nil {
		t.Fatalf("relink failed")
	}
}

func TestTodoBookingLinkRejectsUnknownMalformedAndTombstoned(t *testing.T) {
	h := linkFixture(t)
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"booking_id": bookingID(2)}, t0+20), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"booking_id": "nope"}, t0+21), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(2), map[string]any{"title": "x", "booking_id": bookingID(2)}, t0+22), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeBookingDelete, bookingID(1), nil, t0+30), models.OpApplied, "")
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"booking_id": bookingID(1)}, t0+31), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(3), map[string]any{"title": "y", "booking_id": bookingID(1)}, t0+32), models.OpRejected, models.CodeInvalid)
}

func TestBookingDeleteClearsLinksAndProducesTodoDelta(t *testing.T) {
	h := linkFixture(t)
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(2), map[string]any{"title": "unlinked"}, t0+12), models.OpApplied, "")
	before := h.trip.Version
	h.actor = "user_b"
	mustStatus(t, h.do("dev-b", TypeBookingDelete, bookingID(1), nil, t0+40), models.OpApplied, "")
	td := h.trip.Todos[0]
	if td.BookingID != nil || td.V != h.trip.Version || td.UpdatedBy != "user_b" {
		t.Fatalf("cascade missed: %+v", td)
	}
	if h.trip.Todos[1].V == h.trip.Version {
		t.Fatalf("unrelated todo must not be bumped")
	}
	d := DeltaSince(h.trip, before, true)
	if len(d.Todos) != 1 || d.Todos[0].TodoID != todoID(1) || d.Todos[0].BookingID != nil || len(d.RemovedIDs) != 1 {
		t.Fatalf("delta: %+v", d)
	}
}

func TestTodoBookingLinkConflictClock(t *testing.T) {
	h := linkFixture(t)
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(2), map[string]any{"kind": "stay", "title": "Hotel"}, t0+12), models.OpApplied, "")
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"booking_id": bookingID(2)}, t0+100), models.OpApplied, "")
	res := h.do("dev-b", TypeTodoUpdate, todoID(1), map[string]any{"booking_id": nil}, t0+50)
	if res.Status != models.OpConflicted || len(res.SkippedFields) != 1 || res.SkippedFields[0] != "booking_id" {
		t.Fatalf("got %+v", res)
	}
	if *h.trip.Todos[0].BookingID != bookingID(2) {
		t.Fatalf("stale write won")
	}
}
