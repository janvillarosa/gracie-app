package services

import (
	"context"
	"testing"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func TestListValidationsAndFilters(t *testing.T) {
	m := memstore.Compose()
	tx, users, rooms, lists, items := m.Tx, m.Users, m.Rooms, m.Lists, m.Items
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

func TestGetPantryRanksHouseHistoryAndSeedsCommon(t *testing.T) {
	m := memstore.Compose()
	tx, users, rooms, lists, items := m.Tx, m.Users, m.Rooms, m.Lists, m.Items
	us := NewUserService(users, rooms, tx)
	ls := NewListService(users, rooms, lists, items, categorization.NewKeywordCategorizer(categorization.GroceryAnchors))
	ctx := context.Background()

	cu, _ := us.CreateUserWithSoloRoom(ctx, "A")
	roomID := *cu.User.RoomID
	l, _ := ls.CreateList(ctx, cu.User, roomID, "Groceries", "", "")
	for _, d := range []string{"Oat milk", "oat  milk", "Bananas", "Oat milk"} {
		if _, err := ls.CreateItem(ctx, cu.User, roomID, l.ListID, d, "", "", ""); err != nil {
			t.Fatalf("create %q: %v", d, err)
		}
	}

	got, err := ls.GetPantry(ctx, cu.User, roomID)
	if err != nil {
		t.Fatalf("pantry: %v", err)
	}
	if got[0].TimesAdded != 3 || got[1].TimesAdded != 1 || got[0].Common {
		t.Fatalf("history should lead, ranked by count: %+v", got[:2])
	}
	if !got[len(got)-1].Common {
		t.Fatalf("sparse house should be padded with common items")
	}
	for _, p := range got {
		if p.Common && (p.Description == "Bananas" || p.Description == "Oat milk") {
			t.Fatalf("common set duplicated a house item: %+v", p)
		}
	}
}

// usualOf builds same-key items newest first from "qty unit" pairs ("" for none) and returns the
// pantry entry pantryByKey makes of them.
func usualOf(t *testing.T, pairs ...[2]string) *PantryItem {
	t.Helper()
	base := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	items := make([]models.ListItem, len(pairs))
	for i, p := range pairs {
		items[i] = models.ListItem{Description: "Milk", Category: "Dairy", Quantity: p[0], Unit: p[1], CreatedAt: base.Add(-time.Duration(i) * 24 * time.Hour)}
	}
	items[0].Category = "Fridge" // the newest add's category must win
	byKey, _ := pantryByKey(items)
	return byKey["milk"]
}

func TestPantryUsualQuantity(t *testing.T) {
	q := func(s string) [2]string { return [2]string{s, ""} }
	cases := []struct {
		name      string
		pairs     [][2]string
		qty, unit string
	}{
		{"most common wins", [][2]string{q("6"), q("2"), q("2"), q("2")}, "2", ""},
		{"tie goes to the most recent", [][2]string{q("6"), q("2"), q("6"), q("2")}, "6", ""},
		{"usually typed without a quantity", [][2]string{q("2"), q(""), q(""), q("")}, "", ""},
		{"only the last 10 adds count", append(repeat([2]string{"1", "kg"}, 10), [2]string{"5", "kg"}, [2]string{"5", "kg"}), "1", "kg"},
		{"older habit outside the window", append(repeat([2]string{"1", "l"}, 3), repeat([2]string{"2", "l"}, 9)...), "2", "l"},
		{"unit is part of the pair", [][2]string{{"1", "l"}, {"1", "gal"}, {"1", "gal"}}, "1", "gal"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := usualOf(t, c.pairs...)
			if p == nil || p.Quantity != c.qty || p.Unit != c.unit {
				t.Fatalf("got %+v want %q %q", p, c.qty, c.unit)
			}
			if p.Category != "Fridge" || p.TimesAdded != len(c.pairs) {
				t.Fatalf("description/category from the newest add, all adds counted: %+v", p)
			}
		})
	}
}

func repeat(p [2]string, n int) [][2]string {
	out := make([][2]string, n)
	for i := range out {
		out[i] = p
	}
	return out
}
