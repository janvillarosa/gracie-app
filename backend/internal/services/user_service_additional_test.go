package services

import (
    "context"
    "testing"

    derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
    "github.com/janvillarosa/gracie-app/backend/internal/models"
    "github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func TestUpdateProfileValidationAndConflicts(t *testing.T) {
    tx, usersRepo, roomsRepo, _, _ := memstore.Compose()
    svc := NewUserService(usersRepo, roomsRepo, tx)

    // Seed an existing user with a username
    existing := &models.User{UserID: "usr_exist", Name: "Ex", Username: "ex@example.com"}
    if err := usersRepo.Put(context.Background(), existing); err != nil { t.Fatalf("seed: %v", err) }

    // Target user
    u := &models.User{UserID: "usr_u", Name: "U"}
    if err := usersRepo.Put(context.Background(), u); err != nil { t.Fatalf("seed u: %v", err) }

    // Invalid email
    if err := svc.UpdateProfile(context.Background(), u.UserID, nil, ptr("bad-at")); err != derr.ErrBadRequest {
        t.Fatalf("want bad request for invalid email, got %v", err)
    }
    // Empty name
    if err := svc.UpdateProfile(context.Background(), u.UserID, ptr(""), nil); err != derr.ErrBadRequest {
        t.Fatalf("want bad request for empty name, got %v", err)
    }
    // Conflict on username
    if err := svc.UpdateProfile(context.Background(), u.UserID, nil, ptr("ex@example.com")); err != derr.ErrConflict {
        t.Fatalf("want conflict on duplicate username, got %v", err)
    }

    // Happy path: set unique username and name
    if err := svc.UpdateProfile(context.Background(), u.UserID, ptr("Alice"), ptr("alice@example.com")); err != nil {
        t.Fatalf("update profile: %v", err)
    }
    got, _ := usersRepo.GetByID(context.Background(), u.UserID)
    if got.Name != "Alice" { t.Fatalf("want name Alice, got %s", got.Name) }
    if got.Username != "alice@example.com" { t.Fatalf("username not updated") }
}

func TestDeleteAccountScenarios(t *testing.T) {
    ctx := context.Background()
    tx, usersRepo, roomsRepo, _, _ := memstore.Compose()
    svc := NewUserService(usersRepo, roomsRepo, tx)

    // No room: delete user only
    u1 := &models.User{UserID: "usr1", Name: "Solo"}
    if err := usersRepo.Put(ctx, u1); err != nil { t.Fatalf("seed u1: %v", err) }
    if err := svc.DeleteAccount(ctx, u1.UserID); err != nil { t.Fatalf("delete no-room: %v", err) }
    if _, err := usersRepo.GetByID(ctx, u1.UserID); err == nil { t.Fatalf("expected u1 deleted") }

    // Solo room: delete room then user
    cu, err := svc.CreateUserWithSoloRoom(ctx, "Alice")
    if err != nil { t.Fatalf("create solo: %v", err) }
    if err := svc.DeleteAccount(ctx, cu.User.UserID); err != nil { t.Fatalf("delete solo: %v", err) }
    if _, err := usersRepo.GetByID(ctx, cu.User.UserID); err == nil { t.Fatalf("expected user deleted") }
    if _, err := roomsRepo.GetByID(ctx, *cu.User.RoomID); err == nil { t.Fatalf("expected room deleted") }

    // Shared room: remove member and delete user, keep room for others
    cuA, _ := svc.CreateUserWithSoloRoom(ctx, "A")
    cuB, _ := svc.CreateUserWithSoloRoom(ctx, "B")
    // Add B to A's room
    if err := roomsRepo.AddMember(ctx, *cuA.User.RoomID, cuB.User.UserID, cuB.User.UpdatedAt); err != nil { t.Fatalf("add member: %v", err) }
    if err := usersRepo.SetRoomID(ctx, cuB.User.UserID, cuA.User.RoomID, cuB.User.UpdatedAt); err != nil { t.Fatalf("set room: %v", err) }
    // Delete A
    if err := svc.DeleteAccount(ctx, cuA.User.UserID); err != nil { t.Fatalf("delete shared: %v", err) }
    // A removed
    if _, err := usersRepo.GetByID(ctx, cuA.User.UserID); err == nil { t.Fatalf("expected A deleted") }
    // Room remains and only B is member
    rm, err := roomsRepo.GetByID(ctx, *cuB.User.RoomID)
    if err != nil { t.Fatalf("room missing: %v", err) }
    if len(rm.MemberIDs) != 1 || rm.MemberIDs[0] != cuB.User.UserID { t.Fatalf("expected only B remaining, got %v", rm.MemberIDs) }
}

func ptr[T any](v T) *T { return &v }
