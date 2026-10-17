package services

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/autopilot"
)

// Suggest mode is today's suggestions; assist shows the same slip (only the ticker writes).
func TestSuggestionsParityAcrossModes(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.twoDue()
	ctx := context.Background()
	base := r.suggest()
	if len(base) == 0 {
		t.Fatal("fixture suggests nothing")
	}
	for _, mode := range []string{"suggest", "assist"} {
		if err := r.m.Rooms.SetAutopilotMode(ctx, r.roomID, r.user.UserID, mode, r.now); err != nil {
			t.Fatal(err)
		}
		if got := r.suggest(); !reflect.DeepEqual(got, base) {
			t.Errorf("%s: %+v, want %+v", mode, got, base)
		}
	}
	if err := r.m.Rooms.SetAutopilotMode(ctx, r.roomID, r.user.UserID, "off", r.now); err != nil {
		t.Fatal(err)
	}
	if got := r.suggest(); len(got) != 0 {
		t.Errorf("off: %+v", got)
	}
}

type stubAway struct{ spans predict.Away }

func (s stubAway) HouseAway(context.Context, string) (predict.Away, error) { return s.spans, nil }
func (s stubAway) MemberAway(context.Context, string, string) (predict.Away, error) {
	return s.spans, nil
}

// The adapter hands the planner analytics' own answers: the run plan, the need odds, the away spans.
func TestSignalsAdapterReadsAnalytics(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.twoDue()
	ctx := context.Background()
	trip := predict.Away{{Opens: r.now.Add(48 * time.Hour), Closes: r.now.Add(96 * time.Hour)}}
	r.svc.UseAwayCalendar(stubAway{trip})
	sig := r.svc.signals()

	away, err := sig.Away(ctx, r.roomID)
	if err != nil || len(away) != 1 || !away[0].Opens.Equal(trip[0].Opens) {
		t.Fatalf("away: %v %v", away, err)
	}
	by := r.now.Add(7 * 24 * time.Hour)
	cands, err := sig.Candidates(ctx, r.roomID, r.list, autopilot.HorizonRunAfterNext, r.now, by, away)
	if err != nil {
		t.Fatal(err)
	}
	needs, err := analytics.NewReader(r.m.Aggs).NeedsBefore(ctx, r.roomID, "list:"+r.list, by, away, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) == 0 || len(cands) != len(needs) {
		t.Fatalf("candidates %d, needs %d", len(cands), len(needs))
	}
	for i, n := range needs {
		if cands[i].Key != n.Stat.Key || cands[i].NeedBy != n.P {
			t.Errorf("candidate %d: %s %.3f, want %s %.3f", i, cands[i].Key, cands[i].NeedBy, n.Stat.Key, n.P)
		}
	}
	// No learned run rhythm in this fixture: the adapter says so rather than inventing one.
	if rp, err := sig.RunPlan(ctx, r.roomID, r.list, r.now); err != nil || rp != nil {
		t.Fatalf("run plan: %+v %v", rp, err)
	}
}
