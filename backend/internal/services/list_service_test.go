package services

import (
	"context"
	"testing"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func TestListValidationsAndFilters(t *testing.T) {
	tx, users, rooms, lists, items := memstore.Compose()
	us := NewUserService(users, rooms, tx)
	rs := NewRoomService(users, rooms, tx)
	ls := NewListService(users, rooms, lists, items, categorization.NewKeywordCategorizer(categorization.GroceryAnchors))
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
	if err != nil {
		t.Fatalf("create list: %v", err)
	}

	// Update list invalid icon
	_, err = ls.UpdateList(ctx, cu.User, roomID, l.ListID, nil, nil, strPtr("BAD"), nil)
	if err != derr.ErrBadRequest {
		t.Fatalf("want bad request on invalid update icon")
	}

	// Create items
	it1, _ := ls.CreateItem(ctx, cu.User, roomID, l.ListID, "Milk", "", "", "")
	_, _ = ls.CreateItem(ctx, cu.User, roomID, l.ListID, "Bread", "", "", "")
	// Complete one
	_, _ = ls.UpdateItem(ctx, cu.User, roomID, l.ListID, it1.ItemID, nil, boolPtr(true), nil, nil, nil, nil)

	// List include_completed=false should return only one
	itemsOnlyIncomplete, _ := ls.ListItems(ctx, cu.User, roomID, l.ListID, false)
	if len(itemsOnlyIncomplete) != 1 {
		t.Fatalf("want 1 incomplete item, got %d", len(itemsOnlyIncomplete))
	}
}

func strPtr(s string) *string { return &s }
func boolPtr(b bool) *bool    { return &b }

func TestNormalizeLegacyItemForRead(t *testing.T) {
	// Legacy row: quantity baked into description, empty Quantity field.
	legacy := models.ListItem{Description: "2 lbs chicken breast", Quantity: "", Unit: ""}
	got := normalizeItemForRead(legacy)
	if got.Description != "chicken breast" || got.Quantity != "2" || got.Unit != "lbs" {
		t.Fatalf("legacy normalize = (%q,%q,%q), want (chicken breast,2,lbs)", got.Description, got.Quantity, got.Unit)
	}

	// Already-split row: must be left untouched (no double-strip).
	split := models.ListItem{Description: "chicken breast", Quantity: "2", Unit: "lbs"}
	got2 := normalizeItemForRead(split)
	if got2.Description != "chicken breast" || got2.Quantity != "2" || got2.Unit != "lbs" {
		t.Fatalf("split normalize changed item: (%q,%q,%q)", got2.Description, got2.Quantity, got2.Unit)
	}

	// Plain description, no quantity: unchanged.
	plain := models.ListItem{Description: "bell peppers", Quantity: "", Unit: ""}
	got3 := normalizeItemForRead(plain)
	if got3.Description != "bell peppers" || got3.Quantity != "" || got3.Unit != "" {
		t.Fatalf("plain normalize changed item: (%q,%q,%q)", got3.Description, got3.Quantity, got3.Unit)
	}
}
