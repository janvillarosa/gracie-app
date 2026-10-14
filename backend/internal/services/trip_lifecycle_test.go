package services

import (
	"context"
	"errors"
	"testing"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func TestJoinRoomMovesSoloTripsAndCleanupDeletesTrips(t *testing.T) {
	ctx := context.Background()
	m := memstore.Compose()
	us := NewUserService(m.Users, m.Rooms, m.Tx)
	rs := NewRoomService(m.Users, m.Rooms, m.Tx)
	rs.UseListRepos(m.Lists, m.Items)
	rs.UseTripRepo(m.Trips)

	a, _ := us.CreateUserWithSoloRoom(ctx, "A")
	b, _ := us.CreateUserWithSoloRoom(ctx, "B")
	bSolo := *b.User.RoomID
	now := time.Now().UTC()
	_ = m.Trips.Insert(ctx, &models.Trip{TripID: "trip_b", RoomID: bSolo, Version: 1, CreatedAt: now, UpdatedAt: now})

	tok, err := rs.RotateShareToken(ctx, a.User)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := rs.JoinRoom(ctx, b.User, *a.User.RoomID, tok); err != nil {
		t.Fatal(err)
	}
	moved, err := m.Trips.Get(ctx, "trip_b")
	if err != nil || moved.RoomID != *a.User.RoomID || moved.Version != 2 {
		t.Fatalf("solo trip should move into the shared house and bump version: %+v %v", moved, err)
	}

	rs.cleanupRoomResources(ctx, *a.User.RoomID)
	if _, err := m.Trips.Get(ctx, "trip_b"); !errors.Is(err, derr.ErrNotFound) {
		t.Fatalf("room cleanup must delete its trips, got %v", err)
	}
}

func TestUserServiceCleanupDeletesTrips(t *testing.T) {
	ctx := context.Background()
	m := memstore.Compose()
	us := NewUserService(m.Users, m.Rooms, m.Tx)
	us.UseListRepos(m.Lists, m.Items)
	us.UseTripRepo(m.Trips)
	_ = m.Trips.Insert(ctx, &models.Trip{TripID: "trip_x", RoomID: "room_z", Version: 1})
	us.cleanupRoomResources(ctx, "room_z")
	if _, err := m.Trips.Get(ctx, "trip_x"); !errors.Is(err, derr.ErrNotFound) {
		t.Fatalf("user-service cleanup must delete trips, got %v", err)
	}
}
