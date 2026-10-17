package analytics_test

import (
	"context"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

func TestRunPlanAfterIsARunIntervalOfHomeTimeLater(t *testing.T) {
	ctx := context.Background()
	aggs := memstore.NewAggRepo()
	next := time.Date(2026, 10, 3, 9, 0, 0, 0, time.UTC) // a Saturday
	_ = aggs.PutProfile(ctx, &analytics.Profile{ID: "h:room_1", Scope: "h", Owner: "room_1", Containers: map[string]analytics.ContainerRhythm{
		"list:list_1": {Runs: 9, IntervalDay: 7, NextRun: &analytics.NextWindow{Start: next, End: next.Add(3 * time.Hour), Confidence: 0.9}},
	}})
	r := analytics.NewReader(aggs)
	now := next.Add(-48 * time.Hour)
	plan, err := r.RunPlan(ctx, "room_1", "list:list_1", now)
	if err != nil || plan == nil {
		t.Fatalf("%v %v", plan, err)
	}
	if !plan.Next.Start.Equal(next) || !plan.After.Start.Equal(next.AddDate(0, 0, 7)) || plan.After.End.Sub(plan.After.Start) != 3*time.Hour || plan.Confidence != 0.9 {
		t.Fatalf("plan %+v", plan)
	}
	// a 4 day trip between the two runs pushes the one after by 4 days
	trip := predict.Away{{Opens: next.AddDate(0, 0, 2), Closes: next.AddDate(0, 0, 6)}}
	plan, _ = analytics.NewReader(aggs).WithAway(&countingCalendar{calls: map[string]int{}, away: trip}).RunPlan(ctx, "room_1", "list:list_1", now)
	if !plan.After.Start.Equal(next.AddDate(0, 0, 11)) {
		t.Fatalf("after %v", plan.After.Start)
	}
	// a run that went by unseen rolls forward
	plan, _ = r.RunPlan(ctx, "room_1", "list:list_1", next.AddDate(0, 0, 1))
	if !plan.Next.Start.Equal(next.AddDate(0, 0, 7)) {
		t.Fatalf("rolled next %v", plan.Next.Start)
	}
	if p, _ := r.RunPlan(ctx, "room_1", "list:other", now); p != nil {
		t.Fatal("no rhythm on that list: nil")
	}
	if p, _ := r.RunPlan(ctx, "room_x", "list:list_1", now); p != nil {
		t.Fatal("no profile: nil")
	}
}

func TestNeedsBeforeOnTheGoldenHouseholds(t *testing.T) {
	w, aggs := learnedWorld(t)
	ctx := context.Background()
	r := analytics.NewReader(aggs).WithAway(w.Calendar())
	h := w.House("big-family")
	by := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC) // before the next Sunday shop
	groceries, err := r.NeedsBefore(ctx, h.Room, "list:"+h.Room+"_groceries", by, h.Away(), 50)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]float64{}
	for _, n := range groceries {
		got[n.Stat.Key] = n.P
	}
	for _, k := range []string{"rice", "drinking water", "eggs", "chicken"} {
		if got[k] < 0.5 {
			t.Errorf("%s should likely be needed before the next shop: %v", k, got)
		}
	}
	if _, ok := got["vitamins"]; ok {
		t.Error("vitamins live on the pharmacy list")
	}
	for i := 1; i < len(groceries); i++ {
		if groceries[i].P > groceries[i-1].P {
			t.Fatal("most likely first")
		}
	}
	// a house with thin history never clears an assist bar
	n := w.House("new-house")
	thin, _ := r.NeedsBefore(ctx, n.Room, "list:"+n.Room+"_groceries", by.AddDate(0, 1, 0), nil, 50)
	for _, k := range thin {
		if k.P > 0.5 {
			t.Fatalf("thin %s: %v", k.Stat.Key, k.P)
		}
	}
}
