package trips

import (
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func TestDeltaFullForUnknownTrip(t *testing.T) {
	h := newTripH(t)
	h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "Ramen"}, t0+10)
	d := DeltaSince(h.trip, 0, false)
	if !d.Full || d.Trip == nil || len(d.Todos) != 1 || d.Version != h.trip.Version || d.BaseVersion != 0 {
		t.Fatalf("bad full delta: %+v", d)
	}
}

func TestDeltaOnlyIncludesWhatChanged(t *testing.T) {
	h := newTripH(t)
	h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "Ramen"}, t0+10)
	h.do("dev-a", TypeTodoCreate, todoID(2), map[string]any{"title": "Sushi"}, t0+11)
	known := h.trip.Version
	h.do("dev-b", TypeTodoUpdate, todoID(1), map[string]any{"done": true}, t0+20) // one tick
	d := DeltaSince(h.trip, known, true)
	if d.Full || d.Trip != nil || len(d.Todos) != 1 || d.Todos[0].TodoID != todoID(1) || d.BaseVersion != known {
		t.Fatalf("a single tick must produce a one-todo delta, got %+v", d)
	}
	if got := DeltaSince(h.trip, h.trip.Version, true); got.Trip != nil || len(got.Todos) != 0 || len(got.Bookings) != 0 || len(got.RemovedIDs) != 0 {
		t.Fatalf("up-to-date client should get an empty delta: %+v", got)
	}
}

func TestDeltaCarriesTripFieldsAndRemovals(t *testing.T) {
	h := newTripH(t)
	h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "Ramen"}, t0+10)
	known := h.trip.Version
	h.do("dev-b", TypeTripUpdate, "", map[string]any{"title": "Japan 2026"}, t0+20)
	h.do("dev-b", TypeTodoDelete, todoID(1), nil, t0+30)
	d := DeltaSince(h.trip, known, true)
	if d.Trip == nil || d.Trip.Title != "Japan 2026" || len(d.RemovedIDs) != 1 || d.RemovedIDs[0] != todoID(1) {
		t.Fatalf("bad delta: %+v", d)
	}
}

func TestDeltaReportsSoftDelete(t *testing.T) {
	h := newTripH(t)
	known := h.trip.Version
	h.do("dev-b", TypeTripDelete, "", nil, t0+20)
	d := DeltaSince(h.trip, known, true)
	if !d.Deleted || d.DeletedBy != "user_a" {
		t.Fatalf("bad delta: %+v", d)
	}
}

func TestPruneTombstonesForcesFullCopyForStaleClients(t *testing.T) {
	h := newTripH(t)
	h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "Ramen"}, t0+10)
	staleKnown := h.trip.Version
	h.do("dev-a", TypeTodoDelete, todoID(1), nil, t0+20)
	deletedAtV := h.trip.Version
	PruneTombstones(h.trip, h.now.Add(31*24*time.Hour))
	if len(h.trip.Tombstones) != 0 || h.trip.TombFloor != deletedAtV {
		t.Fatalf("prune: tombstones=%d floor=%d", len(h.trip.Tombstones), h.trip.TombFloor)
	}
	if d := DeltaSince(h.trip, staleKnown, true); !d.Full {
		t.Fatalf("client behind the floor must get a full copy: %+v", d)
	}
	if d := DeltaSince(h.trip, deletedAtV, true); d.Full {
		t.Fatalf("client at the floor has seen the deletion, delta is enough: %+v", d)
	}
	// young tombstones are kept
	h.do("dev-a", TypeTodoCreate, todoID(2), map[string]any{"title": "x"}, t0+30)
	h.do("dev-a", TypeTodoDelete, todoID(2), nil, t0+40)
	PruneTombstones(h.trip, h.now)
	if len(h.trip.Tombstones) != 1 {
		t.Fatalf("young tombstone pruned")
	}
	_ = models.Trip{}
}
