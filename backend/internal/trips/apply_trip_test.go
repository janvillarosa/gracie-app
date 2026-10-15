package trips

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

const t0 = int64(1_700_000_000_000)

var now0 = time.UnixMilli(t0 + 10_000_000)

// harness drives ApplyOp the way the service does: one op per "batch".
type harness struct {
	t     *testing.T
	trip  *models.Trip
	now   time.Time
	seq   map[string]int64
	actor string
	tz    func(lat, lng float64) string
}

func newHarness(t *testing.T) *harness {
	return &harness{t: t, trip: NewShell(testTripID, "room_1", "user_a", now0), now: now0, seq: map[string]int64{}, actor: "user_a"}
}

func todoID(n int) string    { return "ttd_" + strings.Repeat(fmt.Sprintf("%x", n%16), 32) }
func bookingID(n int) string { return "tbk_" + strings.Repeat(fmt.Sprintf("%x", n%16), 32) }

func (h *harness) do(client, typ, entity string, patch any, at int64) models.OpResult {
	h.t.Helper()
	h.seq[client]++
	return h.doSeq(client, h.seq[client], typ, entity, patch, at)
}

func (h *harness) doSeq(client string, seq int64, typ, entity string, patch any, at int64) models.OpResult {
	h.t.Helper()
	var raw json.RawMessage
	if patch != nil {
		b, err := json.Marshal(patch)
		if err != nil {
			h.t.Fatal(err)
		}
		raw = b
	}
	op := models.Op{V: 1, OpID: fmt.Sprintf("op-%s-%d", client, seq), ClientID: client, Seq: seq, At: at,
		Type: typ, TripID: testTripID, EntityID: entity, Patch: raw}
	res, _ := ApplyOp(h.trip, op, Ctx{Actor: h.actor, Now: h.now, NewV: h.trip.Version + 1, TZ: h.tz})
	return res
}

func mustStatus(t *testing.T, res models.OpResult, status, code string) {
	t.Helper()
	if res.Status != status || res.Code != code {
		t.Fatalf("want %s/%s, got %+v", status, code, res)
	}
}

func TestTripCreateThenDuplicateThenSecondCreateRejected(t *testing.T) {
	h := newHarness(t)
	res := h.do("dev-a", TypeTripCreate, "", map[string]any{"title": "Japan", "start_date": "2026-11-01", "end_date": "2026-11-10"}, t0+1)
	mustStatus(t, res, models.OpApplied, "")
	if h.trip.Version != 1 || h.trip.V != 1 || h.trip.Title != "Japan" {
		t.Fatalf("unexpected trip: %+v", h.trip)
	}
	// replay of the very same op (lost response) is a duplicate and changes nothing
	res = h.doSeq("dev-a", 1, TypeTripCreate, "", map[string]any{"title": "Japan"}, t0+1)
	mustStatus(t, res, models.OpDuplicate, "")
	if h.trip.Version != 1 {
		t.Fatalf("duplicate bumped version")
	}
	// a *new* create for an existing trip is rejected without revealing why
	res = h.do("dev-b", TypeTripCreate, "", map[string]any{"title": "Other"}, t0+2)
	mustStatus(t, res, models.OpRejected, models.CodeForbiddenOrUnknown)
}

func TestNonCreateOnUnknownTripIsForbiddenOrUnknown(t *testing.T) {
	h := newHarness(t)
	res := h.do("dev-a", TypeTripUpdate, "", map[string]any{"title": "x"}, t0+1)
	mustStatus(t, res, models.OpRejected, models.CodeForbiddenOrUnknown)
}

func TestStaleFieldIsConflictedOthersStillApply(t *testing.T) {
	h := newHarness(t)
	h.do("dev-a", TypeTripCreate, "", map[string]any{"title": "Japan"}, t0+1000)
	mustStatus(t, h.do("dev-b", TypeTripUpdate, "", map[string]any{"title": "Japan 2026"}, t0+2000), models.OpApplied, "")
	// offline edit made earlier (1500) than B's title change (2000): title skipped, notes applied
	res := h.do("dev-a", TypeTripUpdate, "", map[string]any{"title": "Nippon", "notes": "bring cash"}, t0+1500)
	if res.Status != models.OpConflicted || len(res.SkippedFields) != 1 || res.SkippedFields[0] != "title" {
		t.Fatalf("want conflicted/[title], got %+v", res)
	}
	if h.trip.Title != "Japan 2026" || h.trip.Notes != "bring cash" {
		t.Fatalf("title=%q notes=%q", h.trip.Title, h.trip.Notes)
	}
}

func TestFutureClientClockIsClamped(t *testing.T) {
	h := newHarness(t)
	h.do("dev-a", TypeTripCreate, "", map[string]any{"title": "Japan"}, t0+1)
	farFuture := h.now.UnixMilli() + int64(3*time.Hour/time.Millisecond)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"title": "A"}, farFuture), models.OpApplied, "")
	if h.trip.FieldAt["title"] != h.now.UnixMilli() {
		t.Fatalf("clock not clamped: %d vs %d", h.trip.FieldAt["title"], h.now.UnixMilli())
	}
	// a later honest edit (still <= server now) is not blocked forever by the skewed one
	mustStatus(t, h.do("dev-b", TypeTripUpdate, "", map[string]any{"title": "B"}, h.now.UnixMilli()), models.OpApplied, "")
	if h.trip.Title != "B" {
		t.Fatalf("title=%q", h.trip.Title)
	}
}

func TestPatchCannotTouchProtectedFields(t *testing.T) {
	h := newHarness(t)
	h.do("dev-a", TypeTripCreate, "", map[string]any{"title": "Japan"}, t0+1)
	for _, field := range []string{"room_id", "version", "acked", "todos", "packing_list_id", "tombstones"} {
		res := h.do("dev-a", TypeTripUpdate, "", map[string]any{field: "x"}, t0+2)
		mustStatus(t, res, models.OpRejected, models.CodeUnsupported)
	}
	if h.trip.RoomID != "room_1" || h.trip.Version != 1 {
		t.Fatalf("protected state changed: %+v", h.trip)
	}
}

func TestInvalidValuesAndDateOrder(t *testing.T) {
	h := newHarness(t)
	h.do("dev-a", TypeTripCreate, "", map[string]any{"title": "Japan", "start_date": "2026-11-05"}, t0+1)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"end_date": "2026-11-01"}, t0+2), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"tz": "Not/AZone"}, t0+3), models.OpRejected, models.CodeInvalid)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"title": 7}, t0+4), models.OpRejected, models.CodeInvalid)
}

func TestSoftDeleteBlocksEditsAndRestoreRevives(t *testing.T) {
	h := newHarness(t)
	h.do("dev-a", TypeTripCreate, "", map[string]any{"title": "Japan"}, t0+1)
	mustStatus(t, h.do("dev-b", TypeTripDelete, "", nil, t0+100), models.OpApplied, "")
	if h.trip.DeletedAt == nil || h.trip.DeletedBy != "user_a" || h.trip.PurgeAt == nil {
		t.Fatalf("delete metadata missing: %+v", h.trip)
	}
	if got := h.trip.PurgeAt.Sub(*h.trip.DeletedAt); got != 30*24*time.Hour {
		t.Fatalf("purge window = %v", got)
	}
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"title": "x"}, t0+200), models.OpRejected, models.CodeGone)
	// a stale restore (older than the delete) loses to the delete
	res := h.do("dev-a", TypeTripRestore, "", nil, t0+50)
	if res.Status != models.OpConflicted || h.trip.DeletedAt == nil {
		t.Fatalf("stale restore should be conflicted, got %+v", res)
	}
	mustStatus(t, h.do("dev-a", TypeTripRestore, "", nil, t0+300), models.OpApplied, "")
	if h.trip.DeletedAt != nil || h.trip.PurgeAt != nil {
		t.Fatalf("restore did not clear delete state")
	}
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"title": "back"}, t0+400), models.OpApplied, "")
}

func TestRestoreOfLiveTripIsHarmlessNoop(t *testing.T) {
	h := newHarness(t)
	h.do("dev-a", TypeTripCreate, "", map[string]any{"title": "Japan"}, t0+1)
	v := h.trip.Version
	mustStatus(t, h.do("dev-a", TypeTripRestore, "", nil, t0+2), models.OpApplied, "")
	if h.trip.Version != v {
		t.Fatalf("noop restore bumped version")
	}
}
