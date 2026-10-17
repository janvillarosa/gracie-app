package services

import (
	"context"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func TestAwayCalendarUsesCurrentMembersAndHouseZone(t *testing.T) {
	ctx := context.Background()
	m := memstore.Compose()
	_ = m.Rooms.Put(ctx, &models.Room{RoomID: "room_1", MemberIDs: []string{"user_a", "user_b"}})
	_ = m.Users.Put(ctx, &models.User{UserID: "user_a", TZ: "America/New_York"})
	_ = m.Users.Put(ctx, &models.User{UserID: "user_b"})
	put := func(id, start, end string, travellers ...string) {
		tr := &models.Trip{TripID: id, RoomID: "room_1", Version: 1}
		tr.StartDate, tr.EndDate, tr.Travellers = &start, &end, travellers
		if err := m.Trips.Insert(ctx, tr); err != nil {
			t.Fatal(err)
		}
	}
	put("trip_1", "2026-01-10", "2026-01-11")           // the whole house
	put("trip_2", "2026-02-01", "2026-02-05", "user_a") // a solo trip
	put("trip_3", "2026-03-01", "2026-03-05", "user_a", "user_b")
	del := &models.Trip{TripID: "trip_4", RoomID: "room_1", Version: 1}
	s, e := "2026-04-01", "2026-04-05"
	del.StartDate, del.EndDate = &s, &e
	now := time.Now()
	del.DeletedAt = &now
	_ = m.Trips.Insert(ctx, del)

	cal := NewAwayCalendar(m.Rooms, m.Users, m.Trips)
	house, err := cal.HouseAway(ctx, "room_1")
	if err != nil {
		t.Fatal(err)
	}
	if len(house) != 2 {
		t.Fatalf("two house-away spans (the solo and the deleted trip don't count): %v", house)
	}
	// The house zone is user_a's: New York midnight is 05:00 UTC in January.
	if want := time.Date(2026, 1, 10, 5, 0, 0, 0, time.UTC); !house[0].Opens.Equal(want) {
		t.Fatalf("opens %v, want %v", house[0].Opens, want)
	}
	solo, _ := cal.MemberAway(ctx, "room_1", "user_a")
	if len(solo) != 3 {
		t.Fatalf("user_a is away on three trips: %v", solo)
	}
	if out, _ := cal.MemberAway(ctx, "room_1", "user_x"); out != nil {
		t.Fatalf("not a member: %v", out)
	}
	if out, err := cal.HouseAway(ctx, "room_gone"); out != nil || err != nil {
		t.Fatalf("a missing room is never away: %v %v", out, err)
	}
}
