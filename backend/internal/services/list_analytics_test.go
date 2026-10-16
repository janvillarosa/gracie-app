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
