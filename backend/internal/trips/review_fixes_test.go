package trips

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func TestUnknownNestedPlaceFieldIsUnsupported(t *testing.T) {
	h := newTripH(t)
	pl := map[string]any{"name": "x", "lat": 1.0, "lng": 2.0, "source": "manual", "from_the_future": 1}
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"destination": pl}, t0+10), models.OpRejected, models.CodeUnsupported)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"stops": []any{pl}}, t0+11), models.OpRejected, models.CodeUnsupported)
}

func TestTitleOnlyTodoEditKeepsStoredTZ(t *testing.T) {
	h := newTripH(t)
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"tz": "Asia/Tokyo"}, t0+10), models.OpApplied, "")
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "x"}, t0+11), models.OpApplied, "")
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"tz": "Europe/Lisbon"}, t0+12), models.OpApplied, "")
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"title": "y"}, t0+13), models.OpApplied, "")
	if h.trip.Todos[0].TZ != "Asia/Tokyo" {
		t.Fatalf("tz shifted by a title edit: %q", h.trip.Todos[0].TZ)
	}
	pl := map[string]any{"name": "p", "lat": 1.0, "lng": 2.0, "source": "manual"}
	mustStatus(t, h.do("dev-a", TypeTodoUpdate, todoID(1), map[string]any{"place": pl}, t0+14), models.OpApplied, "")
	if h.trip.Todos[0].TZ != "Europe/Lisbon" {
		t.Fatalf("tz should re-resolve when place changes: %q", h.trip.Todos[0].TZ)
	}
}

func TestDaysCapCountsRemovalsInSamePatch(t *testing.T) {
	h := newTripH(t)
	h.trip.Days = map[string]string{}
	for i := 0; i < MaxDays; i++ {
		h.trip.Days[fmt.Sprintf("2027-%02d-%02d", 1+i/28, 1+i%28)] = "d"
	}
	patch := map[string]any{"days": map[string]string{"2027-01-01": "", "2026-10-24": "new"}}
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", patch, t0+100), models.OpApplied, "")
	if len(h.trip.Days) != MaxDays {
		t.Fatalf("days=%d", len(h.trip.Days))
	}
}

func TestDaysPatchKeyCountIsBounded(t *testing.T) {
	h := newTripH(t)
	days := map[string]string{}
	for i := 0; i <= MaxDays; i++ {
		days[time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, i).Format("2006-01-02")] = ""
	}
	mustStatus(t, h.do("dev-a", TypeTripUpdate, "", map[string]any{"days": days}, t0+100), models.OpRejected, models.CodeInvalid)
}

func TestTombstoneCheckedBeforeCap(t *testing.T) {
	h := newTripH(t)
	h.trip.Tombstones = []models.Tombstone{{ID: todoID(1), V: 1, At: now0}, {ID: bookingID(1), V: 1, At: now0}}
	for i := 0; i < MaxTodos; i++ {
		h.trip.Todos = append(h.trip.Todos, models.TripTodo{TodoID: "ttd_" + padHex(i+100)})
	}
	for i := 0; i < MaxBookings; i++ {
		h.trip.Bookings = append(h.trip.Bookings, models.Booking{BookingID: "tbk_" + padHex(i+100)})
	}
	mustStatus(t, h.do("dev-a", TypeTodoCreate, todoID(1), map[string]any{"title": "x"}, t0+10), models.OpRejected, models.CodeGone)
	mustStatus(t, h.do("dev-a", TypeBookingCreate, bookingID(1), map[string]any{"kind": "stay", "title": "x"}, t0+11), models.OpRejected, models.CodeGone)
}

func TestAckedPrunedAfterIdleAndCappedPerTrip(t *testing.T) {
	h := newTripH(t)
	h.do("dev-old", TypeTripUpdate, "", map[string]any{"notes": "a"}, t0+10)
	h.do("dev-new", TypeTripUpdate, "", map[string]any{"notes": "b"}, t0+11)
	h.trip.AckedAt["dev-old"] = h.now.Add(-31 * 24 * time.Hour).UnixMilli()
	Prune(h.trip, h.now)
	if _, ok := h.trip.Acked["dev-old"]; ok {
		t.Fatalf("idle client not pruned")
	}
	if _, ok := h.trip.AckedAt["dev-old"]; ok {
		t.Fatalf("idle client timestamp not pruned")
	}
	if h.trip.Acked["dev-new"] == 0 {
		t.Fatalf("active client pruned")
	}
	// legacy entries without a timestamp are stamped, not dropped
	h.trip.Acked["legacy"] = 5
	Prune(h.trip, h.now)
	if h.trip.Acked["legacy"] != 5 || h.trip.AckedAt["legacy"] == 0 {
		t.Fatalf("legacy entry mishandled")
	}
	for i := len(h.trip.Acked); i < MaxAckedClients; i++ {
		h.trip.Acked[fmt.Sprintf("fill-%d", i)] = 1
	}
	res := h.do("dev-extra", TypeTripUpdate, "", map[string]any{"notes": "c"}, t0+50)
	mustStatus(t, res, models.OpRejected, models.CodeCap)
	if _, ok := h.trip.Acked["dev-extra"]; ok {
		t.Fatalf("rejected-for-cap client must not be recorded")
	}
}

func TestDayClocksPrunedOnlyWhenUnlabelledAndOld(t *testing.T) {
	h := newTripH(t)
	old := h.now.Add(-31 * 24 * time.Hour).UnixMilli()
	h.trip.Days = map[string]string{"2026-10-24": "kept"}
	h.trip.FieldAt["days.2026-10-24"] = old // labelled: keep
	h.trip.FieldAt["days.2026-10-25"] = old // removed + old: drop
	h.trip.FieldAt["days.2026-10-26"] = h.now.UnixMilli()
	Prune(h.trip, h.now)
	if _, ok := h.trip.FieldAt["days.2026-10-25"]; ok {
		t.Fatalf("old unlabelled clock kept")
	}
	if _, ok := h.trip.FieldAt["days.2026-10-24"]; !ok {
		t.Fatalf("labelled clock dropped")
	}
	if _, ok := h.trip.FieldAt["days.2026-10-26"]; !ok {
		t.Fatalf("recent clock dropped")
	}
}

// Hostile client: many devices and many day patches must not grow the document without bound.
func TestDocumentSizeBoundUnderAbuse(t *testing.T) {
	h := newTripH(t)
	base := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 600; i++ {
		days := map[string]string{}
		for j := 0; j < 10; j++ {
			d := base.AddDate(0, 0, (i*10+j)%3000).Format("2006-01-02")
			if (i+j)%2 == 0 {
				days[d] = "x"
			} else {
				days[d] = ""
			}
		}
		h.do(fmt.Sprintf("dev-%d", i), TypeTripUpdate, "", map[string]any{"days": days}, t0+int64(i)+10)
		Prune(h.trip, h.now)
	}
	clocks := 0
	for k := range h.trip.FieldAt {
		if len(k) > 5 && k[:5] == "days." {
			clocks++
		}
	}
	if clocks > MaxDayClocks || len(h.trip.Days) > MaxDays || len(h.trip.Acked) > MaxAckedClients {
		t.Fatalf("unbounded: clocks=%d days=%d acked=%d", clocks, len(h.trip.Days), len(h.trip.Acked))
	}
	b1, _ := json.Marshal(h.trip)
	b2, _ := json.Marshal(h.trip.FieldAt)
	b3, _ := json.Marshal(h.trip.Acked)
	b4, _ := json.Marshal(h.trip.AckedAt)
	if total := len(b1) + len(b2) + len(b3) + len(b4); total > 64<<10 {
		t.Fatalf("trip metadata grew to %d bytes", total)
	}
}
