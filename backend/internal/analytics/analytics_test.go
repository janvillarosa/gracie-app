package analytics

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestLocalAtBucketsInZone(t *testing.T) {
	// 2026-10-17 03:30 UTC is Friday 23:30 in New York (EDT, UTC-4).
	lt := LocalAt(time.Date(2026, 10, 17, 3, 30, 0, 0, time.UTC), "America/New_York")
	if lt.Date != "2026-10-16" || lt.DOW != 5 || lt.Hour != 23 || lt.HOW != 5*24+23 {
		t.Fatalf("got %+v", lt)
	}
}

func TestLocalAtDST(t *testing.T) {
	// US fall-back 2026-11-01: 06:30 UTC is 01:30 EST (after the shift), 05:30 UTC is 01:30 EDT.
	a := LocalAt(time.Date(2026, 11, 1, 5, 30, 0, 0, time.UTC), "America/New_York")
	b := LocalAt(time.Date(2026, 11, 1, 6, 30, 0, 0, time.UTC), "America/New_York")
	if a.Hour != 1 || b.Hour != 1 || a.Date != "2026-11-01" || b.Date != "2026-11-01" {
		t.Fatalf("a=%+v b=%+v", a, b)
	}
}

func TestLocalAtBadZoneFallsBackToUTC(t *testing.T) {
	if lt := LocalAt(time.Date(2026, 1, 1, 9, 0, 0, 0, time.UTC), "Not/AZone"); lt.TZ != "UTC" || lt.Hour != 9 {
		t.Fatalf("got %+v", lt)
	}
}

func TestRegistry(t *testing.T) {
	r := NewRegistry()
	if err := r.Register(EventDef{Name: "nodot"}); err == nil {
		t.Fatal("want error for name without subject.verb")
	}
	r.MustRegister(EventDef{Name: "item.added", Role: RoleRequest, Props: map[string]PropSpec{
		"via":   {Kind: PropEnum, Values: []string{"typed", "suggestion"}},
		"count": {Kind: PropInt},
	}})
	if err := r.Register(EventDef{Name: "item.added"}); err == nil {
		t.Fatal("want duplicate error")
	}
	r.Alias("item.created", "item.added")
	d, ok := r.Resolve("item.created")
	if !ok || d.Name != "item.added" {
		t.Fatalf("alias not resolved: %+v %v", d, ok)
	}
	got := d.Sanitize(map[string]any{"via": "suggestion", "count": float64(3), "evil": "x", "bad": 1})
	if len(got) != 2 || got["via"] != "suggestion" || got["count"] != int64(3) {
		t.Fatalf("sanitize: %v", got)
	}
	if d.Sanitize(map[string]any{"via": "other"}) != nil {
		t.Fatal("invalid enum must be dropped")
	}
	if SubjectType("recipe.cooked") != "recipe" {
		t.Fatal("subject type")
	}
}

type fakeRepo struct {
	mu   sync.Mutex
	got  []Event
	seen map[string]bool
}

func (f *fakeRepo) InsertMany(_ context.Context, evs []Event) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.seen == nil {
		f.seen = map[string]bool{}
	}
	for _, e := range evs {
		if !f.seen[e.EventID] {
			f.seen[e.EventID] = true
			f.got = append(f.got, e)
		}
	}
	return nil
}
func (f *fakeRepo) ListIngestedBetween(context.Context, time.Time, time.Time, int) ([]Event, error) {
	return nil, nil
}
func (f *fakeRepo) DeleteByActor(context.Context, string) error { return nil }
func (f *fakeRepo) DeleteByRoom(context.Context, string) error  { return nil }

func TestBufferedRecorderDrainsOnClose(t *testing.T) {
	reg := NewRegistry()
	reg.MustRegister(EventDef{Name: "item.added"})
	repo := &fakeRepo{}
	rec := NewBufferedRecorder(repo, reg, 16, time.Hour)
	ctx := WithTZ(context.Background(), "America/New_York")
	rec.Record(ctx, Event{Name: "item.added", ActorID: "u1", RoomID: "r1", Subject: Ref{"item", "i1"}})
	rec.Record(ctx, Event{Name: "unknown.thing", ActorID: "u1"}) // unregistered: dropped
	if err := rec.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(repo.got) != 1 {
		t.Fatalf("want 1 event, got %d", len(repo.got))
	}
	e := repo.got[0]
	if e.EventID == "" || e.V != EnvelopeVersion || e.Local.TZ != "America/New_York" || e.ExpireAt.Before(e.OccurredAt) {
		t.Fatalf("not stamped: %+v", e)
	}
}

func TestBufferedRecorderNeverBlocksWhenFull(t *testing.T) {
	reg := NewRegistry()
	reg.MustRegister(EventDef{Name: "item.added"})
	block := make(chan struct{})
	rec := NewBufferedRecorder(blockingRepo{block}, reg, 2, time.Hour)
	done := make(chan struct{})
	go func() {
		for i := 0; i < 1000; i++ {
			rec.Record(context.Background(), Event{Name: "item.added", Subject: Ref{"item", "i"}})
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Record blocked on a full buffer")
	}
	if rec.Dropped() == 0 {
		t.Fatal("expected drops")
	}
	close(block)
	_ = rec.Close(context.Background())
}

type blockingRepo struct{ block chan struct{} }

func (b blockingRepo) InsertMany(context.Context, []Event) error { <-b.block; return nil }
func (blockingRepo) ListIngestedBetween(context.Context, time.Time, time.Time, int) ([]Event, error) {
	return nil, nil
}
func (blockingRepo) DeleteByActor(context.Context, string) error { return nil }
func (blockingRepo) DeleteByRoom(context.Context, string) error  { return nil }
