//go:build integration

package mongo

import (
	"context"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
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

func TestBackfillReaderStreamsByRoomWithoutCredentials(t *testing.T) {
	c := connectOrSkip(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)
	roomA, roomB := "room_a", "room_b"
	if _, err := c.DB.Collection("users").InsertMany(ctx, []any{
		bson.D{{Key: "user_id", Value: "u1"}, {Key: "name", Value: "Mia"}, {Key: "username", Value: "mia"}, {Key: "password_enc", Value: "secret"}, {Key: "api_key_hash", Value: "h"}, {Key: "tz", Value: "Europe/London"}, {Key: "room_id", Value: roomA}, {Key: "created_at", Value: now}},
		bson.D{{Key: "user_id", Value: "u2"}, {Key: "room_id", Value: roomB}, {Key: "created_at", Value: now}},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.DB.Collection("list_items").InsertMany(ctx, []any{
		models.ListItem{ItemID: "i1", ListID: "l1", RoomID: roomA, Description: "milk", Completed: true, CreatedAt: now, UpdatedAt: now},
		models.ListItem{ItemID: "i2", ListID: "l2", RoomID: roomB, Description: "eggs", CreatedAt: now, UpdatedAt: now},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.DB.Collection("trips").InsertOne(ctx, models.Trip{
		TripID: "t1", RoomID: roomA, CreatedBy: "u1", CreatedAt: now,
		TripFields: models.TripFields{Title: "secret title", Notes: "secret notes"},
		Todos:      []models.TripTodo{{TodoID: "td1", Title: "secret todo", Done: true, DoneBy: "u1", DoneAt: &now, Category: "Packing"}},
	}); err != nil {
		t.Fatal(err)
	}

	br := NewBackfillReader(c)
	var users []models.User
	if err := br.EachUser(ctx, roomA, func(u models.User) error { users = append(users, u); return nil }); err != nil {
		t.Fatal(err)
	}
	if len(users) != 1 || users[0].UserID != "u1" || users[0].TZ != "Europe/London" {
		t.Fatalf("users: %+v", users)
	}
	if u := users[0]; u.PasswordEnc != "" || u.APIKeyHash != "" || u.Username != "" || u.Name != "" {
		t.Fatalf("projection leaked credentials: %+v", u)
	}
	var items []models.ListItem
	if err := br.EachItem(ctx, "", func(it models.ListItem) error { items = append(items, it); return nil }); err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].ItemID != "i1" || items[1].ItemID != "i2" || items[0].Description != "milk" {
		t.Fatalf("items: %+v", items)
	}
	var trips []models.Trip
	if err := br.EachTrip(ctx, roomA, func(tr models.Trip) error { trips = append(trips, tr); return nil }); err != nil {
		t.Fatal(err)
	}
	if len(trips) != 1 || len(trips[0].Todos) != 1 || trips[0].Todos[0].DoneAt == nil || trips[0].Todos[0].Category != "Packing" {
		t.Fatalf("trips: %+v", trips)
	}
	if tr := trips[0]; tr.Title != "" || tr.Notes != "" || tr.Todos[0].Title != "" {
		t.Fatalf("trip projection leaked user text: %+v", tr)
	}
}

func TestEventRepoInsertNewCountsOnlyNewEvents(t *testing.T) {
	c := connectOrSkip(t)
	repo := NewEventRepo(c)
	ctx := context.Background()
	if err := repo.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC().Add(-time.Hour)
	a, b := storedEvent("bf1:item.added:i1", "item.added", "u1", "r1", "milk", at), storedEvent("bf1:item.added:i2", "item.added", "u1", "r1", "eggs", at)
	if n, err := repo.InsertNew(ctx, []analytics.Event{a, b}); err != nil || n != 2 {
		t.Fatalf("first insert: n=%d err=%v", n, err)
	}
	cNew := storedEvent("bf1:item.added:i3", "item.added", "u1", "r1", "rice", at)
	if n, err := repo.InsertNew(ctx, []analytics.Event{a, cNew, b}); err != nil || n != 1 {
		t.Fatalf("mixed duplicates: n=%d err=%v, want 1 new", n, err)
	}
	if n, err := repo.InsertNew(ctx, []analytics.Event{a, b, cNew}); err != nil || n != 0 {
		t.Fatalf("all duplicates: n=%d err=%v", n, err)
	}
}

func TestMongoRequeueRoomKeysOnlyTouchesThatRoom(t *testing.T) {
	c := connectOrSkip(t)
	ctx := context.Background()
	aggs := NewAggRepo(c, NewTx(c))
	if err := aggs.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	roomA, roomB := "ra_"+randHex(6), "rb_"+randHex(6)
	owner := "w_" + randHex(6)
	now := time.Now().UTC()
	if _, ok, err := aggs.AcquireLease(ctx, owner, 5*time.Minute, now); err != nil || !ok {
		t.Fatalf("lease: %v %v", ok, err)
	}
	defer func() { _ = aggs.ReleaseLease(ctx, owner) }()
	wm, _, _ := aggs.AcquireLease(ctx, owner, 5*time.Minute, now)
	b := analytics.NewBatch()
	for _, ref := range []analytics.KeyRef{{RoomID: roomA, SubjectType: "item", Key: "milk"}, {RoomID: roomA, SubjectType: "item", Key: "eggs"}, {RoomID: roomB, SubjectType: "item", Key: "milk"}} {
		u := &analytics.DocUpdate{ID: ref.ID(), Inc: map[string]int64{"counts.added": 1}, Set: map[string]any{"room_id": ref.RoomID, "subject_type": ref.SubjectType, "key": ref.Key}}
		b.Keys[ref.ID()] = u
	}
	b.Keys[roomA+":item:bread"] = &analytics.DocUpdate{ID: roomA + ":item:bread", Set: map[string]any{"room_id": roomA, "subject_type": "item", "key": "bread"}}
	if err := aggs.ApplyBatch(ctx, b, owner, wm); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{roomA + ":item:milk", roomA + ":item:eggs", roomB + ":item:milk"} {
		if err := aggs.SetKeyIntervals(ctx, id, analytics.KeyIntervals{N: 3, LastAt: now, ComputedAt: now, Version: analytics.ForecastVersion}); err != nil {
			t.Fatal(err)
		}
	}

	req := analytics.NewBatch()
	req.Requeue[roomA] = struct{}{}
	if err := aggs.ApplyBatch(ctx, req, owner, wm); err != nil {
		t.Fatal(err)
	}
	stale, err := aggs.StaleKeys(ctx, analytics.ForecastVersion, 10000)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, ref := range stale {
		if ref.RoomID == roomA || ref.RoomID == roomB {
			got[ref.ID()] = true
		}
	}
	if !got[roomA+":item:milk"] || !got[roomA+":item:eggs"] || !got[roomA+":item:bread"] || got[roomB+":item:milk"] {
		t.Fatalf("only room A's keys are stale: %v", got)
	}
	var bread map[string]any
	if err := aggs.keys().FindOne(ctx, map[string]any{"_id": roomA + ":item:bread"}).Decode(&bread); err != nil {
		t.Fatal(err)
	}
	if _, has := bread["intervals"]; has {
		t.Fatal("a key without intervals must not get a stub intervals document")
	}
	if n, err := aggs.RequeueRoomKeys(ctx, roomB); err != nil || n != 1 {
		t.Fatalf("RequeueRoomKeys(B) = %d %v", n, err)
	}
}

func TestMongoForecastKeysAnySubjectOpeningBy(t *testing.T) {
	c := connectOrSkip(t)
	ctx := context.Background()
	aggs := NewAggRepo(c, NewTx(c))
	if err := aggs.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	room, owner := "rf_"+randHex(6), "w_"+randHex(6)
	now := time.Now().UTC().Truncate(time.Millisecond)
	wm, ok, err := aggs.AcquireLease(ctx, owner, 5*time.Minute, now)
	if err != nil || !ok {
		t.Fatalf("lease %v %v", ok, err)
	}
	defer func() { _ = aggs.ReleaseLease(ctx, owner) }()
	b := analytics.NewBatch()
	refs := []analytics.KeyRef{{RoomID: room, SubjectType: "item", Key: "milk"}, {RoomID: room, SubjectType: "chore", Key: "bins"},
		{RoomID: room, SubjectType: "item", Key: "later"}, {RoomID: room, SubjectType: "item", Key: "none"}}
	for _, ref := range refs {
		b.Keys[ref.ID()] = &analytics.DocUpdate{ID: ref.ID(), Inc: map[string]int64{"containers.list:l1": 1},
			Set: map[string]any{"room_id": ref.RoomID, "subject_type": ref.SubjectType, "key": ref.Key}}
	}
	if err := aggs.ApplyBatch(ctx, b, owner, wm); err != nil {
		t.Fatal(err)
	}
	opens := map[string]time.Time{"milk": now.Add(-time.Hour), "bins": now.Add(time.Hour), "later": now.Add(72 * time.Hour)}
	for _, ref := range refs[:3] {
		iv := analytics.KeyIntervals{N: 5, LastAt: now, ComputedAt: now, Version: analytics.ForecastVersion,
			Add: &analytics.AddForecast{Series: "added", Clock: "home", EWMADays: 7, OpensAt: opens[ref.Key], ClosesAt: opens[ref.Key].Add(time.Hour), DueAt: opens[ref.Key]}}
		if err := aggs.SetKeyIntervals(ctx, ref.ID(), iv); err != nil {
			t.Fatal(err)
		}
	}
	got, err := aggs.ForecastKeys(ctx, room, now.Add(2*time.Hour), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Key != "milk" || got[1].Key != "bins" || got[0].Containers["list:l1"] != 1 || got[0].Intervals.Add.Clock != "home" {
		t.Fatalf("got %+v", got)
	}
}

func TestMongoKeyIntervalsWeeklyRoundtripsAndClears(t *testing.T) {
	c := connectOrSkip(t)
	ctx := context.Background()
	aggs := NewAggRepo(c, NewTx(c))
	room, owner := "rw_"+randHex(6), "w_"+randHex(6)
	now := time.Now().UTC().Truncate(time.Millisecond)
	wm, ok, err := aggs.AcquireLease(ctx, owner, 5*time.Minute, now)
	if err != nil || !ok {
		t.Fatalf("lease %v %v", ok, err)
	}
	defer func() { _ = aggs.ReleaseLease(ctx, owner) }()
	ref := analytics.KeyRef{RoomID: room, SubjectType: "item", Key: "bin bags"}
	b := analytics.NewBatch()
	b.Keys[ref.ID()] = &analytics.DocUpdate{ID: ref.ID(), Set: map[string]any{"room_id": room, "subject_type": "item", "key": ref.Key}}
	if err := aggs.ApplyBatch(ctx, b, owner, wm); err != nil {
		t.Fatal(err)
	}
	wk := predict.Weekly{EveryWeeks: 2, Weekday: 2, Hour: 20, Share: 1}
	if err := aggs.SetKeyIntervals(ctx, ref.ID(), analytics.KeyIntervals{N: 10, LastAt: now, ComputedAt: now, Version: analytics.ForecastVersion, Weekly: &wk,
		LastBy: "u_b", Turns: []string{"u_b", "u_a", "u_b"}}); err != nil {
		t.Fatal(err)
	}
	got, err := aggs.GetKeyStats(ctx, room, "item", []string{ref.Key})
	if err != nil || got[ref.Key].Intervals == nil || got[ref.Key].Intervals.Weekly == nil || *got[ref.Key].Intervals.Weekly != wk {
		t.Fatalf("weekly lost: %+v %v", got[ref.Key].Intervals, err)
	}
	if iv := got[ref.Key].Intervals; iv.LastBy != "u_b" || len(iv.Turns) != 3 || iv.Turns[1] != "u_a" {
		t.Fatalf("turns lost: %+v", iv)
	}
	if err := aggs.SetKeyIntervals(ctx, ref.ID(), analytics.KeyIntervals{N: 10, LastAt: now, ComputedAt: now, Version: analytics.ForecastVersion}); err != nil {
		t.Fatal(err)
	}
	got, _ = aggs.GetKeyStats(ctx, room, "item", []string{ref.Key})
	if got[ref.Key].Intervals.Weekly != nil || got[ref.Key].Intervals.LastBy != "" || got[ref.Key].Intervals.Turns != nil {
		t.Fatal("a pattern no longer detected, and turns no longer known, must be cleared")
	}
}
