package mongo

import (
    "context"
    "crypto/rand"
    "encoding/hex"
    "os"
    "testing"
    "time"

    "github.com/janvillarosa/gracie-app/backend/internal/models"
)

func randHex(n int) string {
    b := make([]byte, n)
    _, _ = rand.Read(b)
    return hex.EncodeToString(b)
}

// connectOrSkip returns a connected client+db or skips if Mongo is unreachable.
func connectOrSkip(t *testing.T) *Client {
    t.Helper()
    uri := os.Getenv("MONGODB_URI")
    if uri == "" { uri = "mongodb://localhost:27017" }
    dbname := "gracie_test_" + randHex(6)
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    c, err := New(ctx, uri, dbname)
    if err != nil { t.Skipf("mongo unavailable: %v", err) }
    t.Cleanup(func() { _ = c.DB.Drop(context.Background()) ; _ = c.Close(context.Background()) })
    return c
}

func TestMongoUserRepoCRUD(t *testing.T) {
    c := connectOrSkip(t)
    ur := NewUserRepo(c)
    if err := ur.EnsureIndexes(context.Background()); err != nil { t.Fatalf("indexes: %v", err) }

    now := time.Now().UTC()
    u := &models.User{UserID: "usr_"+randHex(4), Name: "A", CreatedAt: now, UpdatedAt: now}
    if err := ur.Put(context.Background(), u); err != nil { t.Fatalf("put: %v", err) }
    got, err := ur.GetByID(context.Background(), u.UserID)
    if err != nil || got == nil || got.UserID != u.UserID { t.Fatalf("get: %v %v", got, err) }

    // username
    if err := ur.UpdateUsername(context.Background(), u.UserID, "a@b.com", time.Now().UTC()); err != nil { t.Fatalf("update username: %v", err) }
    up, err := ur.GetByUsername(context.Background(), "a@b.com")
    if err != nil || up.UserID != u.UserID { t.Fatalf("get by username: %v %v", up, err) }

    // api key
    lk := "lookup_"+randHex(3)
    if err := ur.SetAPIKey(context.Background(), u.UserID, "hash", lk, nil, time.Now().UTC()); err != nil { t.Fatalf("set api: %v", err) }
    if _, err := ur.GetByAPIKeyLookup(context.Background(), lk); err != nil { t.Fatalf("get by lookup: %v", err) }

    // room id set/unset
    rid := "room_"+randHex(4)
    if err := ur.SetRoomID(context.Background(), u.UserID, &rid, time.Now().UTC()); err != nil { t.Fatalf("set room: %v", err) }
    if err := ur.SetRoomID(context.Background(), u.UserID, nil, time.Now().UTC()); err != nil { t.Fatalf("unset room: %v", err) }

    // password enc
    if err := ur.UpdatePasswordEnc(context.Background(), u.UserID, "enc", time.Now().UTC()); err != nil { t.Fatalf("pwd: %v", err) }

    if err := ur.Delete(context.Background(), u.UserID); err != nil { t.Fatalf("delete: %v", err) }
}

func TestMongoRoomRepoCRUD(t *testing.T) {
    c := connectOrSkip(t)
    rr := NewRoomRepo(c)
    if err := rr.EnsureIndexes(context.Background()); err != nil { t.Fatalf("indexes: %v", err) }
    now := time.Now().UTC()
    rm := &models.Room{RoomID: "room_"+randHex(4), MemberIDs: []string{"u1"}, CreatedAt: now, UpdatedAt: now}
    if err := rr.Put(context.Background(), rm); err != nil { t.Fatalf("put: %v", err) }
    if _, err := rr.GetByID(context.Background(), rm.RoomID); err != nil { t.Fatalf("get: %v", err) }
    // share token
    if err := rr.SetShareToken(context.Background(), rm.RoomID, "u1", "tok1", time.Now().UTC()); err != nil { t.Fatalf("set tok: %v", err) }
    if _, err := rr.GetByShareToken(context.Background(), "tok1"); err != nil { t.Fatalf("by tok: %v", err) }
    if err := rr.RemoveShareToken(context.Background(), rm.RoomID, time.Now().UTC()); err != nil { t.Fatalf("rm tok: %v", err) }
    // members
    if err := rr.AddMember(context.Background(), rm.RoomID, "u2", time.Now().UTC()); err != nil { t.Fatalf("add member: %v", err) }
    if err := rr.RemoveMember(context.Background(), rm.RoomID, "u1", time.Now().UTC()); err != nil { t.Fatalf("rm member: %v", err) }
    // votes
    if err := rr.VoteDeletion(context.Background(), rm.RoomID, "u2", time.Now().UTC()); err != nil { t.Fatalf("vote: %v", err) }
    if err := rr.RemoveDeletionVote(context.Background(), rm.RoomID, "u2"); err != nil { t.Fatalf("rm vote: %v", err) }
    // updates
    if err := rr.UpdateDisplayName(context.Background(), rm.RoomID, "u2", "House", time.Now().UTC()); err != nil { t.Fatalf("upd dn: %v", err) }
    if err := rr.UpdateDescription(context.Background(), rm.RoomID, "u2", "Desc", time.Now().UTC()); err != nil { t.Fatalf("upd desc: %v", err) }
    if err := rr.Delete(context.Background(), rm.RoomID); err != nil { t.Fatalf("delete: %v", err) }
}

func TestMongoListRepos(t *testing.T) {
    c := connectOrSkip(t)
    lr := NewListRepo(c)
    ir := NewListItemRepo(c)
    if err := lr.EnsureIndexes(context.Background()); err != nil { t.Fatalf("idx lists: %v", err) }
    if err := ir.EnsureIndexes(context.Background()); err != nil { t.Fatalf("idx items: %v", err) }
    now := time.Now().UTC()
    roomID := "room_"+randHex(4)
    l := &models.List{ListID: "list_"+randHex(4), RoomID: roomID, Name: "Groceries", CreatedAt: now, UpdatedAt: now}
    if err := lr.Put(context.Background(), l); err != nil { t.Fatalf("put list: %v", err) }
    if _, err := lr.GetByID(context.Background(), l.ListID); err != nil { t.Fatalf("get list: %v", err) }
    if err := lr.UpdateName(context.Background(), l.ListID, "G1", time.Now().UTC()); err != nil { t.Fatalf("upd name: %v", err) }
    if err := lr.UpdateDescription(context.Background(), l.ListID, "Weekly", time.Now().UTC()); err != nil { t.Fatalf("upd desc: %v", err) }
    if err := lr.UpdateIcon(context.Background(), l.ListID, "HOUSE", time.Now().UTC()); err != nil { t.Fatalf("upd icon: %v", err) }
    if _, err := lr.ListByRoom(context.Background(), roomID); err != nil { t.Fatalf("list by room: %v", err) }

    // Items
    it := &models.ListItem{ItemID: "item_"+randHex(4), ListID: l.ListID, RoomID: roomID, Description: "Milk", Completed: false, CreatedAt: now, UpdatedAt: now}
    if err := ir.Put(context.Background(), it); err != nil { t.Fatalf("put item: %v", err) }
    if _, err := ir.GetByID(context.Background(), it.ItemID); err != nil { t.Fatalf("get item: %v", err) }
    if _, err := ir.ListByList(context.Background(), l.ListID); err != nil { t.Fatalf("list items: %v", err) }
    if err := ir.UpdateCompletion(context.Background(), it.ItemID, true, time.Now().UTC()); err != nil { t.Fatalf("upd completion: %v", err) }
    if err := ir.UpdateDescription(context.Background(), it.ItemID, "Bread", time.Now().UTC()); err != nil { t.Fatalf("upd desc: %v", err) }
    if err := ir.Delete(context.Background(), it.ItemID); err != nil { t.Fatalf("del item: %v", err) }

    // Deletion votes
    if err := lr.AddDeletionVote(context.Background(), l.ListID, "u1", time.Now().UTC()); err != nil { t.Fatalf("vote: %v", err) }
    deleted, err := lr.FinalizeDeleteIfVotedByAll(context.Background(), l.ListID, []string{"u1"}, time.Now().UTC())
    if err != nil || !deleted { t.Fatalf("finalize: %v %v", deleted, err) }
}

func TestMongoTxRunnerFallback(t *testing.T) {
    c := connectOrSkip(t)
    tx := NewTx(c)
    ran := false
    err := tx.WithTransaction(context.Background(), func(ctx context.Context) error { ran = true; return nil })
    if err != nil { t.Fatalf("tx: %v", err) }
    if !ran { t.Fatalf("tx function did not run") }
}

