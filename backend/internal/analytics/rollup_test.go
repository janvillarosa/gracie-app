package analytics_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

var t0 = time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC) // a Monday, 09:00 UTC

func registry() *analytics.Registry {
	reg := analytics.NewRegistry()
	services.RegisterAnalyticsEvents(reg)
	return reg
}

// ev builds a stored event: it happened at `at` and was ingested a minute later.
func ev(name, actor, room, key string, at time.Time) analytics.Event {
	e := analytics.Event{
		Name: name, Source: analytics.SourceServer, ActorID: actor, RoomID: room, Key: key, OccurredAt: at,
		Subject:   analytics.Ref{Type: analytics.SubjectType(name), ID: "i_" + key},
		Container: &analytics.Ref{Type: "list", ID: "list_1"}, Category: "Dairy",
	}
	analytics.Stamp(&e, at.Add(time.Minute), "UTC", 400*24*time.Hour)
	e.EventID = name + "_" + actor + "_" + at.Format(time.RFC3339)
	return e
}

type rig struct {
	events *memstore.EventRepo
	aggs   *memstore.AggRepo
	worker *analytics.Worker
	now    time.Time
}

func newRig(now time.Time) *rig {
	r := &rig{events: memstore.NewEventRepo(), aggs: memstore.NewAggRepo(), now: now}
	r.worker = analytics.NewWorker(r.events, r.aggs, registry())
	r.worker = r.worker.WithClock(func() time.Time { return r.now })
	return r
}

func (r *rig) add(evs ...analytics.Event) { _ = r.events.InsertMany(context.Background(), evs) }

func num(doc map[string]any, path string) int64 {
	n, _ := analytics.GetPath(doc, path).(int64)
	return n
}

func TestFoldCountsPerPeriodScopeAndMember(t *testing.T) {
	batch := analytics.Fold(registry(), []analytics.Event{
		ev("item.added", "mia", "room_1", "milk", t0),
		ev("item.checked", "mia", "room_1", "milk", t0.Add(time.Hour)),
		ev("item.checked", "sam", "room_1", "milk", t0.Add(2*time.Hour)),
		ev("item.reordered", "sam", "room_1", "milk", t0), // Skip: stored, never counted
	})
	day := batch.Periods["h:room_1:2026-10-05"]
	if num2(day, "counts.item.added") != 1 || num2(day, "counts.item.checked") != 2 {
		t.Fatalf("house day counts: %+v", day.Inc)
	}
	if day.Inc["counts.item.reordered"] != 0 {
		t.Fatal("skipped events must not be counted")
	}
	// The same events roll up into the month and the year, per user and per house.
	for _, id := range []string{"h:room_1:2026-10", "h:room_1:2026", "u:mia:2026-10-05", "u:sam:2026"} {
		if batch.Periods[id] == nil {
			t.Fatalf("missing %s", id)
		}
	}
	if got := batch.Periods["u:sam:2026-10-05"].Inc["counts.item.checked"]; got != 1 {
		t.Fatalf("sam checked %d", got)
	}
	if got := day.Inc["members.mia.item.checked"]; got != 1 {
		t.Fatalf("per-member total: %d", got)
	}
	if day.Inc["containers.list:list_1.item.checked"] != 2 || day.Inc["by_category.item.Dairy"] != 3 || day.Inc["key_counts.item.milk"] != 3 {
		t.Fatalf("containers/category/keys: %+v", day.Inc)
	}
	if _, ok := batch.Periods["h:room_1:2026-10"].Set["days.2026-10-05"]; !ok {
		t.Fatal("month doc should mark the active day")
	}
	if _, ok := batch.Periods["h:room_1:2026"].Set["months.2026-10"]; !ok {
		t.Fatal("year doc should mark the active month")
	}
	k := batch.Keys["room_1:item:milk"]
	if k.Inc["counts.checked"] != 2 || k.Inc["by_actor.sam.checked"] != 1 || !k.Min["first_at"].Equal(t0) || !k.Max["last_at.checked"].Equal(t0.Add(2*time.Hour)) {
		t.Fatalf("key stats: %+v", k)
	}
	for _, s := range []string{"u:mia", "u:sam", "h:room_1"} {
		if _, ok := batch.Dirty[s]; !ok {
			t.Fatalf("%s not marked dirty", s)
		}
	}
}

func num2(u *analytics.DocUpdate, p string) int64 { return u.Inc[p] }

func TestFoldTargetsAndSystemActors(t *testing.T) {
	e := ev("item.checked", "system:job", "room_1", "milk", t0)
	e.Targets = []string{"sam", "system:x"}
	b := analytics.Fold(registry(), []analytics.Event{e})
	if b.Periods["u:system:job:2026-10-05"] != nil {
		t.Fatal("system actors get no personal stats")
	}
	if b.Periods["u:sam:2026-10-05"].Inc["targeted.item.checked"] != 1 {
		t.Fatal("targeted user should be counted")
	}
	if b.Periods["u:system:x:2026"] != nil {
		t.Fatal("system targets are ignored")
	}
}

func TestFoldIgnoresUnregisteredEvents(t *testing.T) {
	e := ev("item.added", "mia", "room_1", "milk", t0)
	e.Name = "mystery.thing"
	if b := analytics.Fold(registry(), []analytics.Event{e}); len(b.Periods) != 0 {
		t.Fatal("unregistered events must not fold")
	}
}

func TestFoldOnceIsExactlyOnce(t *testing.T) {
	r := newRig(t0.Add(24 * time.Hour))
	r.add(ev("item.added", "mia", "room_1", "milk", t0), ev("item.checked", "mia", "room_1", "milk", t0.Add(time.Hour)))
	n, err := r.worker.FoldOnce(context.Background())
	if err != nil || n != 2 {
		t.Fatalf("first fold: %d %v", n, err)
	}
	if n, _ := r.worker.FoldOnce(context.Background()); n != 0 {
		t.Fatalf("second fold re-read %d events", n)
	}
	day := r.aggs.Period("h:room_1:2026-10-05")
	if num(day, "counts.item.added") != 1 || num(day, "counts.item.checked") != 1 {
		t.Fatalf("double counted: %+v", day)
	}
	if r.aggs.Watermark().IsZero() {
		t.Fatal("watermark did not advance")
	}
}

func TestFoldOnceCrashBeforeCommitAppliesNothingThenOnce(t *testing.T) {
	r := newRig(t0.Add(24 * time.Hour))
	r.add(ev("item.checked", "mia", "room_1", "milk", t0))
	r.aggs.FailApply(errors.New("connection lost"))
	if _, err := r.worker.FoldOnce(context.Background()); err == nil {
		t.Fatal("expected the failed commit to surface")
	}
	if r.aggs.Period("h:room_1:2026-10-05") != nil || !r.aggs.Watermark().IsZero() {
		t.Fatal("a failed commit must leave aggregates and watermark untouched")
	}
	r.aggs.FailApply(nil)
	if n, err := r.worker.FoldOnce(context.Background()); err != nil || n != 1 {
		t.Fatalf("retry: %d %v", n, err)
	}
	if got := num(r.aggs.Period("h:room_1:2026-10-05"), "counts.item.checked"); got != 1 {
		t.Fatalf("counted %d times", got)
	}
}

func TestFoldOnceWaitsOutIngestLag(t *testing.T) {
	r := newRig(t0.Add(90 * time.Second)) // the event was ingested 30s ago: still inside the lag
	r.add(ev("item.checked", "mia", "room_1", "milk", t0.Add(30*time.Second)))
	if n, _ := r.worker.FoldOnce(context.Background()); n != 0 {
		t.Fatalf("folded %d events that were still inside the lag", n)
	}
	r.now = t0.Add(10 * time.Minute)
	if n, _ := r.worker.FoldOnce(context.Background()); n != 1 {
		t.Fatalf("expected the event once the lag passed, got %d", n)
	}
}

func TestOnlyOneWorkerFoldsAtATime(t *testing.T) {
	r := newRig(t0.Add(24 * time.Hour))
	r.add(ev("item.checked", "mia", "room_1", "milk", t0))
	if _, ok, _ := r.aggs.AcquireLease(context.Background(), "someone-else", 5*time.Minute, r.now); !ok {
		t.Fatal("setup: lease should be free")
	}
	if n, err := r.worker.FoldOnce(context.Background()); err != nil || n != 0 {
		t.Fatalf("worker folded without the lease: %d %v", n, err)
	}
	if r.aggs.Period("h:room_1:2026-10-05") != nil {
		t.Fatal("no aggregates expected")
	}
	// Once the other holder's lease lapses, this worker takes over.
	r.now = r.now.Add(10 * time.Minute)
	if n, _ := r.worker.FoldOnce(context.Background()); n != 1 {
		t.Fatalf("expected takeover after expiry, got %d", n)
	}
}

func TestKeyIntervalsAndDueDate(t *testing.T) {
	r := newRig(t0.Add(120 * 24 * time.Hour))
	for i := 0; i < 4; i++ {
		at := t0.AddDate(0, 0, 7*i)
		r.add(ev("item.added", "mia", "room_1", "milk", at), ev("item.checked", "mia", "room_1", "milk", at.Add(2*time.Hour)))
	}
	if _, err := r.worker.FoldOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	iv, ok := r.aggs.Key("room_1:item:milk")["intervals"].(analytics.KeyIntervals)
	if !ok {
		t.Fatal("intervals not stored")
	}
	if iv.Source != "complete" || iv.N != 4 || iv.EWMADays < 6.99 || iv.EWMADays > 7.01 || iv.DueAt == nil {
		t.Fatalf("intervals: %+v", iv)
	}
	if want := t0.AddDate(0, 0, 21).Add(2 * time.Hour).Add(7 * 24 * time.Hour); !iv.DueAt.Equal(want) {
		t.Fatalf("due %v want %v", iv.DueAt, want)
	}
}

func TestKeyIntervalsFallBackToRequestsAndWithholdThinDueDates(t *testing.T) {
	r := newRig(t0.Add(60 * 24 * time.Hour))
	r.add(ev("item.added", "mia", "room_1", "eggs", t0), ev("item.added", "mia", "room_1", "eggs", t0.AddDate(0, 0, 10)))
	if _, err := r.worker.FoldOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	iv := r.aggs.Key("room_1:item:eggs")["intervals"].(analytics.KeyIntervals)
	if iv.Source != "request" || iv.N != 2 || iv.DueAt != nil {
		t.Fatalf("two requests are not enough for a due date: %+v", iv)
	}
}

func TestKeyIntervalsStoreABacktestedAddForecast(t *testing.T) {
	r := newRig(t0.Add(120 * 24 * time.Hour))
	for i := 0; i < 8; i++ {
		r.add(ev("item.added", "mia", "room_1", "milk", t0.AddDate(0, 0, 7*i)))
	}
	if _, err := r.worker.FoldOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	iv := r.aggs.Key("room_1:item:milk")["intervals"].(analytics.KeyIntervals)
	a := iv.Add
	if a == nil || a.Series != "added" || a.Trials != 5 || a.Hits != 5 || a.Score < 0.7 {
		t.Fatalf("forecast: %+v", a)
	}
	if want := t0.AddDate(0, 0, 56); !a.DueAt.Equal(want) || !a.OpensAt.Before(want) || !a.ClosesAt.After(want) {
		t.Fatalf("window: %+v", a)
	}
}

func TestIgnoredSuggestionsCountAgainstTheForecast(t *testing.T) {
	r := newRig(t0.Add(120 * 24 * time.Hour))
	for i := 0; i < 8; i++ {
		r.add(ev("item.added", "mia", "room_1", "milk", t0.AddDate(0, 0, 7*i)))
	}
	r.add(ev("item.suggestion_ignored", "sam", "room_1", "milk", t0.AddDate(0, 0, 27)))
	if _, err := r.worker.FoldOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	a := r.aggs.Key("room_1:item:milk")["intervals"].(analytics.KeyIntervals).Add
	if a == nil || a.Trials != 5 || a.Hits != 4 {
		t.Fatalf("forecast: %+v", a)
	}
}

func TestSuggestionPredictionsAreNotRolledUp(t *testing.T) {
	batch := analytics.Fold(registry(), []analytics.Event{ev("item.suggestion_predicted", "mia", "room_1", "milk", t0)})
	if len(batch.Keys) != 0 || len(batch.Periods) != 0 {
		t.Fatalf("predictions are measurement records only: %+v", batch.Keys)
	}
}

func addForecast(t *testing.T, r *rig, key string) *analytics.AddForecast {
	t.Helper()
	iv, ok := r.aggs.Key("room_1:item:" + key)["intervals"].(analytics.KeyIntervals)
	if !ok {
		t.Fatalf("no intervals for %q", key)
	}
	return iv.Add
}

func TestLookAlikeNamesShareOneHistory(t *testing.T) {
	r := newRig(t0.Add(120 * 24 * time.Hour))
	// "orange" one week, "oranges" the next: neither alone has a rhythm, together they are weekly.
	for i := 0; i < 8; i++ {
		key := "orange"
		if i%2 == 1 {
			key = "oranges"
		}
		r.add(ev("item.added", "mia", "room_1", key, t0.AddDate(0, 0, 7*i)))
	}
	if _, err := r.worker.FoldOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"orange", "oranges"} {
		a := addForecast(t, r, key)
		if a == nil || a.Trials != 5 || a.Hits != 5 || a.NameCertainty != 1 || a.Score < 0.7 {
			t.Fatalf("%s: plurals are the same thing, with full certainty: %+v", key, a)
		}
	}
}

func TestANearMissSpellingCostsConfidence(t *testing.T) {
	exact := newRig(t0.Add(120 * 24 * time.Hour))
	mixed := newRig(t0.Add(120 * 24 * time.Hour))
	for i := 0; i < 8; i++ {
		at := t0.AddDate(0, 0, 7*i)
		exact.add(ev("item.added", "mia", "room_1", "yogurt", at))
		key := "yogurt"
		if i%2 == 1 {
			key = "yoghurt" // a spelling apart: probably the same thing, not certainly
		}
		mixed.add(ev("item.added", "mia", "room_1", key, at))
	}
	for _, r := range []*rig{exact, mixed} {
		if _, err := r.worker.FoldOnce(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	e, m := addForecast(t, exact, "yogurt"), addForecast(t, mixed, "yogurt")
	if m == nil || m.Trials != e.Trials || m.Hits != e.Hits {
		t.Fatalf("the merged history has the same rhythm: exact %+v mixed %+v", e, m)
	}
	if !(m.NameCertainty < 1 && m.NameCertainty > 0.9) || m.Score >= e.Score {
		t.Fatalf("the further the names, the lower the score: exact %.3f mixed %.3f (certainty %.3f)", e.Score, m.Score, m.NameCertainty)
	}
}

func TestDifferentThingsStayApart(t *testing.T) {
	r := newRig(t0.Add(120 * 24 * time.Hour))
	for i := 0; i < 8; i++ {
		key := "almond milk"
		if i%2 == 1 {
			key = "oat milk"
		}
		r.add(ev("item.added", "mia", "room_1", key, t0.AddDate(0, 0, 7*i)))
	}
	if _, err := r.worker.FoldOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if a := addForecast(t, r, "oat milk"); a != nil && a.Trials > 1 {
		t.Fatalf("oat milk must not borrow almond milk's history: %+v", a)
	}
}

func TestStaleForecastsAreRebuiltWithoutNewEvents(t *testing.T) {
	r := newRig(t0.Add(120 * 24 * time.Hour))
	for i := 0; i < 8; i++ {
		r.add(ev("item.added", "mia", "room_1", "milk", t0.AddDate(0, 0, 7*i)))
	}
	if _, err := r.worker.FoldOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	// What an older server left behind: a rhythm with no add forecast and no version.
	_ = r.aggs.SetKeyIntervals(context.Background(), "room_1:item:milk", analytics.KeyIntervals{N: 8, Source: "request"})
	if iv := r.aggs.Key("room_1:item:milk")["intervals"].(analytics.KeyIntervals); iv.Add != nil {
		t.Fatal("setup: the forecast should be gone")
	}

	n, err := r.worker.RefreshStale(context.Background(), 100)
	if err != nil || n != 1 {
		t.Fatalf("refreshed %d %v", n, err)
	}
	iv := r.aggs.Key("room_1:item:milk")["intervals"].(analytics.KeyIntervals)
	if iv.Add == nil || iv.Add.Trials != 5 || iv.Version != analytics.ForecastVersion {
		t.Fatalf("rebuilt from the stored history with the current logic: %+v", iv)
	}
	// Up to date now: a second pass has nothing to do.
	if n, _ := r.worker.RefreshStale(context.Background(), 100); n != 0 {
		t.Fatalf("second pass refreshed %d", n)
	}
}
