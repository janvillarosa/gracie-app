//go:build integration

package mongo

import (
	"context"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
)

func TestMongoProfilesDirtySetAndDueKeys(t *testing.T) {
	c := connectOrSkip(t)
	ctx := context.Background()
	events := NewEventRepo(c)
	aggs := NewAggRepo(c, NewTx(c))
	_ = events.EnsureIndexes(ctx)
	_ = aggs.EnsureIndexes(ctx)

	base := time.Now().UTC().AddDate(0, 0, -30).Truncate(time.Hour)
	var evs []analytics.Event
	for i := 0; i < 4; i++ {
		at := base.AddDate(0, 0, 7*i)
		evs = append(evs, storedEvent("c"+string(rune('0'+i)), "item.checked", "u1", "r1", "milk", at))
	}
	if err := events.InsertMany(ctx, evs); err != nil {
		t.Fatal(err)
	}
	w := analytics.NewWorker(events, aggs, analyticsReg())
	if n, err := w.FoldOnce(ctx); err != nil || n != 4 {
		t.Fatalf("fold %d %v", n, err)
	}

	// The fold marked the actor and the house dirty; claiming removes them, so a second claim gets none.
	got, err := aggs.ClaimDirty(ctx, 10)
	if err != nil || len(got) != 2 {
		t.Fatalf("claim: %v %v", got, err)
	}
	if again, _ := aggs.ClaimDirty(ctx, 10); len(again) != 0 {
		t.Fatalf("claimed twice: %v", again)
	}
	if err := aggs.MarkDirty(ctx, got...); err != nil {
		t.Fatal(err)
	}
	if n, err := w.ProfilePass(ctx); err != nil || n != 2 {
		t.Fatalf("profile pass %d %v", n, err)
	}

	p, err := aggs.GetProfile(ctx, "u:u1")
	if err != nil || p == nil || p.Events != 4 || len(p.OpenHOW) != 168 {
		t.Fatalf("profile: %+v %v", p, err)
	}
	if none, err := aggs.GetProfile(ctx, "u:ghost"); err != nil || none != nil {
		t.Fatalf("absent profile: %v %v", none, err)
	}

	far := time.Now().UTC().AddDate(1, 0, 0)
	due, err := aggs.DueKeys(ctx, "r1", "item", far, 10)
	if err != nil || len(due) != 1 || due[0].Key != "milk" || due[0].Intervals == nil || due[0].Intervals.DueAt == nil {
		t.Fatalf("due: %+v %v", due, err)
	}
	if early, _ := aggs.DueKeys(ctx, "r1", "item", base, 10); len(early) != 0 {
		t.Fatalf("nothing should be due before the history: %+v", early)
	}
	stats, err := aggs.GetKeyStats(ctx, "r1", "item", []string{"milk", "ghost"})
	if err != nil || len(stats) != 1 || stats["milk"].Counts["checked"] != 4 {
		t.Fatalf("stats: %+v %v", stats, err)
	}

	// Stale profiles are queued again; deleting a user removes their profile and period stats.
	if n, err := aggs.RequeueStale(ctx, time.Now().UTC().Add(time.Hour), 10); err != nil || n != 2 {
		t.Fatalf("requeue %d %v", n, err)
	}
	if err := aggs.DeleteByUser(ctx, "u1"); err != nil {
		t.Fatal(err)
	}
	if gone, _ := aggs.GetProfile(ctx, "u:u1"); gone != nil {
		t.Fatal("DeleteByUser left the profile behind")
	}
	year := base.Format("2006")
	if per, _ := aggs.GetPeriod(ctx, "u:u1:"+year); per != nil {
		t.Fatal("DeleteByUser left period stats behind")
	}
}
