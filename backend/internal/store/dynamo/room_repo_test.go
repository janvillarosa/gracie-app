package dynamo

import (
    "context"
    "testing"
    "time"

    "github.com/janvillarosa/gracie-app/backend/internal/models"
    "github.com/janvillarosa/gracie-app/backend/internal/testutil"
)

func TestRoomRepoBasics(t *testing.T) {
    db, usersTable, roomsTable, cleanup := testutil.SetupDynamoOrSkip(t)
    defer cleanup()
    client := &Client{DB: db, Tables: Tables{Users: usersTable, Rooms: roomsTable}}
    rooms := NewRoomRepo(client)
    now := time.Now().UTC()
    rm := &models.Room{RoomID: "room_ut_1", MemberIDs: []string{"usrA"}, DeletionVotes: map[string]string{}, CreatedAt: now, UpdatedAt: now}
    if err := rooms.Put(context.Background(), rm); err != nil { t.Fatalf("put room: %v", err) }

    got, err := rooms.GetByID(context.Background(), rm.RoomID)
    if err != nil { t.Fatalf("get room: %v", err) }
    if got.RoomID != rm.RoomID || len(got.MemberIDs) != 1 { t.Fatalf("unexpected room: %+v", got) }

    if err := rooms.SetShareToken(context.Background(), rm.RoomID, "usrA", "tok123", time.Now().UTC()); err != nil { t.Fatalf("share tok: %v", err) }
    if err := rooms.RemoveShareToken(context.Background(), rm.RoomID, time.Now().UTC()); err != nil { t.Fatalf("remove tok: %v", err) }
    if err := rooms.VoteDeletion(context.Background(), rm.RoomID, "usrA", time.Now().UTC()); err != nil { t.Fatalf("vote: %v", err) }
}
