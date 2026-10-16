//go:build integration

package mongo

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
)

// Seeds a house whose history predates analytics, backfills it through the real Mongo
// repos and rollup, and checks the aggregates, then re-runs to prove nothing doubles.
func TestMongoBackfillEndToEnd(t *testing.T) {
	c := connectOrSkip(t)
	ctx := context.Background()
	events := NewEventRepo(c)
	aggs := NewAggRepo(c, NewTx(c))
	if err := events.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	if err := aggs.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}

	clock := time.Now().UTC().Truncate(time.Second)
	room, user := "room_1", "mia"
	start := clock.AddDate(0, 0, -40)
	must := func(_ any, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(c.DB.Collection("users").InsertOne(ctx, models.User{UserID: user, Name: "Mia", PasswordEnc: "secret", RoomID: &room, TZ: "America/New_York", CreatedAt: start}))
	must(c.DB.Collection("rooms").InsertOne(ctx, models.Room{RoomID: room, MemberIDs: []string{user}, CreatedAt: start}))
	must(c.DB.Collection("lists").InsertOne(ctx, models.List{ListID: "l1", RoomID: room, Name: "Groceries", CreatedAt: start}))
	// Milk bought every week for four weeks (archived when the list was cleared), none of it
	// written by instrumented code.
	for w := 0; w < 4; w++ {
		at := start.AddDate(0, 0, 7*w+1)
		must(c.DB.Collection("list_items").InsertOne(ctx, models.ListItem{
			ItemID: fmt.Sprintf("it_%d", w), ListID: "l1", RoomID: room, Description: "Milk", Category: "Dairy",
			Completed: true, IsArchived: true, CreatedAt: at.Add(-time.Hour), UpdatedAt: at,
		}))
	}
	done := start.AddDate(0, 0, 3)
	must(c.DB.Collection("trips").InsertOne(ctx, models.Trip{
		TripID: "trip_1", RoomID: room, CreatedBy: user, CreatedAt: start.AddDate(0, 0, 2),
		TripFields: models.TripFields{Title: "Japan", StartDate: strPtr(start.AddDate(0, 0, 12).Format("2006-01-02"))},
		Todos:      []models.TripTodo{{TodoID: "td1", Title: "Passport", Done: true, DoneBy: user, DoneAt: &done, Category: "Docs"}},
	}))

	reg := analytics.NewRegistry()
	services.RegisterAnalyticsEvents(reg)
	trips.RegisterAnalyticsEvents(reg)
	reader := NewBackfillReader(c)
	dir := services.NewBackfillDirectory(reader)
	sources := append(dir.Sources(), trips.NewBackfillSource(reader.EachTrip))
	worker := analytics.NewWorker(events, aggs, reg).WithClock(func() time.Time { return clock })
	b := analytics.NewBackfill(events, reg, worker, sources...).WithClock(
		func() time.Time { return clock },
		func(_ context.Context, d time.Duration) error { clock = clock.Add(d); return nil },
	)
	env := analytics.BackfillEnv{Before: clock, Retention: 400 * 24 * time.Hour, Now: clock, TZ: dir.TZ}

	dry, err := b.Run(ctx, env, analytics.BackfillOptions{})
	if err != nil || dry.Emitted != 13 || dry.Inserted != 0 {
		t.Fatalf("dry run: %+v %v", dry, err)
	}
	if left, _ := events.ListIngestedBetween(ctx, start.AddDate(-1, 0, 0), clock.AddDate(1, 0, 0), 100); len(left) != 0 {
		t.Fatalf("dry run wrote %d events", len(left))
	}

	rep, err := b.Run(ctx, env, analytics.BackfillOptions{Apply: true, Fold: true})
	if err != nil {
		t.Fatal(err)
	}
	// user + house + list + 4 added + 4 checked + trip.created + todo.checked
	if rep.Inserted != 13 || rep.Folded != 13 || rep.Profiles == 0 || rep.UTCFallback != 0 {
		t.Fatalf("apply: %+v", rep)
	}

	stats, err := aggs.GetKeyStats(ctx, room, "item", []string{"milk"})
	if err != nil || stats["milk"].Counts["added"] != 4 || stats["milk"].Counts["checked"] != 4 {
		t.Fatalf("key stats: %+v %v", stats, err)
	}
	if iv := stats["milk"].Intervals; iv == nil || iv.DueAt == nil || iv.EWMADays < 6 || iv.EWMADays > 8 || iv.Source != "complete" {
		t.Fatalf("a weekly habit must yield a ~7 day interval and a due date: %+v", stats["milk"].Intervals)
	}
	year := fmt.Sprint(start.Year())
	if doc, err := aggs.GetPeriod(ctx, "h:"+room+":"+year); err != nil || doc == nil {
		t.Fatalf("house year doc: %v %v", doc, err)
	}
	p, err := aggs.GetProfile(ctx, "u:"+user)
	if err != nil || p == nil || p.TZ != "America/New_York" {
		t.Fatalf("profile: %+v %v", p, err)
	}

	// Re-running adds nothing and folds nothing: counts must not double.
	again, err := b.Run(ctx, env, analytics.BackfillOptions{Apply: true, Fold: true})
	if err != nil || again.Inserted != 0 || again.Folded != 0 {
		t.Fatalf("re-run: %+v %v", again, err)
	}
	stats2, _ := aggs.GetKeyStats(ctx, room, "item", []string{"milk"})
	if stats2["milk"].Counts["checked"] != 4 {
		t.Fatalf("re-run doubled the counts: %+v", stats2["milk"].Counts)
	}
}

func strPtr(s string) *string { return &s }
