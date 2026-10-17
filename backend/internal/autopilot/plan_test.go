package autopilot_test

import (
	"context"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/autopilot"
	"github.com/janvillarosa/gracie-app/backend/internal/autopilot/autopilottest"
)

var now = time.Date(2026, 10, 17, 9, 0, 0, 0, time.UTC)

const list = "list_1"

func gather(t *testing.T, f *autopilottest.Signals, h autopilot.Horizon, limit int) autopilot.Snapshot {
	t.Helper()
	s, err := autopilot.Gather(context.Background(), f, autopilot.Query{RoomID: "room_1", ListID: list, Horizon: h, Now: now, Limit: limit}, autopilot.DefaultPolicy)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func keys(prs []autopilot.Proposal) []string {
	out := make([]string, len(prs))
	for i, p := range prs {
		out[i] = p.Key
	}
	return out
}

func TestDecideModesByBand(t *testing.T) {
	p := autopilot.DefaultPolicy
	band := func(score, need float64) autopilot.Proposal {
		return autopilot.Proposal{Confidence: score, Need: need, Effect: autopilot.EffectAddToList}
	}
	cases := []struct {
		name string
		pr   autopilot.Proposal
		want map[autopilot.Mode]autopilot.Disposition
	}{
		{"below suggest", band(0.5, 0.99), map[autopilot.Mode]autopilot.Disposition{autopilot.ModeOff: autopilot.Drop, autopilot.ModeSuggest: autopilot.Drop, autopilot.ModeAssist: autopilot.Drop}},
		{"between bars", band(0.7, 0.99), map[autopilot.Mode]autopilot.Disposition{autopilot.ModeOff: autopilot.Drop, autopilot.ModeSuggest: autopilot.Suggest, autopilot.ModeAssist: autopilot.Suggest}},
		{"above assist", band(0.85, 0.75), map[autopilot.Mode]autopilot.Disposition{autopilot.ModeOff: autopilot.Drop, autopilot.ModeSuggest: autopilot.Suggest, autopilot.ModeAssist: autopilot.Apply}},
		{"high score, low need", band(0.95, 0.4), map[autopilot.Mode]autopilot.Disposition{autopilot.ModeOff: autopilot.Drop, autopilot.ModeSuggest: autopilot.Suggest, autopilot.ModeAssist: autopilot.Suggest}},
		{"external effect", autopilot.Proposal{Confidence: 0.99, Need: 0.99, Effect: "buy"}, map[autopilot.Mode]autopilot.Disposition{autopilot.ModeOff: autopilot.Drop, autopilot.ModeSuggest: autopilot.Suggest, autopilot.ModeAssist: autopilot.Suggest}},
	}
	for _, c := range cases {
		for m, want := range c.want {
			if got := autopilot.Decide(m, c.pr, p); got != want {
				t.Errorf("%s / %s: %s, want %s", c.name, m, got, want)
			}
		}
	}
}

func TestPlanSkipsOnListAndLookAlikes(t *testing.T) {
	f := &autopilottest.Signals{
		Cands: []autopilot.Candidate{
			autopilottest.Weekly("oranges", list, now),
			autopilottest.Weekly("orange", list, now), // look-alike of a key already taken
			autopilottest.Weekly("whole milk", list, now),
			autopilottest.Weekly("bread", list, now),
		},
		Listed: []string{"whole milks"}, // a look-alike of whole milk is on the list
	}
	got := keys(autopilot.Plan(gather(t, f, autopilot.HorizonNow, 5), autopilot.DefaultPolicy))
	if len(got) != 2 || got[0] != "oranges" || got[1] != "bread" {
		t.Fatalf("proposals: %v", got)
	}
}

func TestPlanDropsOtherListsAndShakyForecasts(t *testing.T) {
	away := autopilottest.Weekly("candles", list, now)
	away.Containers = map[string]int64{"list:" + list: 1, "list:party": 9}
	shaky := autopilottest.Weekly("cake", list, now)
	shaky.CV = 0.9
	f := &autopilottest.Signals{Cands: []autopilot.Candidate{away, shaky, autopilottest.Weekly("eggs", list, now)}}
	if got := keys(autopilot.Plan(gather(t, f, autopilot.HorizonNow, 5), autopilot.DefaultPolicy)); len(got) != 1 || got[0] != "eggs" {
		t.Fatalf("proposals: %v", got)
	}
}

func TestPlanCycleIsLastAtDate(t *testing.T) {
	c := autopilottest.Weekly("eggs", list, now)
	f := &autopilottest.Signals{Cands: []autopilot.Candidate{c}, Usuals: map[string]autopilot.Usual{"eggs": {Display: "Eggs", Quantity: "12"}}}
	prs := autopilot.Plan(gather(t, f, autopilot.HorizonNow, 1), autopilot.DefaultPolicy)
	if len(prs) != 1 {
		t.Fatalf("proposals: %+v", prs)
	}
	pr := prs[0]
	if pr.Cycle != c.LastAt.Format("2006-01-02") || pr.Display != "Eggs" || pr.Quantity != "12" || pr.Kind != autopilot.KindRestock || pr.Effect != autopilot.EffectAddToList {
		t.Fatalf("proposal: %+v", pr)
	}
	if pr.Reason.Code != autopilot.ReasonEveryDays || pr.Reason.Params["days"] != 7 {
		t.Fatalf("reason: %+v", pr.Reason)
	}
}

func TestPlanCycleClosedByEvents(t *testing.T) {
	c := autopilottest.Weekly("eggs", list, now)
	after := c.LastAt.Add(48 * time.Hour)
	for name, evs := range map[string][]autopilot.KeyEvent{
		"ignored":           {{Name: "item.suggestion_ignored", At: after}},
		"added since":       {{Name: "item.added", At: after}},
		"autopilot added":   {{Name: "item.autopilot_added", At: after}},
		"autopilot removed": {{Name: "item.autopilot_removed", At: after}},
	} {
		f := &autopilottest.Signals{Cands: []autopilot.Candidate{c}, Events: map[string][]autopilot.KeyEvent{"eggs": evs}}
		if got := autopilot.Plan(gather(t, f, autopilot.HorizonNow, 1), autopilot.DefaultPolicy); len(got) != 0 {
			t.Errorf("%s: still proposed", name)
		}
	}
	// A run-mode ignore does not hide it from the slip.
	f := &autopilottest.Signals{Cands: []autopilot.Candidate{c}, Events: map[string][]autopilot.KeyEvent{"eggs": {{Name: "item.suggestion_ignored", At: after, During: "run"}}}}
	if got := autopilot.Plan(gather(t, f, autopilot.HorizonNow, 1), autopilot.DefaultPolicy); len(got) != 1 {
		t.Fatalf("run-mode ignore hid it from the slip")
	}
}

func TestPlanCycleCheckIsLazy(t *testing.T) {
	f := &autopilottest.Signals{Cands: []autopilot.Candidate{
		autopilottest.Weekly("eggs", list, now), autopilottest.Weekly("bread", list, now), autopilottest.Weekly("milk", list, now),
	}}
	gather(t, f, autopilot.HorizonNow, 1)
	if f.KeyReads != 1 {
		t.Fatalf("read %d keys' events for a limit of 1", f.KeyReads)
	}
}

func TestPlanPausedNoProposals(t *testing.T) {
	f := &autopilottest.Signals{
		Cands:        []autopilot.Candidate{autopilottest.Weekly("eggs", list, now)},
		ReactionList: []autopilot.KeyEvent{{Name: "item.suggestion_ignored"}, {Name: "item.suggestion_ignored"}},
	}
	if s := gather(t, f, autopilot.HorizonNow, 1); !s.Paused || len(autopilot.Plan(s, autopilot.DefaultPolicy)) != 0 {
		t.Fatalf("not paused: %+v", s)
	}
	f.ReactionList = []autopilot.KeyEvent{{Name: "item.suggestion_ignored"}, {Name: "item.suggestion_accepted"}}
	if s := gather(t, f, autopilot.HorizonNow, 1); s.Paused {
		t.Fatal("an accept ends the streak")
	}
}

func TestPlanNoRunNoProposals(t *testing.T) {
	f := &autopilottest.Signals{Cands: []autopilot.Candidate{autopilottest.Weekly("eggs", list, now)}}
	for _, h := range []autopilot.Horizon{autopilot.HorizonNextRun, autopilot.HorizonRunAfterNext} {
		if s := gather(t, f, h, 5); !s.NoRun || len(autopilot.Plan(s, autopilot.DefaultPolicy)) != 0 {
			t.Errorf("%s without a run rhythm: %+v", h, s)
		}
	}
	f.Plan = &autopilot.RunPlan{Confidence: 0.3}
	if s := gather(t, f, autopilot.HorizonRunAfterNext, 5); !s.NoRun {
		t.Error("an unsure run plan still planned")
	}
}

func TestPlanRunModeLooksAsFarAsTheRunInterval(t *testing.T) {
	f := &autopilottest.Signals{Runs: 5, IntervalDays: 3}
	gather(t, f, autopilot.HorizonNextRun, 5)
	if want := now.Add(72 * time.Hour); !f.LastUntil.Equal(want) {
		t.Fatalf("until %v, want %v", f.LastUntil, want)
	}
	f.IntervalDays = 40
	gather(t, f, autopilot.HorizonNextRun, 5)
	if want := now.Add(14 * 24 * time.Hour); !f.LastUntil.Equal(want) {
		t.Fatalf("capped until %v, want %v", f.LastUntil, want)
	}
}

func runPlan() *autopilot.RunPlan {
	next := now.Add(10 * time.Hour)
	return &autopilot.RunPlan{
		Next:       autopilot.Window{Start: next, End: next.Add(2 * time.Hour)},
		After:      autopilot.Window{Start: next.Add(7 * 24 * time.Hour), End: next.Add(7*24*time.Hour + 2*time.Hour)},
		Confidence: 0.8,
	}
}

func TestPlanAwayNoAdds(t *testing.T) {
	rp := runPlan()
	f := &autopilottest.Signals{Plan: rp, Cands: []autopilot.Candidate{autopilottest.Weekly("eggs", list, now)},
		AwaySpans: predict.Away{{Opens: rp.Next.Start.Add(-24 * time.Hour), Closes: rp.Next.Start.Add(72 * time.Hour)}}}
	if s := gather(t, f, autopilot.HorizonRunAfterNext, 8); !s.Away || len(autopilot.Plan(s, autopilot.DefaultPolicy)) != 0 {
		t.Fatalf("planned while away: %+v", s)
	}
	f.AwaySpans = nil
	s := gather(t, f, autopilot.HorizonRunAfterNext, 8)
	if !f.LastUntil.Equal(rp.After.Start) {
		t.Fatalf("assist horizon %v, want the run after next %v", f.LastUntil, rp.After.Start)
	}
	prs := autopilot.Plan(s, autopilot.DefaultPolicy)
	if len(prs) != 1 || !prs[0].RunAt.Equal(rp.Next.Start) {
		t.Fatalf("home again: %+v", prs)
	}
}

func TestPlanAssistOrdersByNeedAndCaps(t *testing.T) {
	var cands []autopilot.Candidate
	for i, k := range []string{"a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8", "i9", "j10"} {
		c := autopilottest.Weekly(k, list, now)
		c.NeedBy = 0.5 + float64(i)/20
		cands = append(cands, c)
	}
	f := &autopilottest.Signals{Plan: runPlan(), Cands: cands}
	prs := autopilot.Plan(gather(t, f, autopilot.HorizonRunAfterNext, 0), autopilot.DefaultPolicy)
	if len(prs) != autopilot.DefaultPolicy.MaxPerRun || prs[0].Key != "j10" {
		t.Fatalf("proposals: %v", keys(prs))
	}
}
