//go:build integration

package mongo

import (
	"context"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"go.mongodb.org/mongo-driver/bson"
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

func TestMongoUpcomingKeysAndContainers(t *testing.T) {
	c := connectOrSkip(t)
	ctx := context.Background()
	events := NewEventRepo(c)
	aggs := NewAggRepo(c, NewTx(c))
	_ = events.EnsureIndexes(ctx)
	_ = aggs.EnsureIndexes(ctx)

	room := "r_up_" + randHex(4)
	// Eight weekly adds ending a week ago: the next one is due now.
	base := time.Now().UTC().AddDate(0, 0, -56).Truncate(time.Hour)
	var evs []analytics.Event
	for i := 0; i < 8; i++ {
		evs = append(evs, storedEvent("up"+room+string(rune('a'+i)), "item.added", "u1", room, "milk", base.AddDate(0, 0, 7*i)))
	}
	if err := events.InsertMany(ctx, evs); err != nil {
		t.Fatal(err)
	}
	w := analytics.NewWorker(events, aggs, analyticsReg())
	if _, err := w.FoldOnce(ctx); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	got, err := aggs.UpcomingKeys(ctx, room, "item", now, now, 0.65, 0.5, 10)
	if err != nil || len(got) != 1 || got[0].Key != "milk" {
		t.Fatalf("upcoming: %+v %v", got, err)
	}
	if got[0].Containers["list:list_1"] != 8 {
		t.Fatalf("containers must decode onto KeyStat: %+v", got[0].Containers)
	}
	if a := got[0].Intervals.Add; a == nil || a.Trials != 5 || a.Hits != 5 || a.Series != "added" {
		t.Fatalf("stored forecast: %+v", got[0].Intervals)
	}
	if early, _ := aggs.UpcomingKeys(ctx, room, "item", now.AddDate(0, 0, -6), now.AddDate(0, 0, -6), 0.65, 0.5, 10); len(early) != 0 {
		t.Fatalf("window not open yet: %+v", early)
	}
	soon := now.AddDate(0, 0, -6) // the window opens in about three days
	if ahead, _ := aggs.UpcomingKeys(ctx, room, "item", soon, soon.AddDate(0, 0, 4), 0.65, 0.5, 10); len(ahead) != 1 {
		t.Fatalf("opens before the bound: %+v", ahead)
	}
	if strict, _ := aggs.UpcomingKeys(ctx, room, "item", now, now, 0.99, 0.5, 10); len(strict) != 0 {
		t.Fatalf("score below the bar: %+v", strict)
	}
	if other, _ := aggs.UpcomingKeys(ctx, "other_room", "item", now, now, 0.65, 0.5, 10); len(other) != 0 {
		t.Fatalf("other house: %+v", other)
	}
}

func TestMongoListByContainerIsNewestFirstAndScoped(t *testing.T) {
	c := connectOrSkip(t)
	ctx := context.Background()
	events := NewEventRepo(c)
	_ = events.EnsureIndexes(ctx)
	room := "r_cont_" + randHex(4)
	now := time.Now().UTC().Truncate(time.Millisecond)
	mk := func(id, name, list string, ago time.Duration) analytics.Event {
		e := storedEvent(id+room, name, "u1", room, "milk", now.Add(-ago))
		e.Container = &analytics.Ref{Type: "list", ID: list}
		return e
	}
	if err := events.InsertMany(ctx, []analytics.Event{
		mk("a", "item.suggestion_ignored", "l1", 3*time.Hour),
		mk("b", "item.suggestion_accepted", "l1", 2*time.Hour),
		mk("c", "item.suggestion_ignored", "l1", time.Hour),
		mk("d", "item.suggestion_ignored", "l2", 30*time.Minute),
		mk("e", "item.added", "l1", 10*time.Minute),
		mk("f", "item.suggestion_ignored", "l1", 40*24*time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	names := []string{"item.suggestion_ignored", "item.suggestion_accepted"}
	got, err := events.ListByContainer(ctx, room, "list", "l1", names, now.Add(-14*24*time.Hour), 2)
	if err != nil || len(got) != 2 || got[0].Name != "item.suggestion_ignored" || got[1].Name != "item.suggestion_accepted" {
		t.Fatalf("newest two on l1 within the window: %+v %v", got, err)
	}
	all, _ := events.ListByContainer(ctx, room, "list", "l1", names, now.Add(-14*24*time.Hour), 10)
	if len(all) != 3 {
		t.Fatalf("other lists, other names and old events are excluded: %d", len(all))
	}
}

func TestMongoListKeysIsScopedToTheHouse(t *testing.T) {
	c := connectOrSkip(t)
	ctx := context.Background()
	events := NewEventRepo(c)
	aggs := NewAggRepo(c, NewTx(c))
	_ = events.EnsureIndexes(ctx)
	_ = aggs.EnsureIndexes(ctx)
	room := "r_keys_" + randHex(4)
	at := time.Now().UTC().Add(-time.Hour)
	if err := events.InsertMany(ctx, []analytics.Event{
		storedEvent("k1"+room, "item.added", "u1", room, "orange", at),
		storedEvent("k2"+room, "item.added", "u1", room, "oranges", at.Add(time.Minute)),
		storedEvent("k3"+room, "item.added", "u1", "other_"+room, "milk", at),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := analytics.NewWorker(events, aggs, analyticsReg()).FoldOnce(ctx); err != nil {
		t.Fatal(err)
	}
	keys, err := aggs.ListKeys(ctx, room, "item", 10)
	if err != nil || len(keys) != 2 {
		t.Fatalf("keys %v %v", keys, err)
	}
}

func TestMongoStaleForecastsAreFoundAndRebuilt(t *testing.T) {
	c := connectOrSkip(t)
	ctx := context.Background()
	events := NewEventRepo(c)
	aggs := NewAggRepo(c, NewTx(c))
	_ = events.EnsureIndexes(ctx)
	_ = aggs.EnsureIndexes(ctx)
	room := "r_stale_" + randHex(4)
	base := time.Now().UTC().AddDate(0, 0, -56).Truncate(time.Hour)
	var evs []analytics.Event
	for i := 0; i < 8; i++ {
		evs = append(evs, storedEvent("st"+room+string(rune('a'+i)), "item.added", "u1", room, "milk", base.AddDate(0, 0, 7*i)))
	}
	if err := events.InsertMany(ctx, evs); err != nil {
		t.Fatal(err)
	}
	w := analytics.NewWorker(events, aggs, analyticsReg())
	if _, err := w.FoldOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if stale, _ := aggs.StaleKeys(ctx, analytics.ForecastVersion, 10); len(stale) != 0 {
		t.Fatalf("freshly folded keys are current: %+v", stale)
	}
	// What a server from before versioning left behind: no version, no add forecast.
	if _, err := c.DB.Collection("key_stats").UpdateMany(ctx, bson.D{{Key: "room_id", Value: room}},
		bson.D{{Key: "$unset", Value: bson.D{{Key: "intervals.v", Value: ""}, {Key: "intervals.add", Value: ""}}}}); err != nil {
		t.Fatal(err)
	}
	stale, err := aggs.StaleKeys(ctx, analytics.ForecastVersion, 10)
	if err != nil || len(stale) != 1 || stale[0].Key != "milk" || stale[0].RoomID != room {
		t.Fatalf("stale: %+v %v", stale, err)
	}
	if n, err := w.RefreshStale(ctx, 10); err != nil || n != 1 {
		t.Fatalf("refresh %d %v", n, err)
	}
	got, _ := aggs.GetKeyStats(ctx, room, "item", []string{"milk"})
	if iv := got["milk"].Intervals; iv == nil || iv.Add == nil || iv.Version != analytics.ForecastVersion {
		t.Fatalf("rebuilt: %+v", iv)
	}
}

func TestMongoUpcomingFindsALaterWindowAfterASkippedWeek(t *testing.T) {
	c := connectOrSkip(t)
	ctx := context.Background()
	events := NewEventRepo(c)
	aggs := NewAggRepo(c, NewTx(c))
	_ = events.EnsureIndexes(ctx)
	_ = aggs.EnsureIndexes(ctx)
	room := "r_skip_" + randHex(4)
	// Weekly until two weeks ago: this week's window is the second one.
	base := time.Now().UTC().AddDate(0, 0, -63).Truncate(time.Hour)
	var evs []analytics.Event
	for i := 0; i < 8; i++ {
		evs = append(evs, storedEvent("sk"+room+string(rune('a'+i)), "item.added", "u1", room, "milk", base.AddDate(0, 0, 7*i)))
	}
	if err := events.InsertMany(ctx, evs); err != nil {
		t.Fatal(err)
	}
	if _, err := analytics.NewWorker(events, aggs, analyticsReg()).FoldOnce(ctx); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	got, err := aggs.UpcomingKeys(ctx, room, "item", now, now, 0.65, 0.5, 10)
	if err != nil || len(got) != 1 || got[0].Key != "milk" {
		t.Fatalf("upcoming: %+v %v", got, err)
	}
	a := got[0].Intervals.Add
	if a.ClosesAt.After(now) || len(a.Windows) < 2 {
		t.Fatalf("the first window has closed, a later one is open: %+v", a)
	}
}
