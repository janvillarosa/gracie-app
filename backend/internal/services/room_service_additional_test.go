package services

import (
	"context"
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func TestRoomJoinByTokenAndCancelVote(t *testing.T) {
	m := memstore.Compose()
	tx, users, rooms := m.Tx, m.Users, m.Rooms
	us := NewUserService(users, rooms, tx)
	rs := NewRoomService(users, rooms, tx)

	ctx := context.Background()
	a, _ := us.CreateUserWithSoloRoom(ctx, "A")
	b, _ := us.CreateUserWithSoloRoom(ctx, "B")

	// Set share token
	tok, err := rs.RotateShareToken(ctx, a.User)
	if err != nil || tok == "" {
		t.Fatalf("rotate: %v %q", err, tok)
	}

	// Join by token (no room_id exposed)
	if _, err := rs.JoinRoomByToken(ctx, b.User, tok); err != nil {
		t.Fatalf("join by token: %v", err)
	}

	// Cancel deletion vote (no votes yet -> no error)
	if err := rs.CancelDeletionVote(ctx, a.User); err != nil {
		t.Fatalf("cancel vote: %v", err)
	}
}

// Opening the invite must not invalidate a code already handed out: the current code is
// returned as is, and a new one is minted only when none exists (a new House, or after a join).
func TestCurrentShareTokenKeepsTheCodeUntilRotatedOrUsed(t *testing.T) {
	m := memstore.Compose()
	us := NewUserService(m.Users, m.Rooms, m.Tx)
	rs := NewRoomService(m.Users, m.Rooms, m.Tx)
	ctx := context.Background()
	a, _ := us.CreateUserWithSoloRoom(ctx, "A")
	b, _ := us.CreateUserWithSoloRoom(ctx, "B")

	first, err := rs.CurrentShareToken(ctx, a.User)
	if err != nil || first == "" {
		t.Fatalf("current: %v %q", err, first)
	}
	again, err := rs.CurrentShareToken(ctx, a.User)
	if err != nil || again != first {
		t.Fatalf("second read changed the code: %q -> %q (%v)", first, again, err)
	}

	rotated, err := rs.RotateShareToken(ctx, a.User)
	if err != nil || rotated == first {
		t.Fatalf("rotate: %v %q", err, rotated)
	}
	if now, _ := rs.CurrentShareToken(ctx, a.User); now != rotated {
		t.Fatalf("current after rotate = %q, want %q", now, rotated)
	}

	// The code is single use: after B joins, the next read mints a fresh one.
	if _, err := rs.JoinRoomByToken(ctx, b.User, rotated); err != nil {
		t.Fatalf("join: %v", err)
	}
	fresh, err := rs.CurrentShareToken(ctx, a.User)
	if err != nil || fresh == "" || fresh == rotated {
		t.Fatalf("after join: %v %q", err, fresh)
	}
}

func TestCurrentShareTokenNeedsAHouse(t *testing.T) {
	m := memstore.Compose()
	rs := NewRoomService(m.Users, m.Rooms, m.Tx)
	if _, err := rs.CurrentShareToken(context.Background(), &models.User{UserID: "u"}); err == nil {
		t.Fatal("want an error for a user without a House")
	}
}
