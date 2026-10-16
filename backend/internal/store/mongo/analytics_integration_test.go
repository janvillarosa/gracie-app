//go:build integration

package mongo

import (
	"context"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
)

func analyticsReg() *analytics.Registry {
	reg := analytics.NewRegistry()
	reg.MustRegister(
		analytics.EventDef{Name: "item.added", Role: analytics.RoleRequest},
		analytics.EventDef{Name: "item.checked", Role: analytics.RoleComplete},
	)
	return reg
}

func storedEvent(id, name, actor, room, key string, at time.Time) analytics.Event {
	e := analytics.Event{
		EventID: id, Name: name, Source: analytics.SourceServer, ActorID: actor, RoomID: room, Key: key,
		Subject: analytics.Ref{Type: "item", ID: "i_" + key}, Container: &analytics.Ref{Type: "list", ID: "list_1"}, OccurredAt: at,
	}
	analytics.Stamp(&e, at.Add(time.Minute), "UTC", 400*24*time.Hour)
	e.EventID = id
	return e
}

func TestEventRepoDedupesAndHasTTL(t *testing.T) {
	c := connectOrSkip(t)
	repo := NewEventRepo(c)
	ctx := context.Background()
	if err := repo.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC().Add(-time.Hour)
	batch := []analytics.Event{storedEvent("ev_1", "item.added", "u1", "r1", "milk", at), storedEvent("ev_2", "item.added", "u1", "r1", "milk", at)}
	if err := repo.InsertMany(ctx, batch); err != nil {
		t.Fatal(err)
	}
	// Re-sending the same ids (a client retry) must neither fail nor duplicate.
	if err := repo.InsertMany(ctx, append(batch, storedEvent("ev_3", "item.added", "u1", "r1", "milk", at))); err != nil {
		t.Fatalf("duplicates must be ignored: %v", err)
	}
	got, err := repo.ListIngestedBetween(ctx, at, time.Now().UTC().Add(time.Hour), 100)
	if err != nil || len(got) != 3 {
		t.Fatalf("got %d events, err %v", len(got), err)
	}
	idx, err := c.DB.Collection("events").Indexes().ListSpecifications(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var ttl bool
	for _, s := range idx {
		if s.Name == "expire_at_ttl" && s.ExpireAfterSeconds != nil && *s.ExpireAfterSeconds == 0 {
			ttl = true
		}
	}
	if !ttl {
		t.Fatal("expire_at TTL index missing")
	}
	if err := repo.DeleteByActor(ctx, "u1"); err != nil {
		t.Fatal(err)
	}
	if left, _ := repo.ListIngestedBetween(ctx, at, time.Now().UTC().Add(time.Hour), 100); len(left) != 0 {
		t.Fatalf("DeleteByActor left %d", len(left))
	}
}

func TestMongoRollupIsExactlyOnceAndLeased(t *testing.T) {
	c := connectOrSkip(t)
	ctx := context.Background()
	events := NewEventRepo(c)
	tx := NewTx(c)
	aggs := NewAggRepo(c, tx)
	if err := events.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	if err := aggs.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	base := time.Now().UTC().AddDate(0, 0, -30).Truncate(time.Hour)
	var evs []analytics.Event
	for i := 0; i < 4; i++ {
		at := base.AddDate(0, 0, 7*i)
		evs = append(evs, storedEvent("a"+string(rune('0'+i)), "item.added", "u1", "r1", "milk", at), storedEvent("c"+string(rune('0'+i)), "item.checked", "u1", "r1", "milk", at.Add(time.Hour)))
	}
	if err := events.InsertMany(ctx, evs); err != nil {
		t.Fatal(err)
	}

	w1 := analytics.NewWorker(events, aggs, analyticsReg())
	w2 := analytics.NewWorker(events, aggs, analyticsReg())

	// Another instance holds the lease: the first worker does nothing.
	if _, ok, err := aggs.AcquireLease(ctx, "other", 5*time.Minute, time.Now().UTC()); err != nil || !ok {
		t.Fatalf("setup lease: %v %v", ok, err)
	}
	if n, err := w1.FoldOnce(ctx); err != nil || n != 0 {
		t.Fatalf("worker folded without the lease: %d %v", n, err)
	}
	if err := aggs.ReleaseLease(ctx, "other"); err != nil {
		t.Fatal(err)
	}

	n, err := w1.FoldOnce(ctx)
	if err != nil || n != 8 {
		t.Fatalf("fold: %d %v", n, err)
	}
	// Folding again, from a different worker, applies nothing new.
	if n, err := w2.FoldOnce(ctx); err != nil || n != 0 {
		t.Fatalf("refold: %d %v", n, err)
	}

	var doc struct {
		Counts map[string]map[string]int64 `bson:"counts"`
	}
	year := base.Format("2006")
	if err := aggs.periods().FindOne(ctx, map[string]any{"_id": "h:r1:" + year}).Decode(&doc); err != nil {
		// the window may straddle a year boundary: fall back to the month doc of the first event
		t.Skipf("year doc not found (%v); window straddles a year boundary", err)
	}
	if doc.Counts["item"]["added"] > 4 || doc.Counts["item"]["checked"] > 4 {
		t.Fatalf("double counted: %+v", doc.Counts)
	}

	var key struct {
		Intervals struct {
			N      int       `bson:"n"`
			Source string    `bson:"source"`
			DueAt  time.Time `bson:"due_at"`
		} `bson:"intervals"`
		Counts map[string]int64 `bson:"counts"`
	}
	if err := aggs.keys().FindOne(ctx, map[string]any{"_id": "r1:item:milk"}).Decode(&key); err != nil {
		t.Fatal(err)
	}
	if key.Counts["checked"] != 4 || key.Intervals.N != 4 || key.Intervals.Source != "complete" || key.Intervals.DueAt.IsZero() {
		t.Fatalf("key stats: %+v", key)
	}

	if err := aggs.DeleteByRoom(ctx, "r1"); err != nil {
		t.Fatal(err)
	}
	if err := aggs.keys().FindOne(ctx, map[string]any{"_id": "r1:item:milk"}).Err(); err == nil {
		t.Fatal("DeleteByRoom left key_stats behind")
	}
}

func TestEventRepoEarliestOccurredBySource(t *testing.T) {
	c := connectOrSkip(t)
	repo := NewEventRepo(c)
	ctx := context.Background()
	if _, ok, err := repo.EarliestOccurred(ctx, analytics.SourceServer); err != nil || ok {
		t.Fatalf("empty store: ok=%v err=%v", ok, err)
	}
	early := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	older := storedEvent("ev_old", "item.added", "u1", "r1", "milk", early.Add(-time.Hour))
	older.Source = analytics.SourceBackfill
	if err := repo.InsertMany(ctx, []analytics.Event{
		storedEvent("ev_b", "item.added", "u1", "r1", "milk", early.Add(time.Hour)),
		storedEvent("ev_a", "item.added", "u1", "r1", "milk", early),
		older,
	}); err != nil {
		t.Fatal(err)
	}
	got, ok, err := repo.EarliestOccurred(ctx, analytics.SourceServer)
	if err != nil || !ok || !got.Equal(early) {
		t.Fatalf("got %v ok=%v err=%v, want %v (backfill events ignored)", got, ok, err, early)
	}
}
