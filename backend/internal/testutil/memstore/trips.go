package memstore

import (
	"context"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

// TripRepo is the in-memory store.TripRepository. It copies on the way in and out
// so callers can't mutate stored state, mirroring a real datastore.
type TripRepo struct{ st *Store }

func (r *TripRepo) Get(_ context.Context, id string) (*models.Trip, error) {
	r.st.mu.RLock()
	defer r.st.mu.RUnlock()
	t, ok := r.st.trips[id]
	if !ok {
		return nil, derr.ErrNotFound
	}
	return t.Clone(), nil
}

func (r *TripRepo) Insert(_ context.Context, t *models.Trip) error {
	r.st.mu.Lock()
	defer r.st.mu.Unlock()
	if _, ok := r.st.trips[t.TripID]; ok {
		return derr.ErrConflict
	}
	r.st.trips[t.TripID] = t.Clone()
	return nil
}

func (r *TripRepo) ReplaceCAS(_ context.Context, t *models.Trip, expect int64) (bool, error) {
	r.st.mu.Lock()
	defer r.st.mu.Unlock()
	cur, ok := r.st.trips[t.TripID]
	if !ok || cur.Version != expect {
		return false, nil
	}
	r.st.trips[t.TripID] = t.Clone()
	return true, nil
}

func (r *TripRepo) Manifest(_ context.Context, roomID string) ([]store.TripStub, error) {
	r.st.mu.RLock()
	defer r.st.mu.RUnlock()
	var out []store.TripStub
	for _, t := range r.st.trips {
		if t.RoomID == roomID {
			out = append(out, store.TripStub{TripID: t.TripID, Version: t.Version, DeletedAt: t.DeletedAt, DeletedBy: t.DeletedBy})
		}
	}
	return out, nil
}

func (r *TripRepo) GetMany(_ context.Context, roomID string, ids []string) ([]models.Trip, error) {
	r.st.mu.RLock()
	defer r.st.mu.RUnlock()
	var out []models.Trip
	for _, id := range ids {
		if t, ok := r.st.trips[id]; ok && t.RoomID == roomID {
			out = append(out, *t.Clone())
		}
	}
	return out, nil
}

func (r *TripRepo) LinkPackingList(_ context.Context, tripID, roomID string, expect *string, listID string, at time.Time) (bool, error) {
	r.st.mu.Lock()
	defer r.st.mu.Unlock()
	t, ok := r.st.trips[tripID]
	if !ok || t.RoomID != roomID || t.DeletedAt != nil {
		return false, nil
	}
	if (expect == nil) != (t.PackingListID == nil) || (expect != nil && *expect != *t.PackingListID) {
		return false, nil
	}
	id := listID
	t.PackingListID = &id
	t.Version++
	t.V = t.Version
	t.UpdatedAt = at
	return true, nil
}

func (r *TripRepo) MoveRoom(_ context.Context, from, to string, at time.Time) error {
	r.st.mu.Lock()
	defer r.st.mu.Unlock()
	for _, t := range r.st.trips {
		if t.RoomID == from {
			t.RoomID = to
			t.Version++
			t.V = t.Version
			t.UpdatedAt = at
		}
	}
	return nil
}

func (r *TripRepo) DeleteByRoom(_ context.Context, roomID string) error {
	r.st.mu.Lock()
	defer r.st.mu.Unlock()
	for id, t := range r.st.trips {
		if t.RoomID == roomID {
			delete(r.st.trips, id)
		}
	}
	return nil
}

// PlaceCacheRepo is the in-memory store.PlaceCacheRepository (no TTL in tests).
type PlaceCacheRepo struct{ st *Store }

func (r *PlaceCacheRepo) Get(_ context.Context, key string) ([]models.Place, bool, error) {
	r.st.mu.RLock()
	defer r.st.mu.RUnlock()
	p, ok := r.st.places[key]
	return append([]models.Place(nil), p...), ok, nil
}

func (r *PlaceCacheRepo) Put(_ context.Context, key string, places []models.Place, _ time.Time) error {
	r.st.mu.Lock()
	defer r.st.mu.Unlock()
	r.st.places[key] = append([]models.Place(nil), places...)
	return nil
}
