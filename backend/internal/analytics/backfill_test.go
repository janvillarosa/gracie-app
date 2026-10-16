package analytics_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
)

const retention = 400 * 24 * time.Hour

type emission struct {
	ev     analytics.Event
	tzHint string
}

// fakeSource emits a fixed list, and can count skips like a real source does.
type fakeSource struct {
	name string
	out  []emission
	skip []string
}

func (f fakeSource) Name() string { return f.name }
func (f fakeSource) Each(_ context.Context, env analytics.BackfillEnv, emit func(analytics.Event, string) error) error {
	for _, r := range f.skip {
		env.Skip(r)
	}
	for _, e := range f.out {
		if err := emit(e.ev, e.tzHint); err != nil {
			return err
		}
	}
	return nil
}

func bfEvent(name, id string, at time.Time) analytics.Event {
	return analytics.Event{
		Name: name, ActorID: "mia", RoomID: "room_1", Key: "milk", Category: "Dairy", OccurredAt: at,
		Subject:   analytics.Ref{Type: analytics.SubjectType(name), ID: id},
		Container: &analytics.Ref{Type: "list", ID: "list_1"},
	}
}

type bfRig struct {
	*rig
	b *analytics.Backfill
}

func newBF(now time.Time, srcs ...analytics.BackfillSource) *bfRig {
	r := &bfRig{rig: newRig(now)}
	r.b = analytics.NewBackfill(r.events, registry(), r.worker, srcs...).
		WithClock(func() time.Time { return r.now }, func(_ context.Context, d time.Duration) error {
			r.now = r.now.Add(d)
			return nil
		})
	return r
}

func env(now, before time.Time) analytics.BackfillEnv {
	return analytics.BackfillEnv{Before: before, Retention: retention, Now: now}
}

func TestBackfillDryRunReportsButWritesNothing(t *testing.T) {
	now := t0.AddDate(0, 3, 0)
	src := fakeSource{name: "items", out: []emission{{ev: bfEvent("item.added", "i1", t0)}}}
	r := newBF(now, src)
	rep, err := r.b.Run(context.Background(), env(now, now), analytics.BackfillOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Emitted != 1 || rep.ByName["item.added"] != 1 || rep.BySource["items"] != 1 || rep.Applied || rep.Inserted != 0 {
		t.Fatalf("report: %+v", rep)
	}
	if n := len(r.events.All()); n != 0 {
		t.Fatalf("dry run wrote %d events", n)
	}
}

func TestBackfillApplyIsIdempotent(t *testing.T) {
	now := t0.AddDate(0, 3, 0)
	src := fakeSource{name: "items", out: []emission{
		{ev: bfEvent("item.added", "i1", t0)},
		{ev: bfEvent("item.checked", "i1", t0.Add(time.Hour))},
	}}
	r := newBF(now, src)
	first, err := r.b.Run(context.Background(), env(now, now), analytics.BackfillOptions{Apply: true})
	if err != nil || first.Inserted != 2 {
		t.Fatalf("first: %+v %v", first, err)
	}
	second, err := r.b.Run(context.Background(), env(now, now), analytics.BackfillOptions{Apply: true})
	if err != nil || second.Inserted != 0 || second.Emitted != 2 {
		t.Fatalf("re-run must insert nothing: %+v %v", second, err)
	}
	got := r.events.All()
	if len(got) != 2 {
		t.Fatalf("stored %d", len(got))
	}
	e := got[0]
	if e.EventID != "bf1:item.added:i1" || e.Source != analytics.SourceBackfill || !e.IngestedAt.Equal(now.Truncate(time.Millisecond)) {
		t.Fatalf("event envelope: %+v", e)
	}
	if !e.ExpireAt.Equal(t0.Add(retention)) || e.Local.TZ != "UTC" {
		t.Fatalf("expiry/local: %+v", e)
	}
}

func TestBackfillCutoffAndRetentionBoundaries(t *testing.T) {
	now := time.Date(2027, 12, 1, 12, 0, 0, 0, time.UTC)
	cutoff := time.Date(2027, 11, 1, 0, 0, 0, 0, time.UTC)
	oldest := now.Add(-(retention - 24*time.Hour))
	src := fakeSource{name: "items", out: []emission{
		{ev: bfEvent("item.added", "just_before", cutoff.Add(-time.Nanosecond))},
		{ev: bfEvent("item.added", "at_cutoff", cutoff)},
		{ev: bfEvent("item.added", "after", cutoff.Add(time.Hour))},
		{ev: bfEvent("item.added", "oldest_ok", oldest)},
		{ev: bfEvent("item.added", "too_old", oldest.Add(-time.Nanosecond))},
	}}
	r := newBF(now, src)
	rep, err := r.b.Run(context.Background(), env(now, cutoff), analytics.BackfillOptions{Apply: true})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Inserted != 2 || rep.Skipped[analytics.SkipAfterCutoff] != 2 || rep.Skipped[analytics.SkipRetention] != 1 {
		t.Fatalf("report: %+v", rep)
	}
	ids := map[string]bool{}
	for _, e := range r.events.All() {
		ids[e.Subject.ID] = true
	}
	if !ids["just_before"] || !ids["oldest_ok"] || len(ids) != 2 {
		t.Fatalf("kept %v", ids)
	}
}

func TestBackfillSourceSkipsAreCounted(t *testing.T) {
	now := t0.AddDate(0, 1, 0)
	r := newBF(now, fakeSource{name: "items", skip: []string{analytics.SkipLiveMarker, analytics.SkipLiveMarker, analytics.SkipEmptyKey}})
	rep, err := r.b.Run(context.Background(), env(now, now), analytics.BackfillOptions{})
	if err != nil || rep.Skipped[analytics.SkipLiveMarker] != 2 || rep.Skipped[analytics.SkipEmptyKey] != 1 {
		t.Fatalf("%+v %v", rep, err)
	}
}

func TestBackfillCutoffDefaultsToFirstLiveServerEvent(t *testing.T) {
	now := t0.AddDate(0, 1, 0)
	src := fakeSource{name: "items", out: []emission{
		{ev: bfEvent("item.added", "old", t0.Add(-48*time.Hour))},
		{ev: bfEvent("item.added", "live_era", t0.Add(48*time.Hour))},
	}}
	r := newBF(now, src)

	_, err := r.b.Run(context.Background(), env(now, time.Time{}), analytics.BackfillOptions{Apply: true})
	if !errors.Is(err, analytics.ErrNoCutoff) {
		t.Fatalf("want ErrNoCutoff with no live events, got %v", err)
	}

	r.add(ev("item.added", "mia", "room_1", "eggs", t0)) // the first live event
	rep, err := r.b.Run(context.Background(), env(now, time.Time{}), analytics.BackfillOptions{Apply: true})
	if err != nil || !rep.Cutoff.Equal(t0) || rep.Inserted != 1 || rep.Skipped[analytics.SkipAfterCutoff] != 1 {
		t.Fatalf("%+v %v", rep, err)
	}
}

func TestBackfillRejectsUnregisteredNamesAndZeroRetention(t *testing.T) {
	now := t0.AddDate(0, 1, 0)
	r := newBF(now, fakeSource{name: "x", out: []emission{{ev: bfEvent("widget.spun", "w1", t0)}}})
	if _, err := r.b.Run(context.Background(), env(now, now), analytics.BackfillOptions{}); err == nil {
		t.Fatal("an unregistered event name must fail the run")
	}
	bad := env(now, now)
	bad.Retention = 0
	if _, err := r.b.Run(context.Background(), bad, analytics.BackfillOptions{}); err == nil {
		t.Fatal("zero retention would stamp events as already expired")
	}
}

func TestBackfillTimezoneHintBeatsResolverAndFallbackIsCounted(t *testing.T) {
	now := t0.AddDate(0, 1, 0)
	at := time.Date(2026, 10, 3, 3, 0, 0, 0, time.UTC) // Friday 23:00 in New York
	src := fakeSource{name: "mixed", out: []emission{
		{ev: bfEvent("item.added", "hinted", at), tzHint: "Australia/Sydney"},
		{ev: bfEvent("item.added", "resolved", at)},
	}}
	r := newBF(now, src)
	e := env(now, now)
	e.TZ = func(context.Context, string, string) string { return "America/New_York" }
	rep, err := r.b.Run(context.Background(), e, analytics.BackfillOptions{Apply: true})
	if err != nil || rep.UTCFallback != 0 {
		t.Fatalf("%+v %v", rep, err)
	}
	// With no resolver and no hint, the zone is UTC and the fallback is counted (below).
	zones := map[string]string{}
	for _, s := range r.events.All() {
		zones[s.Subject.ID] = s.Local.TZ
	}
	if zones["hinted"] != "Australia/Sydney" || zones["resolved"] != "America/New_York" {
		t.Fatalf("zones: %v", zones)
	}

	r2 := newBF(now, fakeSource{name: "u", out: []emission{{ev: bfEvent("item.added", "a", at)}, {ev: bfEvent("item.added", "b", at)}}})
	rep2, err := r2.b.Run(context.Background(), env(now, now), analytics.BackfillOptions{Apply: true})
	if err != nil || rep2.UTCFallback != 2 {
		t.Fatalf("utc fallback not counted: %+v %v", rep2, err)
	}
}

func TestBackfillFoldsThroughTheNormalPipelineExactlyOnce(t *testing.T) {
	now := time.Date(2026, 12, 1, 9, 0, 0, 0, time.UTC)
	var out []emission
	for w := 0; w < 4; w++ {
		at := t0.AddDate(0, 0, 7*w)
		out = append(out,
			emission{ev: bfEvent("item.added", "a"+at.Format("0102"), at.Add(-time.Hour))},
			emission{ev: bfEvent("item.checked", "c"+at.Format("0102"), at)},
		)
	}
	r := newBF(now, fakeSource{name: "items", out: out})
	e := env(now, now)
	e.TZ = func(context.Context, string, string) string { return "UTC" }

	rep, err := r.b.Run(context.Background(), e, analytics.BackfillOptions{Apply: true, Fold: true})
	if err != nil || rep.Inserted != 8 || rep.Folded != 8 {
		t.Fatalf("%+v %v", rep, err)
	}
	if got := num(r.aggs.Period("h:room_1:2026-10-05"), "counts.item.checked"); got != 1 {
		t.Fatalf("day count %d", got)
	}
	if got := num(r.aggs.Period("h:room_1:2026-10"), "counts.item.checked"); got != 4 {
		t.Fatalf("month count %d, want the four weekly checks (Oct 5, 12, 19, 26)", got)
	}
	if rep.Profiles == 0 {
		t.Fatal("profiles were not recomputed")
	}

	// A second run adds nothing and folds nothing, so counts cannot double.
	again, err := r.b.Run(context.Background(), e, analytics.BackfillOptions{Apply: true, Fold: true})
	if err != nil || again.Inserted != 0 || again.Folded != 0 {
		t.Fatalf("%+v %v", again, err)
	}
	if got := num(r.aggs.Period("h:room_1:2026"), "counts.item.checked"); got != 4 {
		t.Fatalf("year count %d after re-run", got)
	}
}
