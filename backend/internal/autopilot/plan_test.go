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
	off, sug, ast := autopilot.ModeOff, autopilot.ModeSuggest, autopilot.ModeAssist
	type want = map[autopilot.Mode]autopilot.Disposition
	cases := []struct {
		name string
		pr   autopilot.Proposal
		want want
	}{
		{"below both bars", band(0.3, 0.99), want{off: autopilot.Drop, sug: autopilot.Drop, ast: autopilot.Drop}},
		{"assist bar only (run fit), not the suggest bar", band(0.55, 0.9), want{off: autopilot.Drop, sug: autopilot.Drop, ast: autopilot.Apply}},
		{"both bars", band(0.85, 0.75), want{off: autopilot.Drop, sug: autopilot.Suggest, ast: autopilot.Apply}},
		{"suggest bar, need too low for assist", band(0.95, 0.4), want{off: autopilot.Drop, sug: autopilot.Suggest, ast: autopilot.Suggest}},
		{"external effect never applies", autopilot.Proposal{Confidence: 0.99, Need: 0.99, Effect: "buy"}, want{off: autopilot.Drop, sug: autopilot.Suggest, ast: autopilot.Suggest}},
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

// weeklyBuys is a thing bought every week for twelve weeks, last a week before the next run.
func weeklyBuys() []autopilot.KeyEvent {
	return autopilottest.Buys(7*24*time.Hour, 12, now.Add(10*time.Hour-7*24*time.Hour))
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
		Events:    map[string][]autopilot.KeyEvent{"eggs": weeklyBuys()},
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
	evs := map[string][]autopilot.KeyEvent{}
	for i, k := range []string{"a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8", "i9", "j10"} {
		cands = append(cands, autopilottest.Weekly(k, list, now))
		// The later ones were bought longer ago, so they are more surely needed by this run.
		evs[k] = autopilottest.Buys(7*24*time.Hour, 12, now.Add(-time.Duration(i)*12*time.Hour))
	}
	f := &autopilottest.Signals{Plan: runPlan(), Cands: cands, Events: evs}
	prs := autopilot.Plan(gather(t, f, autopilot.HorizonRunAfterNext, 0), autopilot.DefaultPolicy)
	if len(prs) != autopilot.DefaultPolicy.MaxPerRun {
		t.Fatalf("proposals: %v", keys(prs))
	}
	for i := 1; i < len(prs); i++ {
		if prs[i].Need > prs[i-1].Need {
			t.Fatalf("not most needed first: %v", keys(prs))
		}
	}
}

func TestPlanWaitsForTheLead(t *testing.T) {
	rp := runPlan() // next run in 10 h
	f := &autopilottest.Signals{Plan: rp, Cands: []autopilot.Candidate{autopilottest.Weekly("eggs", list, now)}}
	q := autopilot.Query{RoomID: "room_1", ListID: list, Horizon: autopilot.HorizonRunAfterNext, Now: now, Lead: 6 * time.Hour}
	s, _ := autopilot.Gather(context.Background(), f, q, autopilot.DefaultPolicy)
	if !s.NotYet || len(autopilot.Plan(s, autopilot.DefaultPolicy)) != 0 {
		t.Fatalf("planned 10 h out with a 6 h lead: %+v", s)
	}
	q.Lead = 18 * time.Hour
	if s, _ := autopilot.Gather(context.Background(), f, q, autopilot.DefaultPolicy); s.NotYet {
		t.Fatal("did not plan within the lead")
	}
	q.Now = rp.Next.Start.Add(time.Minute) // the run is under way: too late to add
	if s, _ := autopilot.Gather(context.Background(), f, q, autopilot.DefaultPolicy); !s.NotYet {
		t.Fatal("planned for a run already under way")
	}
}
