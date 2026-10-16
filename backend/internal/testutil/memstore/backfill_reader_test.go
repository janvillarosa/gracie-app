package memstore

import (
	"context"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func TestBackfillReaderFiltersByRoomAndStripsCredentials(t *testing.T) {
	ctx := context.Background()
	r := Compose()
	now := time.Now()
	room := "room_a"
	other := "room_b"
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(r.Users.Put(ctx, &models.User{UserID: "u2", Name: "Mia", Username: "mia", PasswordEnc: "secret", APIKeyHash: "h", APIKeyLookup: "l", RoomID: &room, CreatedAt: now}))
	must(r.Users.Put(ctx, &models.User{UserID: "u1", RoomID: &other, CreatedAt: now}))
	must(r.Rooms.Put(ctx, &models.Room{RoomID: room, MemberIDs: []string{"u2"}, CreatedAt: now}))
	must(r.Rooms.Put(ctx, &models.Room{RoomID: other, CreatedAt: now}))
	must(r.Lists.Put(ctx, &models.List{ListID: "l1", RoomID: room, CreatedAt: now}))
	must(r.Items.Put(ctx, &models.ListItem{ItemID: "i1", ListID: "l1", RoomID: room, Description: "milk", CreatedAt: now}))
	must(r.Items.Put(ctx, &models.ListItem{ItemID: "i2", ListID: "l9", RoomID: other, CreatedAt: now}))
	must(r.Trips.Insert(ctx, &models.Trip{TripID: "t1", RoomID: room, CreatedAt: now}))

	br := r.NewBackfillReader()
	count := func(f func(fn func() error) error) int {
		n := 0
		must(f(func() error { n++; return nil }))
		return n
	}
	if n := count(func(fn func() error) error {
		return br.EachItem(ctx, "", func(models.ListItem) error { return fn() })
	}); n != 2 {
		t.Fatalf("all items: %d", n)
	}
	var got []models.ListItem
	must(br.EachItem(ctx, room, func(it models.ListItem) error { got = append(got, it); return nil }))
	if len(got) != 1 || got[0].ItemID != "i1" {
		t.Fatalf("room items: %+v", got)
	}
	var users []models.User
	must(br.EachUser(ctx, room, func(u models.User) error { users = append(users, u); return nil }))
	if len(users) != 1 || users[0].UserID != "u2" {
		t.Fatalf("room users: %+v", users)
	}
	if u := users[0]; u.PasswordEnc != "" || u.APIKeyHash != "" || u.APIKeyLookup != "" || u.Username != "" || u.Name != "" {
		t.Fatalf("credentials or identity leaked: %+v", u)
	}
	if n := count(func(fn func() error) error {
		return br.EachTrip(ctx, room, func(models.Trip) error { return fn() })
	}); n != 1 {
		t.Fatalf("room trips: %d", n)
	}
	// An error from the callback stops the walk and is returned.
	stop := context.Canceled
	if err := br.EachRoom(ctx, "", func(models.Room) error { return stop }); err != stop {
		t.Fatalf("want callback error, got %v", err)
	}
}
