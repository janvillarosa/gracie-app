package trips

import (
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func TestUpdatedAtStampedOnCreateUpdateAndCascade(t *testing.T) {
	h := newTripH(t)
	t1 := h.now
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{"kind": "flight", "title": "NH"}, t0+10), models.OpApplied, "")
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "x", "booking_id": bookingID(1)}, t0+11), models.OpApplied, "")
	if at := h.trip.Todos[0].UpdatedAt; at == nil || !at.Equal(t1) || at.Location() != time.UTC {
		t.Fatalf("todo create stamp: %v", at)
	}
	if at := h.trip.Bookings[0].UpdatedAt; at == nil || !at.Equal(t1) {
		t.Fatalf("booking create stamp: %v", at)
	}

	h.now = t1.Add(time.Hour)
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"title": "y"}, t0+20), models.OpApplied, "")
	mustStatus(t, h.do("dev-a", TypeBookingUpdate, bookingID(1), map[string]any{"title": "NH2"}, t0+21), models.OpApplied, "")
	if !h.trip.Todos[0].UpdatedAt.Equal(h.now) || !h.trip.Bookings[0].UpdatedAt.Equal(h.now) {
		t.Fatalf("update did not restamp")
	}

	h.now = t1.Add(2 * time.Hour)
	mustStatus(t, h.do("dev-a", TypeBookingDelete, bookingID(1), nil, t0+30), models.OpApplied, "")
	if !h.trip.Todos[0].UpdatedAt.Equal(h.now) {
		t.Fatalf("cascade did not restamp the todo: %v", h.trip.Todos[0].UpdatedAt)
	}
	d := DeltaSince(h.trip, h.trip.Version-1, true)
	if len(d.Todos) != 1 || d.Todos[0].UpdatedAt == nil {
		t.Fatalf("delta lacks updated_at: %+v", d.Todos)
	}
}

func TestUpdatedAtUnchangedByDuplicateAndFullyConflictedOps(t *testing.T) {
	h := newTripH(t)
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "x"}, t0+100), models.OpApplied, "")
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{"kind": "stay", "title": "h"}, t0+100), models.OpApplied, "")
	stamp0 := *h.trip.Todos[0].UpdatedAt
	bstamp0 := *h.trip.Bookings[0].UpdatedAt

	h.now = h.now.Add(time.Hour)
	h.actor = "user_b"
	// stale (older clock) edit: every field skipped
	res := h.do("dev-b", TypeTodoUpdate, todoID(1), map[string]any{"title": "stale"}, t0+5)
	if res.Status != models.OpConflicted {
		t.Fatalf("got %+v", res)
	}
	res = h.do("dev-b", TypeBookingUpdate, bookingID(1), map[string]any{"title": "stale"}, t0+5)
	if res.Status != models.OpConflicted {
		t.Fatalf("got %+v", res)
	}
	// replay of an already-acked seq
	mustStatus(t, h.doSeq("dev-b", 1, TypeTodoUpdate, todoID(1), map[string]any{"title": "stale"}, t0+5), models.OpDuplicate, "")
	td, bk := h.trip.Todos[0], h.trip.Bookings[0]
	if !td.UpdatedAt.Equal(stamp0) || td.UpdatedBy != "user_a" || !bk.UpdatedAt.Equal(bstamp0) || bk.UpdatedBy != "user_a" {
		t.Fatalf("no-op ops changed attribution: %+v %+v", td, bk)
	}
}
