package trips

import (
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func newTripH(t *testing.T) *harness {
	h := newHarness(t)
	mustStatus(t, h.do("dev-a", TypeTripCreate, "", map[string]any{"title": "Japan", "tz": "Asia/Tokyo"}, t0+1), models.OpApplied, "")
	return h
}

func TestTodoCreateUpdateDeleteLifecycle(t *testing.T) {
	h := newTripH(t)
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{
		"title": "Fushimi Inari", "day": "2026-11-02", "start_time": "07:30", "category": "sight",
		"place": map[string]any{"name": "Fushimi Inari", "lat": 34.967, "lng": 135.772, "tz": "Asia/Tokyo", "source": "manual"},
	}, t0+10), models.OpApplied, "")
	td := h.trip.Todos[0]
	if td.TZ != "Asia/Tokyo" || td.Order != 1000 || td.V != h.trip.Version || td.Category != "sight" {
		t.Fatalf("unexpected todo: %+v", td)
	}
	mustStatus(t, h.do("dev-b", TypeTodoUpdate, todoID(1), map[string]any{"done": true}, t0+20), models.OpApplied, "")
	if !h.trip.Todos[0].Done || h.trip.Todos[0].DoneBy != "user_a" || h.trip.Todos[0].DoneAt == nil {
		t.Fatalf("done metadata missing: %+v", h.trip.Todos[0])
	}
	mustStatus(t, h.do("dev-b", TypeTodoUpdate, todoID(1), map[string]any{"done": false, "day": nil}, t0+30), models.OpApplied, "")
	if h.trip.Todos[0].Done || h.trip.Todos[0].DoneBy != "" || h.trip.Todos[0].Day != nil {
		t.Fatalf("undo/ideas move failed: %+v", h.trip.Todos[0])
	}
	mustStatus(t, h.do("dev-a", TypeTodoDelete, todoID(1), nil, t0+40), models.OpApplied, "")
	if len(h.trip.Todos) != 0 || len(h.trip.Tombstones) != 1 || h.trip.Tombstones[0].ID != todoID(1) {
		t.Fatalf("delete should tombstone: %+v", h.trip)
	}
}

func TestTodoEditAfterDeleteIsGoneAndCreateDoesNotRevive(t *testing.T) {
	h := newTripH(t)
	h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "Ramen"}, t0+10)
	h.do("dev-b", TypeTodoDelete, todoID(1), nil, t0+20)
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"title": "Ramen!"}, t0+15), models.OpRejected, models.CodeGone)
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "Ramen"}, t0+12), models.OpRejected, models.CodeGone)
	if len(h.trip.Todos) != 0 {
		t.Fatalf("tombstoned todo was revived")
	}
	// deleting again is an idempotent no-op
	v := h.trip.Version
	mustStatus(t, h.do("dev-a", TypeTodoDelete, todoID(1), nil, t0+30), models.OpApplied, "")
	if h.trip.Version != v || len(h.trip.Tombstones) != 1 {
		t.Fatalf("repeat delete changed state")
	}
}

func TestTodoCap(t *testing.T) {
	h := newTripH(t)
	for i := 0; i < MaxTodos; i++ {
		h.trip.Todos = append(h.trip.Todos, models.TripTodo{TodoID: "ttd_" + padHex(i+100)})
	}
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "one too many"}, t0+10), models.OpRejected, models.CodeCap)
}

func TestTodoValidation(t *testing.T) {
	h := newTripH(t)
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{}, t0+10), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "x", "category": "nope"}, t0+11), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "x", "bogus": 1}, t0+12), models.OpRejected, models.CodeUnsupported)
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(2), map[string]any{"title": "x"}, t0+13), models.OpRejected, models.CodeGone)
}

func TestEqualOrdersAreRenumberedDistinctAndStable(t *testing.T) {
	h := newTripH(t)
	// two devices insert at exactly the same spot (explicit equal order) on the same day
	h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "A", "day": "2026-11-02", "order": 500.0}, t0+10)
	h.do("dev-b", TypeTodoCreate, todoID(2), map[string]any{"title": "B", "day": "2026-11-02", "order": 500.0}, t0+11)
	o1, o2 := h.trip.Todos[0].Order, h.trip.Todos[1].Order
	if o1 == o2 {
		t.Fatalf("orders still equal: %v %v", o1, o2)
	}
	// tie-break is by todo_id, so ttd_1... sorts before ttd_2...
	if !(o1 < o2) {
		t.Fatalf("expected todo 1 before todo 2, got %v %v", o1, o2)
	}
	if h.trip.Todos[0].V != h.trip.Version || h.trip.Todos[1].V != h.trip.Version {
		t.Fatalf("renumbered todos must carry the new version so deltas include them")
	}
}

func TestCrampedGapIsRenumbered(t *testing.T) {
	h := newTripH(t)
	h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "A", "order": 1000.0}, t0+10)
	h.do("dev-a", TypeTodoCreate, todoID(2), map[string]any{"title": "B", "order": 2000.0}, t0+11)
	h.do("dev-a", TypeTodoCreate, todoID(3), map[string]any{"title": "C", "order": 1000.00000001}, t0+12)
	for i := 1; i < len(h.trip.Todos); i++ {
		if h.trip.Todos[i].Order == h.trip.Todos[i-1].Order {
			t.Fatalf("duplicate orders after renumber")
		}
	}
	// A (1000) and C (1000.00000001) keep their relative order: A < C < B
	byID := map[string]float64{}
	for _, td := range h.trip.Todos {
		byID[td.TodoID] = td.Order
	}
	if !(byID[todoID(1)] < byID[todoID(3)] && byID[todoID(3)] < byID[todoID(2)]) {
		t.Fatalf("relative order lost: %v", byID)
	}
}

func TestReplayAfterManyOtherOpsDoesNotDoubleApply(t *testing.T) {
	h := newTripH(t)
	h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "Ramen"}, t0+10)
	// dev-a sends seq N, response is lost
	h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"title": "Ramen v2"}, t0+20)
	lostSeq := h.seq["dev-a"]
	// meanwhile another device does far more than 1000 ops, including deleting and recreating
	for i := 0; i < 1500; i++ {
		h.do("dev-b", TypeTodoUpdate, todoID(1), map[string]any{"title": "b"}, t0+100+int64(i))
	}
	before := h.trip.Todos[0]
	v := h.trip.Version
	res := h.doSeq("dev-a", lostSeq, TypeTodoUpdate, todoID(1), map[string]any{"title": "Ramen v2"}, t0+20)
	mustStatus(t, res, models.OpDuplicate, "")
	if h.trip.Version != v || h.trip.Todos[0].Title != before.Title {
		t.Fatalf("replay changed state")
	}
}

func padHex(n int) string {
	const digits = "0123456789abcdef"
	b := make([]byte, 32)
	for i := range b {
		b[i] = digits[(n+i)%16]
	}
	return string(b)
}
