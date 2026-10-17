package services

import (
	"context"
	"reflect"
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func TestListAndItemEventsEmitted(t *testing.T) {
	m := memstore.Compose()
	us := NewUserService(m.Users, m.Rooms, m.Tx)
	rs := NewRoomService(m.Users, m.Rooms, m.Tx)
	ls := NewListService(m.Users, m.Rooms, m.Lists, m.Items, categorization.NewKeywordCategorizer(categorization.GroceryAnchors))
	rs.UseListRepos(m.Lists, m.Items)
	reg := analytics.NewRegistry()
	RegisterAnalyticsEvents(reg)
	rec := analytics.NewMemRecorder(reg)
	ls.UseRecorder(rec)
	ctx := analytics.WithTZ(context.Background(), "America/New_York")

	cu, _ := us.CreateUserWithSoloRoom(ctx, "A")
	roomID := *cu.User.RoomID
	l, _ := ls.CreateList(ctx, cu.User, roomID, "Groceries", "", "")
	it, _ := ls.CreateItem(ctx, cu.User, roomID, l.ListID, "  Whole   MILK ", "", "", "")

	// Re-sending the same state is not a behavior event.
	_, _ = ls.UpdateItem(ctx, cu.User, roomID, l.ListID, it.ItemID, nil, boolPtr(false), nil, nil, nil, nil)
	_, _ = ls.UpdateItem(ctx, cu.User, roomID, l.ListID, it.ItemID, nil, boolPtr(true), nil, nil, nil, nil)
	_, _ = ls.UpdateItem(ctx, cu.User, roomID, l.ListID, it.ItemID, nil, boolPtr(false), nil, nil, nil, nil)
	_, _ = ls.UpdateItem(ctx, cu.User, roomID, l.ListID, it.ItemID, nil, boolPtr(true), nil, nil, nil, nil)
	_, _ = ls.UpdateItem(ctx, cu.User, roomID, l.ListID, it.ItemID, strPtr("2% milk"), nil, strPtr("2"), nil, nil, boolPtr(true))
	_ = ls.ArchiveCompletedItems(ctx, cu.User, roomID, l.ListID)
	_ = ls.ArchiveCompletedItems(ctx, cu.User, roomID, l.ListID) // nothing left: no event
	_ = ls.DeleteItem(ctx, cu.User, roomID, l.ListID, it.ItemID)

	want := []string{
		"list.created", "item.added",
		"item.checked", "item.unchecked", "item.checked",
		"item.starred", "item.edited",
		"list.cleared", "item.deleted",
	}
	if got := rec.Names(); !reflect.DeepEqual(got, want) {
		t.Fatalf("events\n got %v\nwant %v", got, want)
	}

	evs := rec.Events()
	added := evs[1]
	if added.Key != "whole milk" || added.ActorID != cu.User.UserID || added.RoomID != roomID ||
		added.Subject != (analytics.Ref{Type: "item", ID: it.ItemID}) ||
		added.Container == nil || *added.Container != (analytics.Ref{Type: "list", ID: l.ListID}) ||
		added.Source != analytics.SourceServer || added.Local.TZ != "America/New_York" {
		t.Fatalf("added envelope: %+v", added)
	}
	if edited := evs[6]; edited.Props["fields"] != "description,quantity" || edited.Key != "2% milk" {
		t.Fatalf("edited: %+v", edited)
	}
	if cleared := evs[7]; cleared.Props["count"] != int64(1) {
		t.Fatalf("cleared: %+v", cleared)
	}
}

func TestEmitWithoutRecorderIsNoop(t *testing.T) {
	m := memstore.Compose()
	us := NewUserService(m.Users, m.Rooms, m.Tx)
	ls := NewListService(m.Users, m.Rooms, m.Lists, m.Items, categorization.NewKeywordCategorizer(categorization.GroceryAnchors))
	cu, _ := us.CreateUserWithSoloRoom(context.Background(), "A")
	if _, err := ls.CreateList(context.Background(), cu.User, *cu.User.RoomID, "x", "", ""); err != nil {
		t.Fatal(err)
	}
}

func TestItemAddedRecordsParsedQuantityNeverText(t *testing.T) {
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
	cases := []struct {
		desc, qty, unit string
		milli           any
		wantUnit        any
	}{
		{"milk", "2", "", int64(2000), "count"},
		{"rice", "1.5 kg", "", int64(1500), "kg"},
		{"flour", "1.5", "kg", int64(1500), "kg"},
		{"2 bottles milk", "", "", int64(2000), "bottle"},
		{"bread", "a few", "", nil, nil},
		{"eggs", "", "", nil, nil},
	}
	for _, c := range cases {
		if _, err := ls.CreateItem(ctx, cu.User, roomID, l.ListID, c.desc, c.qty, c.unit, ""); err != nil {
			t.Fatal(err)
		}
	}
	var adds []analytics.Event
	for _, e := range rec.Events() {
		if e.Name == "item.added" {
			adds = append(adds, e)
		}
	}
	for i, c := range cases {
		e := adds[i]
		if e.Props["qty"] != c.milli || e.Props["unit"] != c.wantUnit {
			t.Errorf("%q %q %q: props %v", c.desc, c.qty, c.unit, e.Props)
		}
		for k, v := range e.Props {
			if s, ok := v.(string); ok && (s == c.qty || s == c.desc) && s != "" {
				t.Errorf("typed text %q leaked as %s", s, k)
			}
		}
	}
	if adds[0].Key != "milk" || adds[3].Key != "milk" {
		t.Fatalf("the key is unchanged by the amount: %q %q", adds[0].Key, adds[3].Key)
	}
}
