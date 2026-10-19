package autopilot_test

import (
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/autopilot"
)

const day = 24 * time.Hour

func buys(gaps ...float64) []time.Time {
	t := now.Add(-400 * day)
	out := []time.Time{t}
	for _, g := range gaps {
		t = t.Add(time.Duration(g * float64(day)))
		out = append(out, t)
	}
	return out
}

func TestFitRunWeeklyStaple(t *testing.T) {
	ts := buys(7, 7, 6, 8, 7, 7, 7, 6, 8, 7, 7)
	last := ts[len(ts)-1]
	fit, ok := autopilot.FitRun(ts, last.Add(7*day), 7*day, nil)
	if !ok || fit.Score < 0.8 || fit.Need < 0.9 || fit.EveryDays != 7 {
		t.Fatalf("weekly staple due this run: %+v", fit)
	}
	// Bought two days ago: not needed by a run in two days.
	fit, _ = autopilot.FitRun(ts, last.Add(2*day), 7*day, nil)
	if fit.Need > 0.2 {
		t.Fatalf("just bought: %+v", fit)
	}
}

func TestFitRunEveryOtherRun(t *testing.T) {
	ts := buys(14, 14, 14, 14, 13, 15, 14, 14, 14)
	last := ts[len(ts)-1]
	if fit, _ := autopilot.FitRun(ts, last.Add(7*day), 7*day, nil); fit.Need > 0.2 {
		t.Fatalf("one run after a fortnightly buy: %+v", fit)
	}
	if fit, _ := autopilot.FitRun(ts, last.Add(14*day), 7*day, nil); fit.Need < 0.9 || fit.Score < 0.8 {
		t.Fatalf("two runs after: %+v", fit)
	}
}

func TestFitRunIrregularScoresLow(t *testing.T) {
	ts := buys(3, 20, 6, 15, 2, 30, 9, 4, 25, 11)
	if fit, _ := autopilot.FitRun(ts, ts[len(ts)-1].Add(7*day), 7*day, nil); fit.Score >= autopilot.DefaultPolicy.SuggestMinScore {
		t.Fatalf("irregular buys scored %+v", fit)
	}
}

func TestFitRunNeedsHistory(t *testing.T) {
	if _, ok := autopilot.FitRun(buys(7, 7), now, 7*day, nil); ok {
		t.Fatal("judged with three purchases")
	}
}

// A trip in the middle does not stretch the rhythm: gaps are measured in home time.
func TestFitRunHomeTime(t *testing.T) {
	ts := buys(7, 7, 7, 7, 7, 7, 21, 7, 7, 7)
	trip := predict.Away{{Opens: ts[6].Add(day), Closes: ts[6].Add(15 * day)}}
	last := ts[len(ts)-1]
	if fit, _ := autopilot.FitRun(ts, last.Add(7*day), 7*day, trip); fit.EveryDays != 7 || fit.Score < 0.75 {
		t.Fatalf("with a trip: %+v", fit)
	}
}

func TestRouteClears(t *testing.T) {
	p := autopilot.DefaultPolicy
	for name, c := range map[string]struct {
		r    *predict.Route
		want bool
	}{
		"nil":        {nil, false},
		"four runs":  {&predict.Route{Runs: 4, Score: 0.9}, false},
		"just under": {&predict.Route{Runs: 8, Score: p.UpNextMinScore - 0.01}, false},
		"at the bar": {&predict.Route{Runs: p.UpNextMinRuns, Score: p.UpNextMinScore}, true},
	} {
		if got := p.RouteClears(c.r); got != c.want {
			t.Errorf("%s: RouteClears = %v, want %v", name, got, c.want)
		}
	}
}
