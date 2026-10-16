//go:build integration

package mongo

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
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
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}
	dbname := "gracie_test_" + randHex(6)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, err := New(ctx, uri, dbname)
	if err != nil {
		t.Skipf("mongo unavailable: %v", err)
	}
	t.Cleanup(func() { _ = c.DB.Drop(context.Background()); _ = c.Close(context.Background()) })
	return c
}

func TestMongoUserRepoCRUD(t *testing.T) {
	c := connectOrSkip(t)
	ur := NewUserRepo(c)
	if err := ur.EnsureIndexes(context.Background()); err != nil {
		t.Fatalf("indexes: %v", err)
	}

	now := time.Now().UTC()
	u := &models.User{UserID: "usr_" + randHex(4), Name: "A", CreatedAt: now, UpdatedAt: now}
	if err := ur.Put(context.Background(), u); err != nil {
		t.Fatalf("put: %v", err)
	}
	got, err := ur.GetByID(context.Background(), u.UserID)
	if err != nil || got == nil || got.UserID != u.UserID {
		t.Fatalf("get: %v %v", got, err)
	}

	// username
	if err := ur.UpdateUsername(context.Background(), u.UserID, "a@b.com", time.Now().UTC()); err != nil {
		t.Fatalf("update username: %v", err)
	}
	up, err := ur.GetByUsername(context.Background(), "a@b.com")
	if err != nil || up.UserID != u.UserID {
		t.Fatalf("get by username: %v %v", up, err)
	}

	// api key
	lk := "lookup_" + randHex(3)
	if err := ur.SetAPIKey(context.Background(), u.UserID, "hash", lk, nil, time.Now().UTC()); err != nil {
		t.Fatalf("set api: %v", err)
	}
	if _, err := ur.GetByAPIKeyLookup(context.Background(), lk); err != nil {
		t.Fatalf("get by lookup: %v", err)
	}

	// room id set/unset
	rid := "room_" + randHex(4)
	if err := ur.SetRoomID(context.Background(), u.UserID, &rid, time.Now().UTC()); err != nil {
		t.Fatalf("set room: %v", err)
	}
	if err := ur.SetRoomID(context.Background(), u.UserID, nil, time.Now().UTC()); err != nil {
		t.Fatalf("unset room: %v", err)
	}

	// password enc
	if err := ur.UpdatePasswordEnc(context.Background(), u.UserID, "enc", time.Now().UTC()); err != nil {
		t.Fatalf("pwd: %v", err)
	}

	if err := ur.Delete(context.Background(), u.UserID); err != nil {
		t.Fatalf("delete: %v", err)
	}
}

func TestMongoRoomRepoCRUD(t *testing.T) {
	c := connectOrSkip(t)
	rr := NewRoomRepo(c)
	if err := rr.EnsureIndexes(context.Background()); err != nil {
		t.Fatalf("indexes: %v", err)
	}
	now := time.Now().UTC()
	rm := &models.Room{RoomID: "room_" + randHex(4), MemberIDs: []string{"u1"}, CreatedAt: now, UpdatedAt: now}
	if err := rr.Put(context.Background(), rm); err != nil {
		t.Fatalf("put: %v", err)
	}
	if _, err := rr.GetByID(context.Background(), rm.RoomID); err != nil {
		t.Fatalf("get: %v", err)
	}
	// share token
	if err := rr.SetShareToken(context.Background(), rm.RoomID, "u1", "tok1", time.Now().UTC()); err != nil {
		t.Fatalf("set tok: %v", err)
	}
	if _, err := rr.GetByShareToken(context.Background(), "tok1"); err != nil {
		t.Fatalf("by tok: %v", err)
	}
	if err := rr.RemoveShareToken(context.Background(), rm.RoomID, time.Now().UTC()); err != nil {
		t.Fatalf("rm tok: %v", err)
	}
	// members
	if err := rr.AddMember(context.Background(), rm.RoomID, "u2", time.Now().UTC()); err != nil {
		t.Fatalf("add member: %v", err)
	}
	if err := rr.RemoveMember(context.Background(), rm.RoomID, "u1", time.Now().UTC()); err != nil {
		t.Fatalf("rm member: %v", err)
	}
	// votes
	if err := rr.VoteDeletion(context.Background(), rm.RoomID, "u2", time.Now().UTC()); err != nil {
		t.Fatalf("vote: %v", err)
	}
	if err := rr.RemoveDeletionVote(context.Background(), rm.RoomID, "u2"); err != nil {
		t.Fatalf("rm vote: %v", err)
	}
	// updates
	if err := rr.UpdateDisplayName(context.Background(), rm.RoomID, "u2", "House", time.Now().UTC()); err != nil {
		t.Fatalf("upd dn: %v", err)
	}
	if err := rr.UpdateDescription(context.Background(), rm.RoomID, "u2", "Desc", time.Now().UTC()); err != nil {
		t.Fatalf("upd desc: %v", err)
	}
	if err := rr.Delete(context.Background(), rm.RoomID); err != nil {
		t.Fatalf("delete: %v", err)
	}
}

func TestMongoListRepos(t *testing.T) {
	c := connectOrSkip(t)
	lr := NewListRepo(c)
	ir := NewListItemRepo(c)
	if err := lr.EnsureIndexes(context.Background()); err != nil {
		t.Fatalf("idx lists: %v", err)
	}
	if err := ir.EnsureIndexes(context.Background()); err != nil {
		t.Fatalf("idx items: %v", err)
	}
	now := time.Now().UTC()
	roomID := "room_" + randHex(4)
	l := &models.List{ListID: "list_" + randHex(4), RoomID: roomID, Name: "Groceries", CreatedAt: now, UpdatedAt: now}
	if err := lr.Put(context.Background(), l); err != nil {
		t.Fatalf("put list: %v", err)
	}
	if _, err := lr.GetByID(context.Background(), l.ListID); err != nil {
		t.Fatalf("get list: %v", err)
	}
	if err := lr.UpdateName(context.Background(), l.ListID, "G1", time.Now().UTC()); err != nil {
		t.Fatalf("upd name: %v", err)
	}
	if err := lr.UpdateDescription(context.Background(), l.ListID, "Weekly", time.Now().UTC()); err != nil {
		t.Fatalf("upd desc: %v", err)
	}
	if err := lr.UpdateIcon(context.Background(), l.ListID, "HOUSE", time.Now().UTC()); err != nil {
		t.Fatalf("upd icon: %v", err)
	}
	if _, err := lr.ListByRoom(context.Background(), roomID); err != nil {
		t.Fatalf("list by room: %v", err)
	}

	// Items
	it := &models.ListItem{ItemID: "item_" + randHex(4), ListID: l.ListID, RoomID: roomID, Description: "Milk", Completed: false, CreatedAt: now, UpdatedAt: now}
	if err := ir.Put(context.Background(), it); err != nil {
		t.Fatalf("put item: %v", err)
	}
	if _, err := ir.GetByID(context.Background(), it.ItemID); err != nil {
		t.Fatalf("get item: %v", err)
	}
	if _, err := ir.ListByList(context.Background(), l.ListID); err != nil {
		t.Fatalf("list items: %v", err)
	}
	if got, err := ir.ListByRoom(context.Background(), roomID); err != nil || len(got) != 1 {
		t.Fatalf("list by room: %v %d", err, len(got))
	}
	if err := ir.UpdateCompletion(context.Background(), it.ItemID, true, "u1", time.Now().UTC()); err != nil {
		t.Fatalf("upd completion: %v", err)
	}
	if err := ir.UpdateDescription(context.Background(), it.ItemID, "Bread", time.Now().UTC()); err != nil {
		t.Fatalf("upd desc: %v", err)
	}
	if err := ir.Delete(context.Background(), it.ItemID); err != nil {
		t.Fatalf("del item: %v", err)
	}

	// Deletion votes
	if err := lr.AddDeletionVote(context.Background(), l.ListID, "u1", time.Now().UTC()); err != nil {
		t.Fatalf("vote: %v", err)
	}
	deleted, err := lr.FinalizeDeleteIfVotedByAll(context.Background(), l.ListID, []string{"u1"}, time.Now().UTC())
	if err != nil || !deleted {
		t.Fatalf("finalize: %v %v", deleted, err)
	}
}

func TestMongoTxRunnerFallback(t *testing.T) {
	c := connectOrSkip(t)
	tx := NewTx(c)
	ran := false
	err := tx.WithTransaction(context.Background(), func(ctx context.Context) error { ran = true; return nil })
	if err != nil {
		t.Fatalf("tx: %v", err)
	}
	if !ran {
		t.Fatalf("tx function did not run")
	}
}

func newTestTrip(id, room string) *models.Trip {
	now := time.Now().UTC()
	return &models.Trip{TripID: id, RoomID: room, Version: 1, V: 1, FieldAt: map[string]int64{}, Acked: map[string]int64{},
		TripFields: models.TripFields{Title: "Japan"}, CreatedBy: "user_a", CreatedAt: now, UpdatedAt: now}
}

func TestMongoTripRepoCASInsertAndIndexes(t *testing.T) {
	c := connectOrSkip(t)
	r := NewTripRepo(c)
	ctx := context.Background()
	if err := r.EnsureIndexes(ctx); err != nil {
		t.Fatalf("indexes: %v", err)
	}
	id := "trip_" + randHex(16)
	if err := r.Insert(ctx, newTestTrip(id, "room_1")); err != nil {
		t.Fatal(err)
	}
	if err := r.Insert(ctx, newTestTrip(id, "room_2")); !errors.Is(err, derr.ErrConflict) {
		t.Fatalf("duplicate insert should be ErrConflict, got %v", err)
	}
	cur, _ := r.Get(ctx, id)
	cur.Version = 2
	cur.Title = "Japan 2026"
	if ok, err := r.ReplaceCAS(ctx, cur, 1); err != nil || !ok {
		t.Fatalf("CAS should win: %v %v", ok, err)
	}
	stale := cur.Clone()
	stale.Version = 2
	if ok, _ := r.ReplaceCAS(ctx, stale, 1); ok {
		t.Fatalf("stale CAS must lose")
	}
	got, _ := r.Get(ctx, id)
	if got.Title != "Japan 2026" || got.Version != 2 {
		t.Fatalf("stored: %+v", got)
	}

	// TTL index on purge_at exists
	cur2, _ := r.Get(ctx, id)
	idxs, _ := r.col().Indexes().List(ctx)
	var found bool
	var doc struct {
		Name   string `bson:"name"`
		Expire *int32 `bson:"expireAfterSeconds"`
	}
	for idxs.Next(ctx) {
		if err := idxs.Decode(&doc); err == nil && doc.Name == "purge_at_ttl" && doc.Expire != nil {
			found = true
		}
	}
	if !found {
		t.Fatalf("purge_at TTL index missing")
	}
	_ = cur2
}

func TestMongoTripRepoManifestMoveLinkDelete(t *testing.T) {
	c := connectOrSkip(t)
	r := NewTripRepo(c)
	ctx := context.Background()
	_ = r.EnsureIndexes(ctx)
	a, b := "trip_"+randHex(16), "trip_"+randHex(16)
	_ = r.Insert(ctx, newTestTrip(a, "room_1"))
	del := newTestTrip(b, "room_1")
	d := time.Now().UTC()
	del.DeletedAt, del.DeletedBy = &d, "user_x"
	_ = r.Insert(ctx, del)

	stubs, err := r.Manifest(ctx, "room_1")
	if err != nil || len(stubs) != 2 {
		t.Fatalf("manifest: %v %v", stubs, err)
	}
	many, _ := r.GetMany(ctx, "room_1", []string{a, "trip_other"})
	if len(many) != 1 || many[0].TripID != a {
		t.Fatalf("GetMany: %+v", many)
	}

	if ok, _ := r.LinkPackingList(ctx, a, "room_1", nil, "list_1", time.Now()); !ok {
		t.Fatalf("first link should win")
	}
	if ok, _ := r.LinkPackingList(ctx, a, "room_1", nil, "list_2", time.Now()); ok {
		t.Fatalf("second link with expect=nil must lose")
	}
	linked, _ := r.Get(ctx, a)
	if linked.PackingListID == nil || *linked.PackingListID != "list_1" || linked.Version != 2 || linked.V != 2 {
		t.Fatalf("link state: %+v", linked)
	}

	if err := r.MoveRoom(ctx, "room_1", "room_9", time.Now()); err != nil {
		t.Fatal(err)
	}
	moved, _ := r.Get(ctx, a)
	if moved.RoomID != "room_9" || moved.Version != 3 {
		t.Fatalf("move: %+v", moved)
	}
	if err := r.DeleteByRoom(ctx, "room_9"); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Get(ctx, a); !errors.Is(err, derr.ErrNotFound) {
		t.Fatalf("DeleteByRoom left data: %v", err)
	}
}

func TestMongoTripDocumentSizes(t *testing.T) {
	c := connectOrSkip(t)
	r := NewTripRepo(c)
	ctx := context.Background()
	_ = r.EnsureIndexes(ctx)
	tr := newTestTrip("trip_"+randHex(16), "room_1")
	tr.Notes = strings.Repeat("n", 16384)
	for i := 0; i < trips.MaxTodos; i++ {
		tr.Todos = append(tr.Todos, models.TripTodo{TodoID: "ttd_" + randHex(16), Title: strings.Repeat("t", 200), Notes: strings.Repeat("x", 2048),
			Place: &models.Place{Name: strings.Repeat("p", 200), Address: strings.Repeat("a", 300), Source: "manual"}, FieldAt: map[string]int64{"title": 1}})
	}
	for i := 0; i < trips.MaxBookings; i++ {
		tr.Bookings = append(tr.Bookings, models.Booking{BookingID: "tbk_" + randHex(16), Kind: "flight", Title: "x", Notes: strings.Repeat("x", 2048), FieldAt: map[string]int64{}})
	}
	if err := r.Insert(ctx, tr); err != nil {
		t.Fatalf("a trip at every cap must be storable: %v", err)
	}
	raw, _ := json.Marshal(tr)
	t.Logf("worst-case trip JSON: %d KB", len(raw)/1024)
	if len(raw) > 2<<20 {
		t.Fatalf("worst-case trip exceeds 2MB (%d bytes); the spec expects ~0.6MB", len(raw))
	}
}
