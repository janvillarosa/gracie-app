package memstore

import (
	"context"
	"slices"
	"sort"
	"sync"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

// AutopilotRepo mirrors store/mongo.AutopilotRepo, unique action key and lease included.
type AutopilotRepo struct {
	mu         sync.Mutex
	actions    map[string]*models.AutopilotAction
	leaseOwner string
	leaseUntil time.Time
}

func NewAutopilotRepo() *AutopilotRepo {
	return &AutopilotRepo{actions: map[string]*models.AutopilotAction{}}
}

func (r *AutopilotRepo) Insert(_ context.Context, a *models.AutopilotAction) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, x := range r.actions {
		if x.ActionID == a.ActionID || (x.RoomID == a.RoomID && x.Kind == a.Kind && x.Key == a.Key && x.Cycle == a.Cycle) {
			return derr.ErrConflict
		}
	}
	cp := *a
	r.actions[a.ActionID] = &cp
	return nil
}

func (r *AutopilotRepo) SetItem(_ context.Context, actionID, itemID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if a, ok := r.actions[actionID]; ok {
		a.ItemID = itemID
	}
	return nil
}

func (r *AutopilotRepo) Delete(_ context.Context, actionID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.actions, actionID)
	return nil
}

func (r *AutopilotRepo) GetByID(_ context.Context, actionID string) (*models.AutopilotAction, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if a, ok := r.actions[actionID]; ok {
		cp := *a
		return &cp, nil
	}
	return nil, derr.ErrNotFound
}

func (r *AutopilotRepo) GetByItem(_ context.Context, itemID string) (*models.AutopilotAction, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, a := range r.actions {
		if itemID != "" && a.ItemID == itemID {
			cp := *a
			return &cp, nil
		}
	}
	return nil, derr.ErrNotFound
}

func (r *AutopilotRepo) filter(keep func(*models.AutopilotAction) bool) []models.AutopilotAction {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []models.AutopilotAction
	for _, a := range r.actions {
		if keep(a) {
			out = append(out, *a)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}

func (r *AutopilotRepo) ListByList(_ context.Context, listID string, since time.Time) ([]models.AutopilotAction, error) {
	return r.filter(func(a *models.AutopilotAction) bool { return a.ListID == listID && !a.CreatedAt.Before(since) }), nil
}

func (r *AutopilotRepo) ListApplied(_ context.Context, roomID string) ([]models.AutopilotAction, error) {
	return r.filter(func(a *models.AutopilotAction) bool { return a.RoomID == roomID && a.State == models.ActionApplied }), nil
}

func (r *AutopilotRepo) Resolve(_ context.Context, actionID string, from []string, to string, at time.Time) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	a, ok := r.actions[actionID]
	if !ok || !slices.Contains(from, a.State) {
		return false, nil
	}
	purge := at.Add(store.AutopilotRetention)
	a.State, a.ResolvedAt, a.PurgeAt = to, &at, &purge
	return true, nil
}

func (r *AutopilotRepo) DeleteByRoom(_ context.Context, roomID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, a := range r.actions {
		if a.RoomID == roomID {
			delete(r.actions, id)
		}
	}
	return nil
}

func (r *AutopilotRepo) AcquireLease(_ context.Context, owner string, ttl time.Duration, now time.Time) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.leaseOwner != "" && r.leaseOwner != owner && now.Before(r.leaseUntil) {
		return false, nil
	}
	r.leaseOwner, r.leaseUntil = owner, now.Add(ttl)
	return true, nil
}
