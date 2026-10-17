//go:build integration

package mongo

import (
	"context"
	"testing"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

func newAction(id, room, key, cycle string, at time.Time) *models.AutopilotAction {
	return &models.AutopilotAction{
		ActionID: id, RoomID: room, ListID: "list_1", Kind: "restock", Key: key, Cycle: cycle,
		State: models.ActionApplied, Confidence: 0.9, Reason: models.AutopilotReason{Code: "every_days", Params: map[string]any{"days": 7}},
		RunAt: at.Add(10 * time.Hour), CreatedAt: at,
	}
}

func autopilotRepo(t *testing.T) *AutopilotRepo {
	t.Helper()
	r := NewAutopilotRepo(connectOrSkip(t))
	if err := r.EnsureIndexes(context.Background()); err != nil {
		t.Fatalf("indexes: %v", err)
	}
	return r
}

func TestAutopilotActionUniqueKey(t *testing.T) {
	r := autopilotRepo(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)
	if err := r.Insert(ctx, newAction("a1", "room_1", "milk", "2026-10-10", now)); err != nil {
		t.Fatal(err)
	}
	// A second instance racing for the same thing in the same cycle.
	if err := r.Insert(ctx, newAction("a2", "room_1", "milk", "2026-10-10", now)); err != derr.ErrConflict {
		t.Fatalf("duplicate: %v", err)
	}
	// Another cycle, another house: both fine.
	if err := r.Insert(ctx, newAction("a3", "room_1", "milk", "2026-10-17", now)); err != nil {
		t.Fatal(err)
	}
	if err := r.Insert(ctx, newAction("a4", "room_2", "milk", "2026-10-10", now)); err != nil {
		t.Fatal(err)
	}
	if err := r.SetItem(ctx, "a1", "item_9"); err != nil {
		t.Fatal(err)
	}
	if a, err := r.GetByItem(ctx, "item_9"); err != nil || a.ActionID != "a1" || a.Reason.Params["days"] == nil {
		t.Fatalf("by item: %+v %v", a, err)
	}
	if _, err := r.GetByItem(ctx, "nope"); err != derr.ErrNotFound {
		t.Fatalf("missing item: %v", err)
	}
	got, err := r.ListByList(ctx, "list_1", now.Add(-time.Minute))
	if err != nil || len(got) != 3 {
		t.Fatalf("by list: %d %v", len(got), err)
	}
	if err := r.Delete(ctx, "a3"); err != nil {
		t.Fatal(err)
	}
	if _, err := r.GetByID(ctx, "a3"); err != derr.ErrNotFound {
		t.Fatalf("deleted: %v", err)
	}
}

func TestAutopilotResolveIsConditional(t *testing.T) {
	r := autopilotRepo(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)
	_ = r.Insert(ctx, newAction("a1", "room_1", "milk", "c1", now))
	ok, err := r.Resolve(ctx, "a1", []string{models.ActionApplied}, models.ActionUndone, now)
	if err != nil || !ok {
		t.Fatalf("applied -> undone: %v %v", ok, err)
	}
	// A delete racing the undo finds it already resolved.
	if ok, _ := r.Resolve(ctx, "a1", []string{models.ActionApplied, models.ActionConfirmed}, models.ActionRemoved, now); ok {
		t.Fatal("resolved twice")
	}
	a, _ := r.GetByID(ctx, "a1")
	if a.State != models.ActionUndone || a.ResolvedAt == nil || a.PurgeAt == nil || a.PurgeAt.Sub(*a.ResolvedAt) != 180*24*time.Hour {
		t.Fatalf("resolved: %+v", a)
	}
	if applied, _ := r.ListApplied(ctx, "room_1"); len(applied) != 0 {
		t.Fatalf("still applied: %+v", applied)
	}

	idx, err := r.actions().Indexes().ListSpecifications(ctx)
	if err != nil {
		t.Fatal(err)
	}
	ttl := false
	for _, s := range idx {
		if s.Name == "purge_at_ttl" && s.ExpireAfterSeconds != nil && *s.ExpireAfterSeconds == 0 {
			ttl = true
		}
	}
	if !ttl {
		t.Fatal("no TTL index on purge_at")
	}
}

func TestAutopilotDeleteByRoomAndLease(t *testing.T) {
	r := autopilotRepo(t)
	ctx := context.Background()
	now := time.Now().UTC()
	_ = r.Insert(ctx, newAction("a1", "room_1", "milk", "c1", now))
	_ = r.Insert(ctx, newAction("a2", "room_2", "milk", "c1", now))
	if err := r.DeleteByRoom(ctx, "room_1"); err != nil {
		t.Fatal(err)
	}
	if _, err := r.GetByID(ctx, "a1"); err != derr.ErrNotFound {
		t.Fatalf("room_1 action kept: %v", err)
	}
	if _, err := r.GetByID(ctx, "a2"); err != nil {
		t.Fatalf("room_2 action lost: %v", err)
	}

	if ok, err := r.AcquireLease(ctx, "one", time.Minute, now); err != nil || !ok {
		t.Fatalf("first lease: %v %v", ok, err)
	}
	if ok, err := r.AcquireLease(ctx, "two", time.Minute, now); err != nil || ok {
		t.Fatalf("second owner got a live lease: %v %v", ok, err)
	}
	if ok, _ := r.AcquireLease(ctx, "one", time.Minute, now.Add(30*time.Second)); !ok {
		t.Fatal("owner could not renew")
	}
	if ok, _ := r.AcquireLease(ctx, "two", time.Minute, now.Add(2*time.Minute)); !ok {
		t.Fatal("expired lease not taken over")
	}
}
