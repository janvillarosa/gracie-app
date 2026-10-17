package services

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"sort"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
	"github.com/janvillarosa/gracie-app/backend/internal/tzlookup"
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
	tz       tzlookup.Resolver // optional: derives tz for Google places sent without one
	emitter
}

func NewTripService(rooms store.RoomRepository, tripRepo store.TripRepository, lists *ListService, listRepo store.ListRepository) *TripService {
	return &TripService{rooms: rooms, trips: tripRepo, lists: lists, listRepo: listRepo, now: time.Now}
}

// UseTZ injects the (lazy) coordinate-to-zone resolver used for Google places without a tz.
func (s *TripService) UseTZ(r tzlookup.Resolver) { s.tz = r }

func (s *TripService) tzFunc() func(lat, lng float64) string {
	if s.tz == nil {
		return nil
	}
	return s.tz.TZ
}

// ApplyOps applies a batch of client ops. Each op gets its own result; the batch only
// fails as a whole for auth problems or a malformed request.
func (s *TripService) ApplyOps(ctx context.Context, user *models.User, roomID string, raws []json.RawMessage) (*OpsResponse, error) {
	if err := ensureRoomMembership(ctx, s.rooms, user, roomID); err != nil {
		return nil, err
	}
	rm, err := s.rooms.GetByID(ctx, roomID)
	if err != nil {
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
		d, err := s.applyGroup(ctx, user, roomID, rm.MemberIDs, now, ops, orderBySeq(ops, groups[id]), results)
		if err != nil {
			return nil, err
		}
		if d != nil {
			deltas = append(deltas, *d)
		}
	}
	return &OpsResponse{ServerTime: now.UnixMilli(), Results: results, Trips: deltas}, nil
}

// orderBySeq stable-sorts a trip's ops by seq per client_id (clients keep their first-seen
// order), so a batch whose array order disagrees with seq order is not silently dropped as
// "duplicate". Only one flusher may run per client_id: seqs are a total order per device.
func orderBySeq(ops []models.Op, idx []int) []int {
	rank := map[string]int{}
	for _, i := range idx {
		if _, ok := rank[ops[i].ClientID]; !ok {
			rank[ops[i].ClientID] = len(rank)
		}
	}
	out := append([]int(nil), idx...)
	sort.SliceStable(out, func(a, b int) bool {
		x, y := ops[out[a]], ops[out[b]]
		if rank[x.ClientID] != rank[y.ClientID] {
			return rank[x.ClientID] < rank[y.ClientID]
		}
		return x.Seq < y.Seq
	})
	return out
}

// storageFailure turns a per-trip storage error into per-op "retry" results so one bad trip
// never fails (or hides the outcome of) the other trips in the batch. Only a dead context
// aborts the whole request.
func storageFailure(ctx context.Context, tripID string, err error, ops []models.Op, idx []int, results []models.OpResult) error {
	if cerr := ctx.Err(); cerr != nil {
		return cerr
	}
	log.Printf("trips: storage error for %s: %v", tripID, err)
	for _, i := range idx {
		results[i] = models.OpResult{OpID: ops[i].OpID, Status: models.OpRetry}
	}
	return nil
}

// applyGroup applies the ops of one trip with a compare-and-swap retry loop.
func (s *TripService) applyGroup(ctx context.Context, user *models.User, roomID string, members []string, now time.Time, ops []models.Op, idx []int, results []models.OpResult) (*models.TripDelta, error) {
	tripID := ops[idx[0]].TripID
	for attempt := 0; attempt < maxCASAttempts; attempt++ {
		t, err := s.trips.Get(ctx, tripID)
		isNew := false
		switch {
		case errors.Is(err, derr.ErrNotFound):
			t, isNew = trips.NewShell(tripID, roomID, user.UserID, now), true
		case err != nil:
			return nil, storageFailure(ctx, tripID, err, ops, idx, results)
		case t.RoomID != roomID:
			// Same answer as an unknown trip, so existence in other houses is not revealed.
			for _, i := range idx {
				results[i] = models.OpResult{OpID: ops[i].OpID, Status: models.OpRejected, Code: models.CodeForbiddenOrUnknown}
			}
			return nil, nil
		}
		base := t.Version
		c := trips.Ctx{Actor: user.UserID, Now: now, NewV: base + 1, TZ: s.tzFunc(), Members: append([]string{}, members...)}
		dirty, bump := false, false
		var pending []analytics.Event // emitted only once this attempt is persisted
		newClients := map[string]bool{}
		for _, i := range idx {
			if cid := ops[i].ClientID; !newClients[cid] {
				if _, known := t.Acked[cid]; !known {
					if len(newClients) >= trips.MaxNewClientsPerBatch {
						results[i] = models.OpResult{OpID: ops[i].OpID, Status: models.OpRejected, Code: models.CodeCap}
						continue
					}
					newClients[cid] = true
				}
			}
			r, o := trips.ApplyOp(t, ops[i], c)
			results[i] = r
			dirty, bump = dirty || o.Dirty, bump || o.Bump
			if s.rec != nil {
				// derived per op, against the trip as that op left it
				pending = append(pending, trips.EventsFor(t, ops[i], r, user.UserID, now, analytics.TZFrom(ctx))...)
			}
		}
		if !dirty || (isNew && !bump) {
			return nil, nil
		}
		trips.Prune(t, now)
		if bump {
			t.UpdatedAt = now
		}
		if isNew {
			if err := s.trips.Insert(ctx, t); err != nil {
				if errors.Is(err, derr.ErrConflict) {
					continue // lost a create race: reload and apply against the winner
				}
				return nil, storageFailure(ctx, tripID, err, ops, idx, results)
			}
		} else {
			ok, err := s.trips.ReplaceCAS(ctx, t, base)
			if err != nil {
				return nil, storageFailure(ctx, tripID, err, ops, idx, results)
			}
			if !ok {
				continue
			}
		}
		for _, ev := range pending {
			s.emit(ctx, ev)
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
		l, err := s.listRepo.GetByID(ctx, *t.PackingListID)
		switch {
		case err == nil && !l.IsDeleted && l.RoomID == roomID:
			return l, nil
		case err == nil, errors.Is(err, derr.ErrNotFound):
			// stale link (list deleted, or left behind in another room after a join):
			// fall through and relink, expecting the stale id
		default:
			return nil, err
		}
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
		props := map[string]any{}
		if days, ok := trips.DaysToStart(t, analytics.LocalAt(s.now(), analytics.TZFrom(ctx)).Date); ok {
			props["days_to_start"] = days
		}
		s.emit(ctx, analytics.Event{Name: "trip.packing_list_created", ActorID: user.UserID, RoomID: roomID, Subject: analytics.Ref{Type: "trip", ID: tripID}, Props: props})
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
