package services

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

// assistHouse is an assist rig whose house shops weekly, with a run planned nextRunIn from now,
// and two staples with a perfect recent track record (above the assist bar).
func assistHouse(t *testing.T, nextRunIn time.Duration) *suggestRig {
	t.Helper()
	r := assistRig(t)
	for _, key := range []string{"whole milk", "eggs"} {
		var ago []float64
		for w := 14; w >= 1; w-- {
			ago = append(ago, float64(7*w))
		}
		r.history("item.added", key, r.list, ago...)
	}
	r.fold()
	r.setRun(nextRunIn)
	if err := r.m.Rooms.SetAutopilotMode(context.Background(), r.roomID, r.user.UserID, "assist", r.now); err != nil {
		t.Fatal(err)
	}
	return r
}

func (r *suggestRig) setRun(in time.Duration) {
	start := r.now.Add(in)
	_ = r.m.Aggs.PutProfile(context.Background(), &analytics.Profile{ID: "h:" + r.roomID, Scope: "h", Owner: r.roomID,
		Containers: map[string]analytics.ContainerRhythm{"list:" + r.list: {Runs: 12, IntervalDay: 7,
			NextRun: &analytics.NextWindow{Start: start, End: start.Add(time.Hour), Confidence: 0.8}}}})
}

func (r *suggestRig) autopilotItems() []models.ListItem {
	items, _ := r.m.Items.ListByList(context.Background(), r.list)
	var out []models.ListItem
	for _, it := range items {
		if it.Source == SourceAutopilot {
			out = append(out, it)
		}
	}
	return out
}

func (r *suggestRig) tick() int {
	r.t.Helper()
	n, err := r.svc.TickOnce(context.Background())
	if err != nil {
		r.t.Fatal(err)
	}
	return n
}

func TestTickWritesOnlyInAssist(t *testing.T) {
	r := assistHouse(t, 10*time.Hour)
	ctx := context.Background()
	_ = r.m.Rooms.SetAutopilotMode(ctx, r.roomID, r.user.UserID, "suggest", r.now)
	if n := r.tick(); n != 0 || len(r.autopilotItems()) != 0 {
		t.Fatalf("suggest mode wrote %d", n)
	}
	_ = r.m.Rooms.SetAutopilotMode(ctx, r.roomID, r.user.UserID, "assist", r.now)
	if n := r.tick(); n != 2 || len(r.autopilotItems()) != 2 {
		t.Fatalf("assist added %d (items %d)", n, len(r.autopilotItems()))
	}
	if n := r.tick(); n != 0 || len(r.autopilotItems()) != 2 {
		t.Fatalf("second tick added %d", n)
	}
	_ = r.m.Rooms.SetAutopilotMode(ctx, r.roomID, r.user.UserID, "off", r.now)
	if n := r.tick(); n != 0 {
		t.Fatalf("off added %d", n)
	}
}

func TestTickOutsideLeadDoesNothing(t *testing.T) {
	r := assistHouse(t, 30*time.Hour)
	if n := r.tick(); n != 0 {
		t.Fatalf("planned a run 30 h out: %d", n)
	}
	r.svc.UseLead(36 * time.Hour)
	if n := r.tick(); n != 2 {
		t.Fatalf("within a 36 h lead: %d", n)
	}
}

func TestTickSkipsHouseAway(t *testing.T) {
	r := assistHouse(t, 10*time.Hour)
	r.svc.UseAwayCalendar(stubAway{predict.Away{{Opens: r.now, Closes: r.now.Add(5 * 24 * time.Hour)}}})
	if n := r.tick(); n != 0 || len(r.autopilotItems()) != 0 {
		t.Fatalf("added while the house is away: %d", n)
	}
}

// Two instances ticking, and two applies racing, still add each thing once.
func TestConcurrentTicksAddOnce(t *testing.T) {
	r := assistHouse(t, 10*time.Hour)
	other := NewAutopilotService(r.m.Rooms, r.m.Lists, r.m.Items, analytics.NewReader(r.m.Aggs), r.m.Events, SuggestionsOn).WithClock(func() time.Time { return r.now })
	other.UseExecutor(r.m.Autopilot, r.lists)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		for _, s := range []*AutopilotService{r.svc, other} {
			wg.Add(1)
			go func(s *AutopilotService) {
				defer wg.Done()
				_, _ = s.TickOnce(context.Background())
			}(s)
		}
	}
	wg.Wait()
	if n := len(r.autopilotItems()); n != 2 {
		t.Fatalf("items after racing ticks: %d", n)
	}
	// Without the lease in the way: the unique action key alone keeps it to one.
	pr := restock(r, "bread", "2026-10-01")
	for i := 0; i < 8; i++ {
		for _, s := range []*AutopilotService{r.svc, other} {
			wg.Add(1)
			go func(s *AutopilotService) {
				defer wg.Done()
				_, _ = s.Apply(context.Background(), r.roomID, pr)
			}(s)
		}
	}
	wg.Wait()
	if n := len(r.autopilotItems()); n != 3 {
		t.Fatalf("items after racing applies: %d", n)
	}
}

func TestTickExpiresStaleActions(t *testing.T) {
	r := assistHouse(t, 10*time.Hour)
	ctx := context.Background()
	r.tick()
	items := r.autopilotItems()
	// One was bought without the hook firing (say, an old client); the other waits unbought.
	if err := r.m.Items.UpdateCompletion(ctx, items[0].ItemID, true, r.user.UserID, r.now); err != nil {
		t.Fatal(err)
	}
	r.now = r.now.Add(10*time.Hour + expireAfterRun + time.Minute)
	r.setRun(7 * 24 * time.Hour) // next week's run: nothing new to plan now
	r.tick()
	states := map[string]string{}
	acts, _ := r.m.Autopilot.ListByList(ctx, r.list, time.Time{})
	for _, a := range acts {
		states[a.ItemID] = a.State
	}
	if states[items[0].ItemID] != models.ActionConfirmed || states[items[1].ItemID] != models.ActionExpired {
		t.Fatalf("states: %v", states)
	}
}

func TestViewNeverApplies(t *testing.T) {
	r := assistHouse(t, 10*time.Hour)
	ctx := context.Background()
	v, err := r.svc.View(ctx, r.user, r.roomID, r.list)
	if err != nil {
		t.Fatal(err)
	}
	if v.Mode != "assist" || len(v.Applied) != 0 || len(r.autopilotItems()) != 0 {
		t.Fatalf("view applied something: %+v", v)
	}
	r.tick()
	v, _ = r.svc.View(ctx, r.user, r.roomID, r.list)
	if len(v.Applied) != 2 || v.Applied[0].Reason.Code != "every_days" || v.Applied[0].ItemID == "" {
		t.Fatalf("applied: %+v", v.Applied)
	}
}

// Between the bars assist adds nothing; the same item is offered as a suggestion instead.
func TestAssistFallbackIsSameItem(t *testing.T) {
	r := assistRig(t)
	ctx := context.Background()
	r.history("item.added", "yogurt", r.list, 56, 49, 42, 35, 28, 21, 14, 7) // a short record: score ~0.7
	r.fold()
	r.setRun(10 * time.Hour)
	_ = r.m.Rooms.SetAutopilotMode(ctx, r.roomID, r.user.UserID, "assist", r.now)
	if n := r.tick(); n != 0 {
		t.Fatalf("applied below the assist bar: %d", n)
	}
	v, err := r.svc.View(ctx, r.user, r.roomID, r.list)
	if err != nil || len(v.Suggestions) != 1 || v.Suggestions[0].Key != "yogurt" {
		t.Fatalf("fallback: %+v %v", v, err)
	}
}

func TestUndoMarksUndoneAndDismisses(t *testing.T) {
	r := assistHouse(t, 10*time.Hour)
	ctx := context.Background()
	r.tick()
	v, _ := r.svc.View(ctx, r.user, r.roomID, r.list)
	a := v.Applied[0]
	if err := r.svc.Undo(ctx, r.user, r.roomID, r.list, a.ActionID); err != nil {
		t.Fatal(err)
	}
	if _, err := r.m.Items.GetByID(ctx, a.ItemID); err != derr.ErrNotFound {
		t.Fatalf("item kept after undo: %v", err)
	}
	if got, _ := r.m.Autopilot.GetByID(ctx, a.ActionID); got.State != models.ActionUndone {
		t.Fatalf("state %s", got.State)
	}
	evs := r.eventsNamed("item.autopilot_removed")
	if len(evs) != 1 || evs[0].Props["via"] != "undo" || evs[0].ActorID != r.user.UserID {
		t.Fatalf("dismiss: %+v", evs)
	}
	if err := r.svc.Undo(ctx, r.user, r.roomID, r.list, a.ActionID); err != nil || len(r.eventsNamed("item.autopilot_removed")) != 1 {
		t.Fatalf("second undo: %v", err)
	}
	// The other one was bought: too late to undo.
	b := v.Applied[1]
	done := true
	if _, err := r.lists.UpdateItem(ctx, r.user, r.roomID, r.list, b.ItemID, nil, &done, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := r.svc.Undo(ctx, r.user, r.roomID, r.list, b.ActionID); err != derr.ErrConflict {
		t.Fatalf("undo a bought item: %v", err)
	}
	if err := r.svc.Undo(ctx, r.user, r.roomID, r.other, b.ActionID); err != derr.ErrNotFound {
		t.Fatalf("undo on the wrong list: %v", err)
	}
	// Undone this cycle: the next tick does not add it back.
	if n := r.tick(); n != 0 {
		t.Fatalf("re-added after undo: %d", n)
	}
}
