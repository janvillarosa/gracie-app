package services

import (
	"context"
	"testing"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func seedAction(t *testing.T, m memstore.Repos, id, roomID string) {
	t.Helper()
	if err := m.Autopilot.Insert(context.Background(), &models.AutopilotAction{ActionID: id, RoomID: roomID, Kind: "restock", Key: "milk", Cycle: "c", State: models.ActionApplied, CreatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
}

func TestDeletedHouseTakesItsAutopilotActions(t *testing.T) {
	m := memstore.Compose()
	ctx := context.Background()
	us := NewUserService(m.Users, m.Rooms, m.Tx)
	rs := NewRoomService(m.Users, m.Rooms, m.Tx)
	rs.UseAutopilotActions(m.Autopilot)
	us.UseAutopilotActions(m.Autopilot)
	host, _ := us.CreateUserWithSoloRoom(ctx, "Host")
	guest, _ := us.CreateUserWithSoloRoom(ctx, "Guest")
	seedAction(t, m, "host_1", *host.User.RoomID)
	seedAction(t, m, "guest_1", *guest.User.RoomID)

	// Joining dissolves the guest's solo house, and its actions with it.
	token, _ := rs.RotateShareToken(ctx, host.User)
	if _, err := rs.JoinRoomByToken(ctx, guest.User, token); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Autopilot.GetByID(ctx, "guest_1"); err != derr.ErrNotFound {
		t.Fatalf("solo house action kept: %v", err)
	}
	if _, err := m.Autopilot.GetByID(ctx, "host_1"); err != nil {
		t.Fatalf("host action lost on join: %v", err)
	}
	// Deleting a house (either path) removes the rest.
	rs.cleanupRoomResources(ctx, *host.User.RoomID)
	if _, err := m.Autopilot.GetByID(ctx, "host_1"); err != derr.ErrNotFound {
		t.Fatalf("deleted house action kept: %v", err)
	}
	seedAction(t, m, "other_1", "room_x")
	us.cleanupRoomResources(ctx, "room_x")
	if _, err := m.Autopilot.GetByID(ctx, "other_1"); err != derr.ErrNotFound {
		t.Fatalf("account deletion path kept the action: %v", err)
	}
}
