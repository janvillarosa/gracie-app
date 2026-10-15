package services

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"time"

	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
)

const (
	MaxOpsPerBatch = 200
	MaxKnownTrips  = 500
	maxCASAttempts = 3
)

type OpsResponse struct {
	ServerTime int64              `json:"server_time"`
	Results    []models.OpResult  `json:"results"`
	Trips      []models.TripDelta `json:"trips"`
}

type SyncResponse struct {
	ServerTime int64                `json:"server_time"`
	Trips      []models.TripDelta   `json:"trips"`
	Removed    []models.RemovedTrip `json:"removed"`
}

type TripService struct {
	rooms    store.RoomRepository
	trips    store.TripRepository
	lists    *ListService
	listRepo store.ListRepository
	now      func() time.Time
}

func NewTripService(rooms store.RoomRepository, tripRepo store.TripRepository, lists *ListService, listRepo store.ListRepository) *TripService {
	return &TripService{rooms: rooms, trips: tripRepo, lists: lists, listRepo: listRepo, now: time.Now}
}

// ApplyOps applies a batch of client ops. Each op gets its own result; the batch only
// fails as a whole for auth problems or a malformed request.
func (s *TripService) ApplyOps(ctx context.Context, user *models.User, roomID string, raws []json.RawMessage) (*OpsResponse, error) {
	if err := ensureRoomMembership(ctx, s.rooms, user, roomID); err != nil {
		return nil, err
	}
	if len(raws) == 0 || len(raws) > MaxOpsPerBatch {
		return nil, derr.ErrBadRequest
	}
	now := s.now().UTC()
	results := make([]models.OpResult, len(raws))
	ops := make([]models.Op, len(raws))
	groups := map[string][]int{}
	var order []string
	for i, raw := range raws {
		op, rejected, ok := trips.DecodeOp(raw)
		if !ok {
			results[i] = rejected
			continue
		}
		ops[i] = op
		if _, seen := groups[op.TripID]; !seen {
			order = append(order, op.TripID)
		}
		groups[op.TripID] = append(groups[op.TripID], i)
	}
	deltas := []models.TripDelta{}
	for _, id := range order {
		d, err := s.applyGroup(ctx, user, roomID, now, ops, groups[id], results)
		if err != nil {
			return nil, err
		}
		if d != nil {
			deltas = append(deltas, *d)
		}
	}
	return &OpsResponse{ServerTime: now.UnixMilli(), Results: results, Trips: deltas}, nil
}

// applyGroup applies the ops of one trip with a compare-and-swap retry loop.
func (s *TripService) applyGroup(ctx context.Context, user *models.User, roomID string, now time.Time, ops []models.Op, idx []int, results []models.OpResult) (*models.TripDelta, error) {
	tripID := ops[idx[0]].TripID
	for attempt := 0; attempt < maxCASAttempts; attempt++ {
		t, err := s.trips.Get(ctx, tripID)
		isNew := false
		switch {
		case errors.Is(err, derr.ErrNotFound):
			t, isNew = trips.NewShell(tripID, roomID, user.UserID, now), true
		case err != nil:
			return nil, err
		case t.RoomID != roomID:
			// Same answer as an unknown trip, so existence in other houses is not revealed.
			for _, i := range idx {
				results[i] = models.OpResult{OpID: ops[i].OpID, Status: models.OpRejected, Code: models.CodeForbiddenOrUnknown}
			}
			return nil, nil
		}
		base := t.Version
		c := trips.Ctx{Actor: user.UserID, Now: now, NewV: base + 1}
		dirty, bump := false, false
		for _, i := range idx {
			r, o := trips.ApplyOp(t, ops[i], c)
			results[i] = r
			dirty, bump = dirty || o.Dirty, bump || o.Bump
		}
		if !dirty || (isNew && !bump) {
			return nil, nil
		}
		trips.PruneTombstones(t, now)
		if bump {
			t.UpdatedAt = now
		}
		if isNew {
			if err := s.trips.Insert(ctx, t); err != nil {
				if errors.Is(err, derr.ErrConflict) {
					continue // lost a create race: reload and apply against the winner
				}
				return nil, err
			}
		} else {
			ok, err := s.trips.ReplaceCAS(ctx, t, base)
			if err != nil {
				return nil, err
			}
			if !ok {
				continue
			}
		}
		if !bump {
			return nil, nil
		}
		var d models.TripDelta
		if isNew {
			d = trips.DeltaSince(t, 0, false)
		} else {
			d = trips.DeltaSince(t, base, true)
		}
		return &d, nil
	}
	for _, i := range idx {
		results[i] = models.OpResult{OpID: ops[i].OpID, Status: models.OpRetry}
	}
	return nil, nil
}

// Sync returns per-trip deltas for everything that differs from the client's known versions.
func (s *TripService) Sync(ctx context.Context, user *models.User, roomID string, known map[string]int64) (*SyncResponse, error) {
	if err := ensureRoomMembership(ctx, s.rooms, user, roomID); err != nil {
		return nil, err
	}
	if len(known) > MaxKnownTrips {
		return nil, derr.ErrBadRequest
	}
	stubs, err := s.trips.Manifest(ctx, roomID)
	if err != nil {
		return nil, err
	}
	resp := &SyncResponse{ServerTime: s.now().UnixMilli(), Trips: []models.TripDelta{}, Removed: []models.RemovedTrip{}}
	onServer := map[string]bool{}
	var need []string
	for _, st := range stubs {
		onServer[st.TripID] = true
		kv, has := known[st.TripID]
		if st.DeletedAt != nil {
			if has {
				resp.Removed = append(resp.Removed, models.RemovedTrip{TripID: st.TripID, DeletedBy: st.DeletedBy})
			}
			continue
		}
		if has && kv == st.Version {
			continue
		}
		need = append(need, st.TripID)
	}
	for id := range known {
		if !onServer[id] {
			resp.Removed = append(resp.Removed, models.RemovedTrip{TripID: id, Purged: true})
		}
	}
	if len(need) > 0 {
		full, err := s.trips.GetMany(ctx, roomID, need)
		if err != nil {
			return nil, err
		}
		for i := range full {
			kv, has := known[full[i].TripID]
			resp.Trips = append(resp.Trips, trips.DeltaSince(&full[i], kv, has))
		}
	}
	sort.Slice(resp.Trips, func(a, b int) bool { return resp.Trips[a].TripID < resp.Trips[b].TripID })
	sort.Slice(resp.Removed, func(a, b int) bool { return resp.Removed[a].TripID < resp.Removed[b].TripID })
	return resp, nil
}

// EnsurePackingList returns the trip's linked packing List, creating and linking it if needed.
// Online-only by design. Linking is a compare-and-swap, so concurrent callers end up
// sharing one List: the loser deletes the List it just created and returns the winner's.
func (s *TripService) EnsurePackingList(ctx context.Context, user *models.User, roomID, tripID string) (*models.List, error) {
	if err := ensureRoomMembership(ctx, s.rooms, user, roomID); err != nil {
		return nil, err
	}
	t, err := s.trips.Get(ctx, tripID)
	if err != nil {
		return nil, err
	}
	if t.RoomID != roomID || t.DeletedAt != nil {
		return nil, derr.ErrNotFound
	}
	if t.PackingListID != nil {
		if l, err := s.listRepo.GetByID(ctx, *t.PackingListID); err == nil && !l.IsDeleted {
			return l, nil
		}
		// stale link: fall through and relink, expecting the stale id
	}
	created, err := s.lists.CreateList(ctx, user, roomID, "Packing · "+t.Title, "", "")
	if err != nil {
		return nil, err
	}
	won, err := s.trips.LinkPackingList(ctx, tripID, roomID, t.PackingListID, created.ListID, s.now().UTC())
	if err != nil {
		_ = s.listRepo.Delete(ctx, created.ListID)
		return nil, err
	}
	if won {
		return created, nil
	}
	_ = s.listRepo.Delete(ctx, created.ListID)
	cur, err := s.trips.Get(ctx, tripID)
	if err != nil {
		return nil, err
	}
	if cur.PackingListID == nil {
		return nil, derr.ErrConflict
	}
	return s.listRepo.GetByID(ctx, *cur.PackingListID)
}
