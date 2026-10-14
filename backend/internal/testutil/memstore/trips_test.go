package memstore

import (
	"context"
	"errors"
	"testing"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func sampleTrip(id, room string) *models.Trip {
	return &models.Trip{TripID: id, RoomID: room, Version: 1, FieldAt: map[string]int64{}, Acked: map[string]int64{}}
}

func TestTripRepoInsertGetClone(t *testing.T) {
	ctx := context.Background()
	r := Compose().Trips
	if err := r.Insert(ctx, sampleTrip("trip_1", "room_1")); err != nil {
		t.Fatal(err)
	}
	if err := r.Insert(ctx, sampleTrip("trip_1", "room_2")); !errors.Is(err, derr.ErrConflict) {
		t.Fatalf("want ErrConflict, got %v", err)
	}
	a, _ := r.Get(ctx, "trip_1")
	a.Title = "mutated outside the repo"
	b, _ := r.Get(ctx, "trip_1")
	if b.Title != "" {
		t.Fatalf("Get must return a copy")
	}
	if _, err := r.Get(ctx, "nope"); !errors.Is(err, derr.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestTripRepoReplaceCAS(t *testing.T) {
	ctx := context.Background()
	r := Compose().Trips
	_ = r.Insert(ctx, sampleTrip("trip_1", "room_1"))
	cur, _ := r.Get(ctx, "trip_1")
	cur.Version = 2
	if ok, err := r.ReplaceCAS(ctx, cur, 1); err != nil || !ok {
		t.Fatalf("first CAS should win: ok=%v err=%v", ok, err)
	}
	stale := cur.Clone()
	stale.Version = 2
	if ok, _ := r.ReplaceCAS(ctx, stale, 1); ok {
		t.Fatalf("CAS against an old version must fail")
	}
}

func TestTripRepoManifestGetManyMoveDelete(t *testing.T) {
	ctx := context.Background()
	r := Compose().Trips
	del := time.Now()
	t2 := sampleTrip("trip_2", "room_1")
	t2.DeletedAt, t2.DeletedBy = &del, "user_x"
	_ = r.Insert(ctx, sampleTrip("trip_1", "room_1"))
	_ = r.Insert(ctx, t2)
	_ = r.Insert(ctx, sampleTrip("trip_3", "room_9"))

	stubs, _ := r.Manifest(ctx, "room_1")
	if len(stubs) != 2 {
		t.Fatalf("manifest should list both room_1 trips (incl. deleted), got %d", len(stubs))
	}
	got, _ := r.GetMany(ctx, "room_1", []string{"trip_1", "trip_3"})
	if len(got) != 1 || got[0].TripID != "trip_1" {
		t.Fatalf("GetMany must be room-scoped: %+v", got)
	}
	if err := r.MoveRoom(ctx, "room_1", "room_5", time.Now()); err != nil {
		t.Fatal(err)
	}
	moved, _ := r.Get(ctx, "trip_1")
	if moved.RoomID != "room_5" || moved.Version != 2 {
		t.Fatalf("MoveRoom should re-home and bump version: %+v", moved)
	}
	_ = r.DeleteByRoom(ctx, "room_5")
	if _, err := r.Get(ctx, "trip_1"); !errors.Is(err, derr.ErrNotFound) {
		t.Fatalf("DeleteByRoom left trips behind")
	}
	if _, err := r.Get(ctx, "trip_3"); err != nil {
		t.Fatalf("DeleteByRoom removed another room's trip")
	}
}

func TestTripRepoLinkPackingList(t *testing.T) {
	ctx := context.Background()
	r := Compose().Trips
	_ = r.Insert(ctx, sampleTrip("trip_1", "room_1"))
	if ok, _ := r.LinkPackingList(ctx, "trip_1", "room_1", nil, "list_a", time.Now()); !ok {
		t.Fatal("first link should win")
	}
	if ok, _ := r.LinkPackingList(ctx, "trip_1", "room_1", nil, "list_b", time.Now()); ok {
		t.Fatal("second link with expect=nil must lose")
	}
	old := "list_a"
	if ok, _ := r.LinkPackingList(ctx, "trip_1", "room_1", &old, "list_c", time.Now()); !ok {
		t.Fatal("relink with the right expected id should win")
	}
	got, _ := r.Get(ctx, "trip_1")
	if *got.PackingListID != "list_c" || got.Version != 3 {
		t.Fatalf("link state: %+v", got)
	}
}

func TestPlaceCacheRepo(t *testing.T) {
	ctx := context.Background()
	c := Compose().Places
	if _, ok, _ := c.Get(ctx, "k"); ok {
		t.Fatal("empty cache hit")
	}
	_ = c.Put(ctx, "k", []models.Place{{Name: "Kyoto"}}, time.Now())
	got, ok, _ := c.Get(ctx, "k")
	if !ok || len(got) != 1 || got[0].Name != "Kyoto" {
		t.Fatalf("cache roundtrip failed: %v %v", got, ok)
	}
}
