package services

import (
	"context"
	"errors"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
)

// AwayCalendar adapts a house's trips to analytics.AwayCalendar: it is how trips reach the
// analytics engine without analytics importing them. It reads the room's current members and the
// room's trips on every call; the analytics worker caches the answer for one fold tick.
type AwayCalendar struct {
	rooms store.RoomRepository
	users store.UserRepository
	trips store.TripRepository
}

func NewAwayCalendar(rooms store.RoomRepository, users store.UserRepository, tripRepo store.TripRepository) *AwayCalendar {
	return &AwayCalendar{rooms: rooms, users: users, trips: tripRepo}
}

// HouseAway is when every current member of the room is away.
func (c *AwayCalendar) HouseAway(ctx context.Context, roomID string) (predict.Away, error) {
	rm, ts, tz, err := c.load(ctx, roomID)
	if err != nil || rm == nil {
		return nil, err
	}
	return trips.HouseAway(ts, rm.MemberIDs, tz), nil
}

// MemberAway is when one member of the room is away; nil for someone who is not a member.
func (c *AwayCalendar) MemberAway(ctx context.Context, roomID, userID string) (predict.Away, error) {
	rm, ts, tz, err := c.load(ctx, roomID)
	if err != nil || rm == nil {
		return nil, err
	}
	for _, m := range rm.MemberIDs {
		if m == userID {
			return trips.MemberAway(ts, userID, tz), nil
		}
	}
	return nil, nil
}

// load reads the room, its trips and the house's zone. A room that no longer exists is never away.
func (c *AwayCalendar) load(ctx context.Context, roomID string) (*models.Room, []models.Trip, string, error) {
	rm, err := c.rooms.GetByID(ctx, roomID)
	if errors.Is(err, derr.ErrNotFound) {
		return nil, nil, "", nil
	}
	if err != nil {
		return nil, nil, "", err
	}
	stubs, err := c.trips.Manifest(ctx, roomID)
	if err != nil {
		return nil, nil, "", err
	}
	ids := make([]string, 0, len(stubs))
	for _, s := range stubs {
		if s.DeletedAt == nil {
			ids = append(ids, s.TripID)
		}
	}
	var ts []models.Trip
	if len(ids) > 0 {
		if ts, err = c.trips.GetMany(ctx, roomID, ids); err != nil {
			return nil, nil, "", err
		}
	}
	return rm, ts, c.houseTZ(ctx, rm), nil
}

// houseTZ is the zone of the first member (in join order) whose last-seen zone is known. Rooms
// have no zone of their own; a trip's own zone wins over this one.
func (c *AwayCalendar) houseTZ(ctx context.Context, rm *models.Room) string {
	for _, id := range rm.MemberIDs {
		if u, err := c.users.GetByID(ctx, id); err == nil && u.TZ != "" {
			return u.TZ
		}
	}
	return ""
}
