package predict

import (
	"math"
	"testing"
	"time"
)

func days(ds ...float64) []time.Time {
	out := make([]time.Time, len(ds))
	for i, d := range ds {
		out[i] = at(d)
	}
	return out
}

func every(gap float64, n int) []time.Time {
	out := make([]time.Time, n)
	for i := range out {
		out[i] = at(gap * float64(i))
	}
	return out
}

func TestWilsonMatchesHandValues(t *testing.T) {
	cases := []struct {
		hits, trials int
		want         float64
	}{
		{0, 0, 0},
		{4, 4, 0.709},
		{3, 4, 0.433},
		{8, 9, 0.692},
		{0, 5, 0},
	}
	for _, c := range cases {
		if got := Wilson(c.hits, c.trials, WilsonZ); math.Abs(got-c.want) > 0.005 {
			t.Errorf("Wilson(%d/%d) = %.3f want %.3f", c.hits, c.trials, got, c.want)
		}
	}
}

func TestWindowClampsLeadAndGrace(t *testing.T) {
	due := at(10)
	cases := []struct {
		ewma        float64
		lead, grace time.Duration
	}{
		{7, time.Duration(1.4 * 24 * float64(time.Hour)), time.Duration(0.7 * 24 * float64(time.Hour))},
		{1, 12 * time.Hour, 6 * time.Hour},   // short rhythms get the floor
		{60, 48 * time.Hour, 24 * time.Hour}, // long rhythms are capped
	}
	for _, c := range cases {
		opens, closes := DefaultParams.Window(due, c.ewma)
		if d := due.Sub(opens) - c.lead; d > time.Second || d < -time.Second {
			t.Errorf("ewma %v: lead %v want %v", c.ewma, due.Sub(opens), c.lead)
		}
		if d := closes.Sub(due) - c.grace; d > time.Second || d < -time.Second {
			t.Errorf("ewma %v: grace %v want %v", c.ewma, closes.Sub(due), c.grace)
		}
	}
}

func TestBacktestPerfectWeekly(t *testing.T) {
	trials, hits := DefaultParams.Backtest(every(7, 8), nil)
	if trials != 5 || hits != 5 {
		t.Fatalf("trials %d hits %d", trials, hits)
	}
}

func TestBacktestCountsTooLateAndTooEarly(t *testing.T) {
	// Weekly three times, then once far too soon (we would have been late) and once far too
	// late (we would have nagged for days).
	trials, hits := DefaultParams.Backtest(days(0, 7, 14, 21, 23, 40), nil)
	if trials != 3 || hits != 1 {
		t.Fatalf("trials %d hits %d", trials, hits)
	}
}

func TestBacktestWindowEdgesAreHits(t *testing.T) {
	opens, closes := DefaultParams.Window(at(21), 7)
	for _, edge := range []time.Time{opens, closes} {
		trials, hits := DefaultParams.Backtest(append(days(0, 7, 14), edge), nil)
		if trials != 1 || hits != 1 {
			t.Fatalf("edge %v: trials %d hits %d", edge, trials, hits)
		}
	}
}

func TestBacktestIgnoreTurnsHitIntoMiss(t *testing.T) {
	times := every(7, 6)
	trials, hits := DefaultParams.Backtest(times, []time.Time{at(26)}) // ignored inside the 21→28 cycle
	if trials != 3 || hits != 2 {
		t.Fatalf("trials %d hits %d", trials, hits)
	}
	// An ignore before the history started changes nothing.
	if _, hits := DefaultParams.Backtest(times, []time.Time{at(-3)}); hits != 3 {
		t.Fatalf("hits %d", hits)
	}
}

func TestBacktestCollapsesBursts(t *testing.T) {
	// add, delete, add again within hours counts once.
	trials, hits := DefaultParams.Backtest(days(0, 0.05, 7, 14, 14.1, 21, 28), nil)
	if trials != 2 || hits != 2 {
		t.Fatalf("trials %d hits %d", trials, hits)
	}
}

func TestPredictPerfectWeeklyIsConfident(t *testing.T) {
	f, ok := DefaultParams.Predict(every(7, 8), nil, nil)
	if !ok || f.Series != SeriesAdded || !f.Confident(DefaultParams) {
		t.Fatalf("got %+v ok=%v", f, ok)
	}
	if !f.DueAt.Equal(at(56)) || !f.LastAt.Equal(at(49)) || f.Trials != 5 || f.Hits != 5 {
		t.Fatalf("got %+v", f)
	}
	if !f.OpenAt(at(55)) || f.OpenAt(at(53)) || f.OpenAt(at(57)) {
		t.Fatal("window should cover just before and just after the due day")
	}
}

func TestPredictJitteryRhythmIsNotConfident(t *testing.T) {
	f, ok := DefaultParams.Predict(days(0, 2, 12, 14, 26, 27, 40, 41), nil, nil)
	if !ok {
		t.Fatal("enough history for a forecast")
	}
	if f.CV <= DefaultParams.MaxCV && f.Score >= DefaultParams.MinScore {
		t.Fatalf("jittery rhythm must not be shown: %+v", f)
	}
	if f.Confident(DefaultParams) {
		t.Fatalf("not confident: %+v", f)
	}
}

func TestPredictThinHistoryIsNotConfident(t *testing.T) {
	f, ok := DefaultParams.Predict(every(7, 4), nil, nil) // one replayed trial
	if !ok || f.Confident(DefaultParams) {
		t.Fatalf("one trial is not evidence: %+v ok=%v", f, ok)
	}
	if _, ok := DefaultParams.Predict(every(7, 2), nil, nil); ok {
		t.Fatal("two adds cannot forecast")
	}
}

func TestPredictHabitChangeDropsScoreUntilRelearned(t *testing.T) {
	weekly := every(7, 8)
	before, _ := DefaultParams.Predict(weekly, nil, nil)
	changed := append(append([]time.Time{}, weekly...), at(52), at(55), at(58))
	after, _ := DefaultParams.Predict(changed, nil, nil)
	if after.Score >= before.Score {
		t.Fatalf("a changed habit must lower the score: before %.2f after %.2f", before.Score, after.Score)
	}
	if after.Confident(DefaultParams) {
		t.Fatalf("not confident right after a change: %+v", after)
	}
}

func TestPredictFallsBackToChecksWhenAddsAreThin(t *testing.T) {
	f, ok := DefaultParams.Predict(days(0, 7), every(7, 7), nil)
	if !ok || f.Series != SeriesChecked || f.Trials != 4 {
		t.Fatalf("got %+v ok=%v", f, ok)
	}
	// Enough adds wins even when there are more checks.
	f, _ = DefaultParams.Predict(every(7, 5), every(7, 8), nil)
	if f.Series != SeriesAdded {
		t.Fatalf("got %s", f.Series)
	}
}

func TestPredictChecksOnlyHouse(t *testing.T) {
	f, ok := DefaultParams.Predict(nil, every(7, 8), nil)
	if !ok || f.Series != SeriesChecked || !f.Confident(DefaultParams) {
		t.Fatalf("got %+v ok=%v", f, ok)
	}
}
