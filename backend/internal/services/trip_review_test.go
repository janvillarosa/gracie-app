package services

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

var svcTripID2 = "trip_" + strings.Repeat("b", 32)

// failingTripGet makes Get/Insert/ReplaceCAS fail for one trip only.
type failingTripGet struct {
	store.TripRepository
	bad string
}

func (f failingTripGet) Get(ctx context.Context, id string) (*models.Trip, error) {
	if id == f.bad {
		return nil, errors.New("boom: connection reset")
	}
	return f.TripRepository.Get(ctx, id)
}

func opJSONFor(t *testing.T, tripID, client string, seq int64, typ string, patch map[string]any) json.RawMessage {
	t.Helper()
	m := map[string]any{"v": 1, "op_id": "op-" + tripID[5:8] + client + string(rune('a'+seq)), "client_id": client, "seq": seq,
		"at": 1_700_000_000_000, "type": typ, "trip_id": tripID}
	if patch != nil {
		m["patch"] = patch
	}
	b, _ := json.Marshal(m)
	return b
}

func TestOneTripStorageErrorDoesNotFailTheBatch(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	e.svc.trips = failingTripGet{TripRepository: e.repos.Trips, bad: svcTripID}
	resp, err := e.svc.ApplyOps(ctx, e.ua, "room_1", []json.RawMessage{
		opJSONFor(t, svcTripID, "dev-a", 1, "trip.create", map[string]any{"title": "Broken"}),
		opJSONFor(t, svcTripID2, "dev-a", 1, "trip.create", map[string]any{"title": "Fine"}),
	})
	if err != nil {
		t.Fatalf("batch must not 500: %v", err)
	}
	if resp.Results[0].Status != models.OpRetry || resp.Results[1].Status != models.OpApplied {
		t.Fatalf("results: %+v", resp.Results)
	}
	if _, err := e.repos.Trips.Get(ctx, svcTripID2); err != nil {
		t.Fatalf("the healthy trip must be written: %v", err)
	}
}

func TestCancelledContextAbortsTheBatch(t *testing.T) {
	e := newTripEnv(t)
	ctx, cancel := context.WithCancel(context.Background())
	e.svc.trips = failingTripGet{TripRepository: e.repos.Trips, bad: svcTripID}
	cancel()
	_, err := e.svc.ApplyOps(ctx, e.ua, "room_1", []json.RawMessage{
		opJSONFor(t, svcTripID, "dev-a", 1, "trip.create", map[string]any{"title": "x"}),
	})
	if err == nil {
		t.Fatalf("a dead context must fail the request")
	}
}

func TestOpsInArbitraryArrayOrderAreAppliedBySeq(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	resp, err := e.svc.ApplyOps(ctx, e.ua, "room_1", []json.RawMessage{
		opJSON(t, "dev-a", 2, "todo.create", svcTodoID("1"), map[string]any{"title": "Ramen"}),
		opJSON(t, "dev-a", 1, "trip.create", "", map[string]any{"title": "Japan"}),
	})
	if err != nil {
		t.Fatal(err)
	}
	// results stay in request order; both must be applied, none lost as duplicate
	for _, r := range resp.Results {
		if r.Status != models.OpApplied {
			t.Fatalf("results: %+v", resp.Results)
		}
	}
	stored, _ := e.repos.Trips.Get(ctx, svcTripID)
	if len(stored.Todos) != 1 {
		t.Fatalf("todo lost: %+v", stored)
	}
}

func TestNewClientIDsPerBatchAreCapped(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	var ops []json.RawMessage
	ops = append(ops, opJSON(t, "dev-0", 1, "trip.create", "", map[string]any{"title": "Japan"}))
	for _, c := range []string{"dev-1", "dev-2", "dev-3", "dev-4"} {
		ops = append(ops, opJSON(t, c, 1, "trip.update", "", map[string]any{"notes": c}))
	}
	resp, err := e.svc.ApplyOps(ctx, e.ua, "room_1", ops)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Results[2].Status != models.OpApplied || resp.Results[3].Status != models.OpRejected || resp.Results[3].Code != models.CodeCap {
		t.Fatalf("results: %+v", resp.Results)
	}
	stored, _ := e.repos.Trips.Get(ctx, svcTripID)
	if len(stored.Acked) != 3 {
		t.Fatalf("acked should hold 3 new clients, got %v", stored.Acked)
	}
}

func TestPackingListLinkToOtherRoomIsStaleAndRepaired(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	_ = e.repos.Lists.Put(ctx, &models.List{ListID: "list_old", RoomID: "room_deleted_solo", Name: "old"})
	if ok, err := e.repos.Trips.LinkPackingList(ctx, svcTripID, "room_1", nil, "list_old", e.svc.now()); err != nil || !ok {
		t.Fatal(ok, err)
	}
	l, err := e.svc.EnsurePackingList(ctx, e.ua, "room_1", svcTripID)
	if err != nil || l.ListID == "list_old" || l.RoomID != "room_1" {
		t.Fatalf("link into another room must be relinked: %+v %v", l, err)
	}
}

type failingListGet struct {
	store.ListRepository
}

func (failingListGet) GetByID(context.Context, string) (*models.List, error) {
	return nil, errors.New("db down")
}

func TestPackingListTransientErrorIsNotTreatedAsStale(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	if _, err := e.svc.EnsurePackingList(ctx, e.ua, "room_1", svcTripID); err != nil {
		t.Fatal(err)
	}
	e.svc.listRepo = failingListGet{ListRepository: e.repos.Lists}
	if _, err := e.svc.EnsurePackingList(ctx, e.ua, "room_1", svcTripID); err == nil {
		t.Fatalf("a lookup error must surface, not create a second list")
	}
	lists, _ := e.repos.Lists.ListByRoom(ctx, "room_1")
	if len(lists) != 1 {
		t.Fatalf("lists: %d", len(lists))
	}
}
