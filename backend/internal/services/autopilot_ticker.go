package services

import (
	"context"
	"errors"
	"log"
	"math/rand"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/autopilot"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/pkg/ids"
)

const (
	// autopilotLeaseTTL outlives one tick; another instance takes over once it lapses.
	autopilotLeaseTTL = 5 * time.Minute
	// autopilotHouseScan bounds the assist houses one tick visits.
	autopilotHouseScan = 1000
	// expireAfterRun: an applied item still unchecked this long after its run started is expired
	// (the run is over and a day has passed).
	expireAfterRun = 30 * time.Hour
	// viewWindow is how far back the read view shows applied actions.
	viewWindow = 7 * 24 * time.Hour
	// defaultAutopilotLead is how close the next run must be before assist plans for it.
	defaultAutopilotLead = 18 * time.Hour
)

// UseLead sets AUTOPILOT_LEAD (zero keeps the default).
func (s *AutopilotService) UseLead(d time.Duration) {
	if d > 0 {
		s.lead = d
	}
}

func (s *AutopilotService) leadOrDefault() time.Duration {
	if s.lead > 0 {
		return s.lead
	}
	return defaultAutopilotLead
}

// TickOnce plans and applies for every house on assist, and expires what its runs left unbought.
// It takes the ticker lease first, so on many instances one does the work; the unique action key
// keeps it exact even if two overlap. It returns how many items it added.
func (s *AutopilotService) TickOnce(ctx context.Context) (int, error) {
	if !s.enabled() || s.actions == nil || s.listSvc == nil {
		return 0, nil
	}
	now := s.now().UTC()
	ok, err := s.actions.AcquireLease(ctx, s.owner, autopilotLeaseTTL, now)
	if err != nil || !ok {
		return 0, err
	}
	var rooms []string
	for _, m := range autopilot.Tiers[autopilot.FeatureAutoAdd] {
		ids, err := s.rooms.ListIDsByAutopilotMode(ctx, string(m), autopilotHouseScan)
		if err != nil {
			return 0, err
		}
		rooms = append(rooms, ids...)
	}
	added := 0
	for _, roomID := range rooms {
		n, err := s.tickHouse(ctx, roomID, now)
		if err != nil {
			log.Printf("autopilot: house %s: %v", roomID, err)
		}
		added += n
		if err := s.expire(ctx, roomID, now); err != nil {
			log.Printf("autopilot: expire house %s: %v", roomID, err)
		}
	}
	return added, nil
}

func (s *AutopilotService) tickHouse(ctx context.Context, roomID string, now time.Time) (int, error) {
	room, err := s.rooms.GetByID(ctx, roomID)
	if err != nil {
		return 0, err
	}
	// Re-read per house: a switch away from assist stops it at once.
	if !autopilot.Has(houseMode(room), autopilot.FeatureAutoAdd) {
		return 0, nil
	}
	lists, err := s.lists.ListByRoom(ctx, roomID)
	if err != nil {
		return 0, err
	}
	added := 0
	for _, l := range lists {
		if l.IsDeleted {
			continue
		}
		snap, err := autopilot.Gather(ctx, s.signals(), autopilot.Query{
			RoomID: roomID, ListID: l.ListID, Horizon: autopilot.HorizonRunAfterNext, Now: now,
			Limit: s.policy.MaxPerRun, Lead: s.leadOrDefault(),
		}, s.policy)
		if err != nil {
			return added, err
		}
		for _, pr := range autopilot.Plan(snap, s.policy) {
			if autopilot.Decide(autopilot.ModeAssist, pr, s.policy) != autopilot.Apply {
				continue // neither bar cleared, or not in-app
			}
			a, err := s.Apply(ctx, roomID, pr)
			if err != nil {
				return added, err
			}
			if a != nil {
				added++
			}
		}
	}
	return added, nil
}

// expire resolves applied actions whose run is over: confirmed if the item was bought after all
// (a missed hook), expired if it is still waiting, removed if it went without a hook (a clear).
func (s *AutopilotService) expire(ctx context.Context, roomID string, now time.Time) error {
	applied, err := s.actions.ListApplied(ctx, roomID)
	if err != nil {
		return err
	}
	for _, a := range applied {
		if a.RunAt.IsZero() || now.Sub(a.RunAt) < expireAfterRun {
			continue
		}
		to := models.ActionExpired
		if it, err := s.items.GetByID(ctx, a.ItemID); err == nil && it.Completed {
			to = models.ActionConfirmed
		}
		if _, err := s.actions.Resolve(ctx, a.ActionID, []string{models.ActionApplied}, to, now); err != nil {
			return err
		}
	}
	return nil
}

// RunTicker ticks on a jittered timer until ctx ends, like the analytics fold.
func (s *AutopilotService) RunTicker(ctx context.Context, every, jitter time.Duration) {
	for {
		if n, err := s.TickOnce(ctx); err != nil {
			log.Printf("autopilot: tick: %v", err)
		} else if n > 0 {
			log.Printf("autopilot: added %d items", n)
		}
		wait := every
		if jitter > 0 {
			wait += time.Duration(rand.Int63n(int64(jitter)))
		}
		t := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-t.C:
		}
	}
}

// AppliedView is one thing autopilot put on the list, for the app's mark, reason and slip.
type AppliedView struct {
	ActionID   string                 `json:"action_id"`
	ItemID     string                 `json:"item_id"`
	Key        string                 `json:"key"`
	State      string                 `json:"state"`
	RunAt      time.Time              `json:"run_at"`
	Reason     models.AutopilotReason `json:"reason"`
	Confidence float64                `json:"confidence"`
}

// AutopilotView is GET .../autopilot: the house's mode, what autopilot applied to this list lately
// (still wanted or bought), and what it suggests.
type AutopilotView struct {
	Mode        autopilot.Mode      `json:"mode"`
	Features    []autopilot.Feature `json:"features"`
	Applied     []AppliedView       `json:"applied"`
	Suggestions []Suggestion        `json:"suggestions"`
}

// View reads the list's autopilot. It never applies anything.
func (s *AutopilotService) View(ctx context.Context, user *models.User, roomID, listID string) (*AutopilotView, error) {
	room, err := s.checkList(ctx, user, roomID, listID)
	if err != nil {
		return nil, err
	}
	v := &AutopilotView{Mode: houseMode(room), Features: autopilot.Features(houseMode(room)), Applied: []AppliedView{}, Suggestions: []Suggestion{}}
	if s.actions != nil {
		acts, err := s.actions.ListByList(ctx, listID, s.now().Add(-viewWindow))
		if err != nil {
			return nil, err
		}
		for _, a := range acts {
			if a.RoomID != roomID || (a.State != models.ActionApplied && a.State != models.ActionConfirmed) {
				continue
			}
			v.Applied = append(v.Applied, AppliedView{ActionID: a.ActionID, ItemID: a.ItemID, Key: a.Key, State: a.State, RunAt: a.RunAt, Reason: a.Reason, Confidence: a.Confidence})
		}
	}
	if v.Suggestions, err = s.Suggestions(ctx, user, roomID, listID, 3, ""); err != nil {
		return nil, err
	}
	return v, nil
}

// Undo takes back one applied action: the item leaves the list and the miss is recorded. Undoing
// an action already undone is a no-op; one resolved otherwise (bought, deleted) is a conflict.
func (s *AutopilotService) Undo(ctx context.Context, user *models.User, roomID, listID, actionID string) error {
	if _, err := s.checkList(ctx, user, roomID, listID); err != nil {
		return err
	}
	if s.actions == nil || s.listSvc == nil {
		return derr.ErrNotFound
	}
	a, err := s.actions.GetByID(ctx, actionID)
	if err != nil {
		return err
	}
	if a.RoomID != roomID || a.ListID != listID {
		return derr.ErrNotFound
	}
	if !s.resolveMiss(ctx, a, user.UserID, models.ActionUndone, "undo") {
		if cur, err := s.actions.GetByID(ctx, actionID); err == nil && cur.State == models.ActionUndone {
			return nil
		}
		return derr.ErrConflict
	}
	it, err := s.items.GetByID(ctx, a.ItemID)
	if errors.Is(err, derr.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	return s.listSvc.RemoveSystemItem(ctx, user.UserID, it)
}

func newTickerOwner() string { return ids.NewID("tick") }
