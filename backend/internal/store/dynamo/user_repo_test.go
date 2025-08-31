package dynamo

import (
    "context"
    "testing"
    "time"

    authpkg "github.com/janvillarosa/gracie-app/backend/internal/auth"
    "github.com/janvillarosa/gracie-app/backend/internal/models"
    "github.com/janvillarosa/gracie-app/backend/internal/testutil"
)

func TestUserRepoCRUD(t *testing.T) {
    db, usersTable, roomsTable, cleanup := testutil.SetupDynamoOrSkip(t)
    defer cleanup()

    client := &Client{DB: db, Tables: Tables{Users: usersTable, Rooms: roomsTable}}
    repo := NewUserRepo(client)
    now := time.Now().UTC()

    lookup := authpkg.DeriveLookup("k1")
    u := &models.User{
        UserID:       "usr_ut_1",
        Name:         "Alice",
        APIKeyHash:   "hash",
        APIKeyLookup: lookup,
        CreatedAt:    now,
        UpdatedAt:    now,
    }
    if err := repo.Put(context.Background(), u); err != nil { t.Fatalf("put: %v", err) }

    got, err := repo.GetByID(context.Background(), u.UserID)
    if err != nil { t.Fatalf("get: %v", err) }
    if got.Name != "Alice" { t.Fatalf("unexpected name: %s", got.Name) }

    got2, err := repo.GetByAPIKeyLookup(context.Background(), lookup)
    if err != nil || got2 == nil || got2.UserID != u.UserID { t.Fatalf("lookup: %v %v", err, got2) }

    if err := repo.UpdateName(context.Background(), u.UserID, "Alicia", time.Now().UTC()); err != nil { t.Fatalf("update name: %v", err) }
    if err := repo.SetRoomID(context.Background(), u.UserID, "roomX", time.Now().UTC()); err != nil { t.Fatalf("set room: %v", err) }
    if err := repo.ClearRoomID(context.Background(), u.UserID, time.Now().UTC()); err != nil { t.Fatalf("clear room: %v", err) }
}
