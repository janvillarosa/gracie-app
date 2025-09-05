package services

import (
    "context"
    "testing"

    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func TestListValidationsAndFilters(t *testing.T) {
    tx, users, rooms, lists, items := memstore.Compose()
    us := NewUserService(users, rooms, tx)
    rs := NewRoomService(users, rooms, tx)
    ls := NewListService(users, rooms, lists, items)
    rs.UseListRepos(lists, items)
    ctx := context.Background()

    cu, _ := us.CreateUserWithSoloRoom(ctx, "A")
    roomID := *cu.User.RoomID

    // Create invalid name
    if _, err := ls.CreateList(ctx, cu.User, roomID, "", "", ""); err != derr.ErrBadRequest {
        t.Fatalf("want bad request on empty name")
    }
    // Invalid icon
    if _, err := ls.CreateList(ctx, cu.User, roomID, "Groceries", "", "BAD"); err != derr.ErrBadRequest {
        t.Fatalf("want bad request on invalid icon")
    }
    // Create valid list
    l, err := ls.CreateList(ctx, cu.User, roomID, "Groceries", "Weekly", "HOUSE")
    if err != nil { t.Fatalf("create list: %v", err) }

    // Update list invalid icon
    _, err = ls.UpdateList(ctx, cu.User, roomID, l.ListID, nil, nil, strPtr("BAD"))
    if err != derr.ErrBadRequest { t.Fatalf("want bad request on invalid update icon") }

    // Create items
    it1, _ := ls.CreateItem(ctx, cu.User, roomID, l.ListID, "Milk")
    _, _ = ls.CreateItem(ctx, cu.User, roomID, l.ListID, "Bread")
    // Complete one
    _, _ = ls.UpdateItem(ctx, cu.User, roomID, l.ListID, it1.ItemID, nil, boolPtr(true))

    // List include_completed=false should return only one
    itemsOnlyIncomplete, _ := ls.ListItems(ctx, cu.User, roomID, l.ListID, false)
    if len(itemsOnlyIncomplete) != 1 { t.Fatalf("want 1 incomplete item, got %d", len(itemsOnlyIncomplete)) }
}

func strPtr(s string) *string { return &s }
func boolPtr(b bool) *bool { return &b }

