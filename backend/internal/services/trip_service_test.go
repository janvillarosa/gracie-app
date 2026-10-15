package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

var svcTripID = "trip_" + strings.Repeat("a", 32)

func svcTodoID(c string) string { return "ttd_" + strings.Repeat(c, 32) }

type tripEnv struct {
	svc   *TripService
	repos memstore.Repos
	ua    *models.User
	ub    *models.User
	uc    *models.User // member of a different room
}

func newTripEnv(t *testing.T) *tripEnv {
	t.Helper()
	ctx := context.Background()
	m := memstore.Compose()
	r1, r2 := "room_1", "room_2"
	_ = m.Rooms.Put(ctx, &models.Room{RoomID: r1, MemberIDs: []string{"user_a", "user_b"}})
	_ = m.Rooms.Put(ctx, &models.Room{RoomID: r2, MemberIDs: []string{"user_c"}})
	listSvc := NewListService(m.Users, m.Rooms, m.Lists, m.Items, categorization.NewKeywordCategorizer(categorization.GroceryAnchors))
	return &tripEnv{
		svc:   NewTripService(m.Rooms, m.Trips, listSvc, m.Lists),
		repos: m,
		ua:    &models.User{UserID: "user_a", RoomID: &r1},
		ub:    &models.User{UserID: "user_b", RoomID: &r1},
		uc:    &models.User{UserID: "user_c", RoomID: &r2},
	}
}

func opJSON(t *testing.T, client string, seq int64, typ, entity string, patch map[string]any) json.RawMessage {
	t.Helper()
	m := map[string]any{"v": 1, "op_id": "op-" + client + "-" + string(rune('a'+seq)), "client_id": client, "seq": seq,
		"at": time.Now().UnixMilli() - 1000, "type": typ, "trip_id": svcTripID}
	if entity != "" {
		m["entity_id"] = entity
	}
	if patch != nil {
		m["patch"] = patch
	}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func createBatch(t *testing.T) []json.RawMessage {
	return []json.RawMessage{
		opJSON(t, "dev-a", 1, "trip.create", "", map[string]any{"title": "Japan"}),
		opJSON(t, "dev-a", 2, "todo.create", svcTodoID("1"), map[string]any{"title": "Ramen"}),
	}
}

func TestApplyOpsCreatesTripAndTodoInOneBatch(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	resp, err := e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range resp.Results {
		if r.Status != models.OpApplied {
			t.Fatalf("results: %+v", resp.Results)
		}
	}
	if len(resp.Trips) != 1 || !resp.Trips[0].Full || resp.Trips[0].Version != 1 || len(resp.Trips[0].Todos) != 1 {
		t.Fatalf("deltas: %+v", resp.Trips)
	}
	stored, _ := e.repos.Trips.Get(ctx, svcTripID)
	if stored.CreatedBy != "user_a" || stored.RoomID != "room_1" {
		t.Fatalf("stored: %+v", stored)
	}
}

func TestApplyOpsRetriedBatchIsDuplicateNotConflict(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	resp, err := e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range resp.Results {
		if r.Status != models.OpDuplicate {
			t.Fatalf("retry should be duplicate: %+v", resp.Results)
		}
	}
	if len(resp.Trips) != 0 {
		t.Fatalf("a pure replay changes nothing, got deltas: %+v", resp.Trips)
	}
}

func TestApplyOpsAccessControl(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	// not a member of room_1
	if _, err := e.svc.ApplyOps(ctx, e.uc, "room_1", createBatch(t)); !errors.Is(err, derr.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
	// member of room_2 targeting a room_1 trip id through their own room: indistinguishable from "unknown"
	resp, err := e.svc.ApplyOps(ctx, e.uc, "room_2", []json.RawMessage{
		opJSON(t, "dev-c", 1, "todo.create", svcTodoID("2"), map[string]any{"title": "sneaky"}),
	})
	if err != nil {
		t.Fatal(err)
	}
	if r := resp.Results[0]; r.Status != models.OpRejected || r.Code != models.CodeForbiddenOrUnknown {
		t.Fatalf("got %+v", r)
	}
	stored, _ := e.repos.Trips.Get(ctx, svcTripID)
	if len(stored.Todos) != 1 {
		t.Fatalf("cross-room write leaked: %+v", stored.Todos)
	}
}

func TestApplyOpsOneBadOpDoesNotFailTheBatch(t *testing.T) {
	e := newTripEnv(t)
	raws := append(createBatch(t), json.RawMessage(`{"op_id":"op-bad","v":1,"mystery":true}`))
	resp, err := e.svc.ApplyOps(context.Background(), e.ua, "room_1", raws)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Results[0].Status != models.OpApplied || resp.Results[2].Status != models.OpRejected ||
		resp.Results[2].Code != models.CodeUnsupported || resp.Results[2].OpID != "op-bad" {
		t.Fatalf("results: %+v", resp.Results)
	}
}

func TestApplyOpsBatchBounds(t *testing.T) {
	e := newTripEnv(t)
	if _, err := e.svc.ApplyOps(context.Background(), e.ua, "room_1", nil); !errors.Is(err, derr.ErrBadRequest) {
		t.Fatalf("empty batch: %v", err)
	}
	many := make([]json.RawMessage, MaxOpsPerBatch+1)
	for i := range many {
		many[i] = json.RawMessage(`{}`)
	}
	if _, err := e.svc.ApplyOps(context.Background(), e.ua, "room_1", many); !errors.Is(err, derr.ErrBadRequest) {
		t.Fatalf("oversized batch: %v", err)
	}
}

// racyRepo lets a "concurrent writer" slip in before our compare-and-swap.
type racyRepo struct {
	store.TripRepository
	always bool
	fired  bool
	sneak  func()
}

func (r *racyRepo) ReplaceCAS(ctx context.Context, t *models.Trip, expect int64) (bool, error) {
	if r.always || !r.fired {
		r.fired = true
		r.sneak()
	}
	return r.TripRepository.ReplaceCAS(ctx, t, expect)
}

func sneakNotes(inner store.TripRepository) func() {
	return func() {
		ctx := context.Background()
		cur, _ := inner.Get(ctx, svcTripID)
		prev := cur.Version
		cur.Notes = "written by someone else"
		cur.Version++
		_, _ = inner.ReplaceCAS(ctx, cur, prev)
	}
}

func TestApplyOpsRetriesOnCASConflictAndKeepsBothWrites(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	racy := &racyRepo{TripRepository: e.repos.Trips}
	racy.sneak = sneakNotes(e.repos.Trips)
	e.svc.trips = racy

	resp, err := e.svc.ApplyOps(ctx, e.ub, "room_1", []json.RawMessage{
		opJSON(t, "dev-b", 1, "todo.update", svcTodoID("1"), map[string]any{"done": true}),
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Results[0].Status != models.OpApplied {
		t.Fatalf("results: %+v", resp.Results)
	}
	stored, _ := e.repos.Trips.Get(ctx, svcTripID)
	if stored.Notes != "written by someone else" || !stored.Todos[0].Done {
		t.Fatalf("lost an update: notes=%q done=%v", stored.Notes, stored.Todos[0].Done)
	}
}

func TestApplyOpsGivesRetryWhenCASKeepsLosing(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	racy := &racyRepo{TripRepository: e.repos.Trips, always: true}
	racy.sneak = sneakNotes(e.repos.Trips)
	e.svc.trips = racy

	resp, err := e.svc.ApplyOps(ctx, e.ub, "room_1", []json.RawMessage{
		opJSON(t, "dev-b", 1, "todo.update", svcTodoID("1"), map[string]any{"done": true}),
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Results[0].Status != models.OpRetry {
		t.Fatalf("want retry, got %+v", resp.Results)
	}
}

func TestSyncFullDeltaUnchangedRemovedAndPurged(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))

	s, err := e.svc.Sync(ctx, e.ub, "room_1", map[string]int64{})
	if err != nil || len(s.Trips) != 1 || !s.Trips[0].Full || len(s.Removed) != 0 {
		t.Fatalf("new device: %+v %v", s, err)
	}
	s, _ = e.svc.Sync(ctx, e.ub, "room_1", map[string]int64{svcTripID: 1})
	if len(s.Trips) != 0 || len(s.Removed) != 0 {
		t.Fatalf("up to date client should get nothing: %+v", s)
	}
	// soft delete -> client that has the trip is told to drop it (restorable), with who did it
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", []json.RawMessage{opJSON(t, "dev-a", 3, "trip.delete", "", nil)})
	s, _ = e.svc.Sync(ctx, e.ub, "room_1", map[string]int64{svcTripID: 1})
	if len(s.Removed) != 1 || s.Removed[0].DeletedBy != "user_a" || s.Removed[0].Purged {
		t.Fatalf("soft delete: %+v", s.Removed)
	}
	// a client that never had it doesn't hear about it at all
	s, _ = e.svc.Sync(ctx, e.ub, "room_1", map[string]int64{})
	if len(s.Trips) != 0 || len(s.Removed) != 0 {
		t.Fatalf("unknown deleted trip leaked: %+v", s)
	}
	// ids the server no longer has are reported as purged
	s, _ = e.svc.Sync(ctx, e.ub, "room_1", map[string]int64{"trip_" + strings.Repeat("f", 32): 5})
	if len(s.Removed) != 1 || !s.Removed[0].Purged {
		t.Fatalf("purged: %+v", s.Removed)
	}
}

func TestSyncBoundsAndAccess(t *testing.T) {
	e := newTripEnv(t)
	known := map[string]int64{}
	for i := 0; i <= MaxKnownTrips; i++ {
		known[fmt.Sprintf("trip_%032x", i)] = 1
	}
	if _, err := e.svc.Sync(context.Background(), e.ua, "room_1", known); !errors.Is(err, derr.ErrBadRequest) {
		t.Fatalf("too many known: %v", err)
	}
	if _, err := e.svc.Sync(context.Background(), e.uc, "room_1", nil); !errors.Is(err, derr.ErrForbidden) {
		t.Fatalf("non-member: %v", err)
	}
}
