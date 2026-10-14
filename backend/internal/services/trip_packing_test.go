package services

import (
	"context"
	"errors"
	"testing"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

func TestEnsurePackingListCreatesOnceAndIsIdempotent(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))

	l1, err := e.svc.EnsurePackingList(ctx, e.ua, "room_1", svcTripID)
	if err != nil || l1.Name != "Packing · Japan" {
		t.Fatalf("first call: %+v %v", l1, err)
	}
	l2, err := e.svc.EnsurePackingList(ctx, e.ub, "room_1", svcTripID)
	if err != nil || l2.ListID != l1.ListID {
		t.Fatalf("second call must return the same list: %+v %v", l2, err)
	}
	lists, _ := e.repos.Lists.ListByRoom(ctx, "room_1")
	if len(lists) != 1 {
		t.Fatalf("want exactly one list, got %d", len(lists))
	}
}

type racyLink struct {
	store.TripRepository
	winner string
	fired  bool
	inner  store.TripRepository
}

func (r *racyLink) LinkPackingList(ctx context.Context, tripID, roomID string, expect *string, listID string, at time.Time) (bool, error) {
	if !r.fired {
		r.fired = true
		_, _ = r.inner.LinkPackingList(ctx, tripID, roomID, nil, r.winner, at) // someone else links first
	}
	return r.TripRepository.LinkPackingList(ctx, tripID, roomID, expect, listID, at)
}

func TestEnsurePackingListRaceLeavesOneList(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	_ = e.repos.Lists.Put(ctx, &models.List{ListID: "list_winner", RoomID: "room_1", Name: "Packing · Japan"})
	e.svc.trips = &racyLink{TripRepository: e.repos.Trips, inner: e.repos.Trips, winner: "list_winner"}

	got, err := e.svc.EnsurePackingList(ctx, e.ua, "room_1", svcTripID)
	if err != nil || got.ListID != "list_winner" {
		t.Fatalf("loser must return the winner's list: %+v %v", got, err)
	}
	lists, _ := e.repos.Lists.ListByRoom(ctx, "room_1")
	if len(lists) != 1 || lists[0].ListID != "list_winner" {
		t.Fatalf("the losing list must be deleted: %+v", lists)
	}
}

func TestEnsurePackingListRepairsLinkToDeletedList(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	l1, _ := e.svc.EnsurePackingList(ctx, e.ua, "room_1", svcTripID)
	_ = e.repos.Lists.Delete(ctx, l1.ListID)

	l2, err := e.svc.EnsurePackingList(ctx, e.ua, "room_1", svcTripID)
	if err != nil || l2.ListID == l1.ListID {
		t.Fatalf("expected a fresh list after the old one vanished: %+v %v", l2, err)
	}
}

func TestEnsurePackingListAccessAndMissingTrip(t *testing.T) {
	e := newTripEnv(t)
	ctx := context.Background()
	_, _ = e.svc.ApplyOps(ctx, e.ua, "room_1", createBatch(t))
	if _, err := e.svc.EnsurePackingList(ctx, e.uc, "room_1", svcTripID); !errors.Is(err, derr.ErrForbidden) {
		t.Fatalf("non-member: %v", err)
	}
	if _, err := e.svc.EnsurePackingList(ctx, e.uc, "room_2", svcTripID); !errors.Is(err, derr.ErrNotFound) {
		t.Fatalf("trip from another room must look missing: %v", err)
	}
	if _, err := e.svc.EnsurePackingList(ctx, e.ua, "room_1", "trip_"+"b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0"); !errors.Is(err, derr.ErrNotFound) {
		t.Fatalf("unknown trip: %v", err)
	}
}
