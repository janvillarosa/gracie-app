package services

import (
	"context"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

// ensureRoomMembership verifies the user belongs to roomID and the room lists them.
func ensureRoomMembership(ctx context.Context, rooms store.RoomRepository, user *models.User, roomID string) error {
	if user.RoomID == nil || *user.RoomID == "" || *user.RoomID != roomID {
		return derr.ErrForbidden
	}
	rm, err := rooms.GetByID(ctx, roomID)
	if err != nil {
		return err
	}
	for _, mid := range rm.MemberIDs {
		if mid == user.UserID {
			return nil
		}
	}
	return derr.ErrForbidden
}
