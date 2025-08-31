package services

import (
    "context"
    "testing"
    "time"

    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/store/dynamo"
    "github.com/janvillarosa/gracie-app/backend/internal/testutil"
)

func setupSvc(t *testing.T) (*UserService, *RoomService, func()) {
    db, usersTable, roomsTable, cleanup := testutil.SetupDynamoOrSkip(t)
    client := &dynamo.Client{DB: db, Tables: dynamo.Tables{Users: usersTable, Rooms: roomsTable}}
    users := dynamo.NewUserRepo(client)
    rooms := dynamo.NewRoomRepo(client)
    return NewUserService(client, users), NewRoomService(client, users, rooms), cleanup
}

func TestUserSignupAndSoloRoom(t *testing.T) {
    us, _, cleanup := setupSvc(t)
    defer cleanup()
    cu, err := us.CreateUserWithSoloRoom(context.Background(), "Alice")
    if err != nil { t.Fatalf("create: %v", err) }
    if cu.APIKey == "" || cu.User.RoomID == nil || *cu.User.RoomID == "" { t.Fatalf("expected key and room id") }
}

func TestShareJoinAndDeleteFlow(t *testing.T) {
    us, rs, cleanup := setupSvc(t)
    defer cleanup()
    ctx := context.Background()

    a, _ := us.CreateUserWithSoloRoom(ctx, "A")
    b, _ := us.CreateUserWithSoloRoom(ctx, "B")

    tok, err := rs.RotateShareToken(ctx, a.User)
    if err != nil { t.Fatalf("rotate: %v", err) }

    // Join B into A's room
    room, err := rs.JoinRoom(ctx, b.User, *a.User.RoomID, tok)
    if err != nil { t.Fatalf("join: %v", err) }
    if len(room.MemberIDs) != 2 { t.Fatalf("expected 2 members, got %d", len(room.MemberIDs)) }

    // Second join attempt should fail (room full)
    if _, err := rs.JoinRoom(ctx, a.User, room.RoomID, tok); err == nil {
        t.Fatalf("expected conflict on joining full room")
    }

    // Vote delete: first vote should not delete
    deleted, err := rs.VoteDeletion(ctx, a.User)
    if err != nil || deleted { t.Fatalf("first vote should not delete: %v %v", deleted, err) }
    // Second vote should delete
    deleted, err = rs.VoteDeletion(ctx, b.User)
    if err != nil || !deleted { t.Fatalf("second vote should delete: %v %v", deleted, err) }

    // After deletion, both users have no room
    // Fetching their room should be not found
    if _, err := rs.GetMyRoom(ctx, a.User); err == nil || err != derr.ErrNotFound { t.Fatalf("expected not found for A") }
    if _, err := rs.GetMyRoom(ctx, b.User); err == nil || err != derr.ErrNotFound { t.Fatalf("expected not found for B") }

    _ = time.Now() // silence unused import if any
}
