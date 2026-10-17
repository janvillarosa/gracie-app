package services

import (
	"context"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/autopilot"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/households"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

// assistRig is a suggestRig whose service can apply, with list hooks wired back to it.
func assistRig(t *testing.T) *suggestRig {
	t.Helper()
	r := newSuggestRig(t, SuggestionsOn)
	r.svc.UseExecutor(r.m.Autopilot, r.lists)
	r.lists.UseItemHooks(r.svc)
	return r
}

func restock(r *suggestRig, key, cycle string) autopilot.Proposal {
	return autopilot.Proposal{
		Kind: autopilot.KindRestock, ListID: r.list, Key: key, Display: "Whole milk", Quantity: "2", Confidence: 0.9, Need: 0.9,
		Reason: autopilot.Reason{Code: autopilot.ReasonEveryDays, Params: map[string]any{"days": 7}},
		Cycle:  cycle, RunAt: r.now.Add(10 * time.Hour), Effect: autopilot.EffectAddToList,
	}
}

func (r *suggestRig) eventsNamed(name string) []analytics.Event {
	var out []analytics.Event
	for _, e := range r.m.Events.All() {
		if e.Name == name {
			out = append(out, e)
		}
	}
	return out
}

func TestExecutorRefusesExternalEffects(t *testing.T) {
	r := assistRig(t)
	pr := restock(r, "whole milk", "c1")
	pr.Effect = "buy"
	if a, err := r.svc.Apply(context.Background(), r.roomID, pr); err != ErrExternalEffect || a != nil {
		t.Fatalf("external effect: %+v %v", a, err)
	}
	if items, _ := r.m.Items.ListByList(context.Background(), r.list); len(items) != 0 {
		t.Fatalf("an item was created: %+v", items)
	}
}

func TestApplyInsertsThenCreatesItem(t *testing.T) {
	r := assistRig(t)
	ctx := context.Background()
	a, err := r.svc.Apply(ctx, r.roomID, restock(r, "whole milk", "c1"))
	if err != nil || a == nil || a.ItemID == "" || a.State != models.ActionApplied {
		t.Fatalf("apply: %+v %v", a, err)
	}
	it, err := r.m.Items.GetByID(ctx, a.ItemID)
	if err != nil || it.Source != SourceAutopilot || it.CreatedBy != ActorAutopilot || it.Description != "Whole milk" || it.Quantity != "2" {
		t.Fatalf("item: %+v %v", it, err)
	}
	if n := len(r.eventsNamed("item.autopilot_added")); n != 1 {
		t.Fatalf("autopilot_added events: %d", n)
	}
	if n := len(r.eventsNamed("item.added")); n != 0 {
		t.Fatalf("an autopilot add was recorded as a request: %d item.added", n)
	}
	if got := r.eventsNamed("item.autopilot_added")[0].ActorID; got != ActorAutopilot {
		t.Fatalf("actor %q", got)
	}
}

func TestApplyDuplicateIsNoop(t *testing.T) {
	r := assistRig(t)
	ctx := context.Background()
	if _, err := r.svc.Apply(ctx, r.roomID, restock(r, "whole milk", "c1")); err != nil {
		t.Fatal(err)
	}
	if a, err := r.svc.Apply(ctx, r.roomID, restock(r, "whole milk", "c1")); err != nil || a != nil {
		t.Fatalf("second apply: %+v %v", a, err)
	}
	if items, _ := r.m.Items.ListByList(ctx, r.list); len(items) != 1 {
		t.Fatalf("items: %d", len(items))
	}
}

func TestApplyRollsBackWhenTheItemFails(t *testing.T) {
	r := assistRig(t)
	pr := restock(r, "whole milk", "c1")
	pr.ListID = "list_gone"
	if _, err := r.svc.Apply(context.Background(), r.roomID, pr); err == nil {
		t.Fatal("applied to a missing list")
	}
	if got, _ := r.m.Autopilot.ListApplied(context.Background(), r.roomID); len(got) != 0 {
		t.Fatalf("action kept after a failed create: %+v", got)
	}
}

func TestCheckingAnAutopilotItemConfirms(t *testing.T) {
	r := assistRig(t)
	ctx := context.Background()
	a, _ := r.svc.Apply(ctx, r.roomID, restock(r, "whole milk", "c1"))
	done := true
	if _, err := r.lists.UpdateItem(ctx, r.user, r.roomID, r.list, a.ItemID, nil, &done, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	if got, _ := r.m.Autopilot.GetByID(ctx, a.ActionID); got.State != models.ActionConfirmed {
		t.Fatalf("state %s", got.State)
	}
	// A confirmed item tidied away later is not a miss.
	if err := r.lists.DeleteItem(ctx, r.user, r.roomID, r.list, a.ItemID); err != nil {
		t.Fatal(err)
	}
	if got, _ := r.m.Autopilot.GetByID(ctx, a.ActionID); got.State != models.ActionConfirmed || len(r.eventsNamed("item.autopilot_removed")) != 0 {
		t.Fatalf("tidying counted as a miss: %s", got.State)
	}
}

func TestDeleteAutopilotItemMarksRemoved(t *testing.T) {
	r := assistRig(t)
	ctx := context.Background()
	a, _ := r.svc.Apply(ctx, r.roomID, restock(r, "whole milk", "c1"))
	if err := r.lists.DeleteItem(ctx, r.user, r.roomID, r.list, a.ItemID); err != nil {
		t.Fatal(err)
	}
	if got, _ := r.m.Autopilot.GetByID(ctx, a.ActionID); got.State != models.ActionRemoved || got.ResolvedAt == nil {
		t.Fatalf("state %+v", got)
	}
	evs := r.eventsNamed("item.autopilot_removed")
	if len(evs) != 1 || evs[0].ActorID != r.user.UserID || evs[0].Props["via"] != "delete" || evs[0].Key != "whole milk" {
		t.Fatalf("dismiss: %+v", evs)
	}
}

// Removing an autopilot item closes its cycle: no re-add, and the slip does not offer it again.
func TestRemovedNotReaddedSameCycle(t *testing.T) {
	r := assistRig(t)
	r.weekly("whole milk", r.list)
	r.fold()
	ctx := context.Background()
	prs := r.suggest()
	if len(prs) != 1 {
		t.Fatalf("fixture: %+v", prs)
	}
	cycle := r.m.Aggs.Key(r.roomID + ":item:whole milk")["intervals"].(analytics.KeyIntervals).Add.LastAt.UTC().Format("2006-01-02")
	a, err := r.svc.Apply(ctx, r.roomID, restock(r, "whole milk", cycle))
	if err != nil || a == nil {
		t.Fatalf("apply: %+v %v", a, err)
	}
	if err := r.lists.DeleteItem(ctx, r.user, r.roomID, r.list, a.ItemID); err != nil {
		t.Fatal(err)
	}
	if again, err := r.svc.Apply(ctx, r.roomID, restock(r, "whole milk", cycle)); err != nil || again != nil {
		t.Fatalf("re-added in the same cycle: %+v %v", again, err)
	}
	if got := r.suggest(); len(got) != 0 {
		t.Fatalf("suggested again after removal: %+v", got)
	}
}

// A golden household on assist for ten cycles: autopilot adds, they buy. The rhythm holds.
func TestAssistTenCyclesStableRhythm(t *testing.T) {
	world := households.Golden()
	house := world.House("weekend-couple")
	m := memstore.Compose()
	reg := analytics.NewRegistry()
	RegisterAnalyticsEvents(reg)
	var evs []analytics.Event
	var lastBuy time.Time
	for _, e := range world.Events {
		if e.RoomID == house.Room {
			evs = append(evs, e)
			if e.Key == "eggs" && e.Name == "item.checked" && e.OccurredAt.After(lastBuy) {
				lastBuy = e.OccurredAt
			}
		}
	}
	listID := ""
	for _, e := range evs {
		if e.Key == "eggs" && e.Container != nil {
			listID = e.Container.ID
			break
		}
	}
	for i := 1; i <= 10; i++ { // ten weekly cycles on assist after the golden year
		buy := lastBuy.AddDate(0, 0, 7*i)
		added := analytics.Event{EventID: "ap_add_" + buy.Format(time.RFC3339), Name: "item.autopilot_added", ActorID: ActorAutopilot, RoomID: house.Room, Key: "eggs",
			Subject: analytics.Ref{Type: "item", ID: "i"}, Container: &analytics.Ref{Type: "list", ID: listID}, OccurredAt: buy.Add(-20 * time.Hour)}
		checked := added
		checked.EventID, checked.Name, checked.ActorID, checked.OccurredAt = "ap_chk_"+buy.Format(time.RFC3339), "item.checked", house.Members[0], buy
		analytics.Stamp(&added, added.OccurredAt.Add(time.Minute), house.TZ, 400*24*time.Hour)
		analytics.Stamp(&checked, checked.OccurredAt.Add(time.Minute), house.TZ, 400*24*time.Hour)
		evs = append(evs, added, checked)
	}
	if err := m.Events.InsertMany(context.Background(), evs); err != nil {
		t.Fatal(err)
	}
	end := lastBuy.AddDate(0, 0, 75)
	w := analytics.NewWorker(m.Events, m.Aggs, reg).WithAway(world.Calendar()).WithClock(func() time.Time { return end })
	for {
		n, err := w.FoldOnce(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if n == 0 {
			break
		}
	}
	iv := m.Aggs.Key(house.Room + ":item:eggs")["intervals"].(analytics.KeyIntervals)
	a := iv.Add
	if a == nil || a.Series != "checked" || a.EWMADays < 6 || a.EWMADays > 8 || a.Score < autopilot.DefaultPolicy.SuggestMinScore {
		t.Fatalf("rhythm drifted on assist: %+v", a)
	}
	for _, who := range iv.Turns {
		if who == ActorAutopilot {
			t.Fatalf("autopilot counted as a person: %v", iv.Turns)
		}
	}
}
