package services

import (
    "context"
    "testing"

    "github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func TestRoomJoinByTokenAndCancelVote(t *testing.T) {
    tx, users, rooms, _, _ := memstore.Compose()
    us := NewUserService(users, rooms, tx)
    rs := NewRoomService(users, rooms, tx)

    ctx := context.Background()
    a, _ := us.CreateUserWithSoloRoom(ctx, "A")
    b, _ := us.CreateUserWithSoloRoom(ctx, "B")

    // Set share token
    tok, err := rs.RotateShareToken(ctx, a.User)
    if err != nil || tok == "" { t.Fatalf("rotate: %v %q", err, tok) }

    // Join by token (no room_id exposed)
    if _, err := rs.JoinRoomByToken(ctx, b.User, tok); err != nil { t.Fatalf("join by token: %v", err) }

    // Cancel deletion vote (no votes yet -> no error)
    if err := rs.CancelDeletionVote(ctx, a.User); err != nil { t.Fatalf("cancel vote: %v", err) }
}

