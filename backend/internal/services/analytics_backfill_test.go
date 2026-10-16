package services

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
)

var bfT = time.Date(2026, 6, 6, 10, 0, 0, 0, time.UTC)

func names(evs []analytics.Event) []string {
	out := make([]string, len(evs))
	for i, e := range evs {
		out[i] = e.Name
	}
	return out
}

func TestDeriveItemEvents(t *testing.T) {
	base := models.ListItem{ItemID: "i1", ListID: "l1", RoomID: "r1", Description: "  2 Whole   MILK ", Category: "Dairy", CreatedAt: bfT, UpdatedAt: bfT.Add(time.Hour)}
	with := func(f func(*models.ListItem)) models.ListItem { it := base; f(&it); return it }
	done := bfT.Add(2 * time.Hour)

	tests := []struct {
		name      string
		it        models.ListItem
		wantNames []string
		wantSkips []string
		wantActor map[string]string
	}{
		{"open item", base, []string{"item.added"}, nil, map[string]string{"item.added": "sys"}},
		{"checked item", with(func(i *models.ListItem) { i.Completed = true }), []string{"item.added", "item.checked"}, nil, map[string]string{"item.checked": "sys"}},
		{"archived counts as checked", with(func(i *models.ListItem) { i.IsArchived = true }), []string{"item.added", "item.checked"}, nil, nil},
		{"recorded actors are kept", with(func(i *models.ListItem) { i.Completed, i.CompletedBy = true, "sam" }), []string{"item.added", "item.checked"}, nil, map[string]string{"item.checked": "sam"}},
		{"created by instrumented code", with(func(i *models.ListItem) { i.CreatedBy = "mia" }), nil, []string{analytics.SkipLiveMarker}, nil},
		{"checked by instrumented code", with(func(i *models.ListItem) { i.Completed, i.CompletedAt = true, &done }), []string{"item.added"}, []string{analytics.SkipLiveMarker}, nil},
		{"fully live item", with(func(i *models.ListItem) { i.CreatedBy, i.Completed, i.CompletedAt = "mia", true, &done }), nil, []string{analytics.SkipLiveMarker, analytics.SkipLiveMarker}, nil},
		{"empty key", with(func(i *models.ListItem) { i.Description = "   " }), nil, []string{analytics.SkipEmptyKey}, nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			evs, skips := deriveItemEvents(tc.it, "sys")
			if !reflect.DeepEqual(names(evs), tc.wantNames) && !(len(evs) == 0 && len(tc.wantNames) == 0) {
				t.Fatalf("events %v, want %v", names(evs), tc.wantNames)
			}
			if !reflect.DeepEqual(skips, tc.wantSkips) {
				t.Fatalf("skips %v, want %v", skips, tc.wantSkips)
			}
			for _, e := range evs {
				if e.Key != "whole milk" {
					t.Fatalf("key %q: raw text or quantity leaked into the key", e.Key)
				}
				if want, ok := tc.wantActor[e.Name]; ok && e.ActorID != want {
					t.Fatalf("%s actor %q, want %q", e.Name, e.ActorID, want)
				}
				switch e.Name {
				case "item.added":
					if !e.OccurredAt.Equal(base.CreatedAt) {
						t.Fatalf("added at %v", e.OccurredAt)
					}
				case "item.checked":
					if !e.OccurredAt.Equal(base.UpdatedAt) {
						t.Fatalf("checked at %v, want updated_at as the proxy", e.OccurredAt)
					}
				}
			}
		})
	}
}

// The backfilled shape must not drift from what the live service emits for the same item.
func TestBackfilledItemEventsMatchLiveShape(t *testing.T) {
	m := memstore.Compose()
	us := NewUserService(m.Users, m.Rooms, m.Tx)
	ls := NewListService(m.Users, m.Rooms, m.Lists, m.Items, categorization.NewKeywordCategorizer(categorization.GroceryAnchors))
	reg := analytics.NewRegistry()
	RegisterAnalyticsEvents(reg)
	rec := analytics.NewMemRecorder(reg)
	ls.UseRecorder(rec)
	ctx := context.Background()

	cu, _ := us.CreateUserWithSoloRoom(ctx, "A")
	roomID := *cu.User.RoomID
	l, _ := ls.CreateList(ctx, cu.User, roomID, "Groceries", "", "")
	it, _ := ls.CreateItem(ctx, cu.User, roomID, l.ListID, "2 Whole MILK", "", "", "")
	_, _ = ls.UpdateItem(ctx, cu.User, roomID, l.ListID, it.ItemID, nil, boolPtr(true), nil, nil, nil, nil)
	live := rec.Events()

	stored, _ := m.Items.GetByID(ctx, it.ItemID)
	stored.CreatedBy, stored.CompletedAt, stored.CompletedBy = "", nil, "" // as if it predated the fields
	got, _ := deriveItemEvents(*stored, cu.User.UserID)

	shape := func(e analytics.Event) analytics.Event {
		return analytics.Event{Name: e.Name, ActorID: e.ActorID, RoomID: e.RoomID, Subject: e.Subject, Container: e.Container, Key: e.Key, Category: e.Category}
	}
	byName := map[string]analytics.Event{}
	for _, e := range live {
		byName[e.Name] = e
	}
	for _, g := range got {
		if !reflect.DeepEqual(shape(g), shape(byName[g.Name])) {
			t.Fatalf("%s drifted\nbackfill %+v\n    live %+v", g.Name, shape(g), shape(byName[g.Name]))
		}
	}
	if len(got) != 2 {
		t.Fatalf("derived %v", names(got))
	}

	listLive := byName["list.created"]
	if g := deriveListCreated(*l, cu.User.UserID); !reflect.DeepEqual(shape(g), shape(listLive)) {
		t.Fatalf("list.created drifted\nbackfill %+v\n    live %+v", shape(g), shape(listLive))
	}
}

func TestBackfillDirectoryAttributionAndZones(t *testing.T) {
	ctx := context.Background()
	m := memstore.Compose()
	now := bfT
	solo, shared, mixed := "solo", "shared", "mixed"
	_ = m.Users.Put(ctx, &models.User{UserID: "a", RoomID: &solo, TZ: "Europe/London", CreatedAt: now})
	_ = m.Users.Put(ctx, &models.User{UserID: "b", RoomID: &shared, TZ: "America/New_York", CreatedAt: now})
	_ = m.Users.Put(ctx, &models.User{UserID: "c", RoomID: &shared, TZ: "America/New_York", CreatedAt: now})
	_ = m.Users.Put(ctx, &models.User{UserID: "d", RoomID: &mixed, TZ: "Asia/Tokyo", CreatedAt: now})
	_ = m.Users.Put(ctx, &models.User{UserID: "e", RoomID: &mixed, CreatedAt: now}) // never seen a zone
	_ = m.Rooms.Put(ctx, &models.Room{RoomID: solo, MemberIDs: []string{"a"}, CreatedAt: now})
	_ = m.Rooms.Put(ctx, &models.Room{RoomID: shared, MemberIDs: []string{"b", "c"}, CreatedAt: now})
	_ = m.Rooms.Put(ctx, &models.Room{RoomID: mixed, MemberIDs: []string{"d", "e"}, CreatedAt: now})

	d := NewBackfillDirectory(m.NewBackfillReader())
	if err := d.ensure(ctx, ""); err != nil {
		t.Fatal(err)
	}
	if got := d.actorFor(solo); got != "a" {
		t.Fatalf("solo house attributes to its member, got %q", got)
	}
	if got := d.actorFor(shared); got != BackfillActor {
		t.Fatalf("shared house must not guess a person, got %q", got)
	}
	if got := d.actorFor("gone"); got != BackfillActor {
		t.Fatalf("unknown house: %q", got)
	}
	for _, tc := range []struct{ actor, room, want string }{
		{"a", solo, "Europe/London"},
		{BackfillActor, shared, "America/New_York"}, // every member agrees
		{BackfillActor, mixed, ""},                  // one member has no zone: unknown beats wrong
		{"nobody", solo, ""},
	} {
		if got := d.TZ(ctx, tc.actor, tc.room); got != tc.want {
			t.Fatalf("TZ(%s,%s)=%q want %q", tc.actor, tc.room, got, tc.want)
		}
	}
}

func TestBackfillEndToEndOverMemstore(t *testing.T) {
	ctx := context.Background()
	m := memstore.Compose()
	created := time.Date(2026, 5, 1, 9, 0, 0, 0, time.UTC)
	room := "room_1"
	_ = m.Users.Put(ctx, &models.User{UserID: "mia", RoomID: &room, TZ: "America/New_York", CreatedAt: created})
	_ = m.Rooms.Put(ctx, &models.Room{RoomID: room, MemberIDs: []string{"mia"}, CreatedAt: created})
	_ = m.Lists.Put(ctx, &models.List{ListID: "l1", RoomID: room, CreatedAt: created})
	_ = m.Items.Put(ctx, &models.ListItem{ItemID: "old", ListID: "l1", RoomID: room, Description: "milk", Category: "Dairy", Completed: true, CreatedAt: created, UpdatedAt: created.Add(time.Hour)})
	_ = m.Items.Put(ctx, &models.ListItem{ItemID: "live", ListID: "l1", RoomID: room, Description: "eggs", CreatedBy: "mia", CreatedAt: created, UpdatedAt: created})

	reg := analytics.NewRegistry()
	RegisterAnalyticsEvents(reg)
	d := NewBackfillDirectory(m.NewBackfillReader())
	b := analytics.NewBackfill(m.Events, reg, nil, d.Sources()...)

	env := analytics.BackfillEnv{Before: created.AddDate(0, 1, 0), Retention: 400 * 24 * time.Hour, Now: created.AddDate(0, 2, 0), TZ: d.TZ}
	rep, err := b.Run(ctx, env, analytics.BackfillOptions{Apply: true})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int{"user.signed_up": 1, "house.created": 1, "list.created": 1, "item.added": 1, "item.checked": 1}
	if !reflect.DeepEqual(rep.ByName, want) || rep.Skipped[analytics.SkipLiveMarker] != 1 || rep.UTCFallback != 0 {
		t.Fatalf("report: %+v", rep)
	}
	for _, e := range m.Events.All() {
		if e.ActorID != "mia" || e.Source != analytics.SourceBackfill || e.Local.TZ != "America/New_York" {
			t.Fatalf("event %s: actor=%q source=%q tz=%q", e.EventID, e.ActorID, e.Source, e.Local.TZ)
		}
	}

	// Scoped to another house: nothing to do.
	other, err := b.Run(ctx, env, analytics.BackfillOptions{RoomID: "room_zzz"})
	if err != nil || other.Emitted != 0 {
		t.Fatalf("scoped run: %+v %v", other, err)
	}
}

// Backfilled trip events must match what the live op pipeline emits for the same trip.
func TestBackfilledTripEventsMatchLiveShape(t *testing.T) {
	e := newTripEnv(t)
	rec := tripRecorder(t, e)
	ctx := analytics.WithTZ(context.Background(), "UTC")
	start := time.Now().UTC().AddDate(0, 0, 5).Format("2006-01-02")
	batch := []json.RawMessage{
		opJSON(t, "dev-a", 1, "trip.create", "", map[string]any{"title": "Japan", "start_date": start, "end_date": start}),
		opJSON(t, "dev-a", 2, "todo.create", svcTodoID("1"), map[string]any{"title": "Ramen", "category": "food"}),
		opJSON(t, "dev-a", 3, "todo.update", svcTodoID("1"), map[string]any{"done": true}),
	}
	if _, err := e.svc.ApplyOps(ctx, e.ua, "room_1", batch); err != nil {
		t.Fatal(err)
	}
	live := map[string]analytics.Event{}
	for _, ev := range rec.Events() {
		live[ev.Name] = ev
	}

	stored, err := e.repos.Trips.Get(ctx, svcTripID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Todos[0].DoneAt == nil {
		t.Fatal("the live service must stamp done_at for the backfill to skip it later")
	}
	src := trips.NewBackfillSource(func(_ context.Context, _ string, fn func(models.Trip) error) error { return fn(*stored) })
	var got []analytics.Event
	env := analytics.BackfillEnv{TZ: func(context.Context, string, string) string { return "UTC" }}
	if err := src.Each(ctx, env, func(ev analytics.Event, _ string) error { got = append(got, ev); return nil }); err != nil {
		t.Fatal(err)
	}

	shape := func(ev analytics.Event) analytics.Event {
		return analytics.Event{Name: ev.Name, ActorID: ev.ActorID, RoomID: ev.RoomID, Subject: ev.Subject, Container: ev.Container, Key: ev.Key, Category: ev.Category, Props: ev.Props}
	}
	if len(got) != 2 {
		t.Fatalf("derived %v", names(got))
	}
	for _, g := range got {
		if !reflect.DeepEqual(shape(g), shape(live[g.Name])) {
			t.Fatalf("%s drifted\nbackfill %+v\n    live %+v", g.Name, shape(g), shape(live[g.Name]))
		}
	}
}
