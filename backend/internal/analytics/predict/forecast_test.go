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
		opens, closes := ClassicParams.Window(due, c.ewma, 0)
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
	opens, closes := DefaultParams.Window(at(21), 7, 0)
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
	// Opens three days early, steps aside under two days late, and after a skipped week comes
	// back a week later (up to four skipped cycles).
	if !f.OpenAt(at(53)) || !f.OpenAt(at(57.5)) || f.OpenAt(at(52.5)) || f.OpenAt(at(58.5)) {
		t.Fatal("first window should cover three days before to under two days after the due day")
	}
	if !f.OpenAt(at(62)) || len(f.Windows) != DefaultParams.Skips+1 {
		t.Fatalf("a skipped week should open the next one: %+v", f.Windows)
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

// A weekend shopper: Saturday one week, Sunday the next (gaps of 8 and 6 days). The window
// grows with that wobble, so every cycle is a hit and it opens by Friday.
func TestWeekendHabitIsConfidentAndOpensTheDayBefore(t *testing.T) {
	adds := days(0, 8, 14, 22, 28, 36, 42, 50) // Sat, Sun, Sat, Sun, ...
	f, ok := DefaultParams.Predict(adds, nil, nil)
	if !ok || f.Hits != f.Trials || !f.Confident(DefaultParams) {
		t.Fatalf("a Saturday-or-Sunday habit is a habit: %+v", f)
	}
	if lead := f.DueAt.Sub(f.OpensAt); lead < 36*time.Hour {
		t.Fatalf("should open at least a day and a half early (Friday for a weekend), got %v", lead)
	}
}

func TestSteadyRhythmKeepsItsTightWindow(t *testing.T) {
	// No wobble, no extra width: a perfectly weekly item keeps the 1.4 day lead and 0.7 day grace.
	opens, closes := ClassicParams.Window(at(21), 7, 0)
	if d := at(21).Sub(opens); d < 33*time.Hour || d > 34*time.Hour {
		t.Fatalf("lead %v", d)
	}
	if d := closes.Sub(at(21)); d < 16*time.Hour || d > 17*time.Hour {
		t.Fatalf("grace %v", d)
	}
}

// A weekend shopper who skips some weeks: gaps of 7, 14 and 21 days. Every add lands in one of
// the repeating windows, so the habit is confident even though weeks are skipped.
func TestMostWeeksHabitWithSkipsIsConfident(t *testing.T) {
	adds := days(0, 7, 21, 28, 35, 49, 56, 63, 84, 91, 98, 112, 119)
	if f, ok := ClassicParams.Predict(adds, nil, nil); ok && f.Confident(ClassicParams) {
		t.Fatalf("the single-window model could not see this habit: %+v", f)
	}
	f, ok := DefaultParams.Predict(adds, nil, nil)
	if !ok || !f.Confident(DefaultParams) || f.EWMADays != 7 {
		t.Fatalf("most-weeks habit: %+v", f)
	}
}

// A habit that changed: fortnightly for half a year, weekly since. Confidence follows the latest
// cycles, so the new weekly habit is suggested once it has held for a while.
func TestAChangedHabitIsJudgedOnHowItIsNow(t *testing.T) {
	var adds []time.Time
	for d := 0.0; d < 182; d += 14 {
		adds = append(adds, at(d))
	}
	for d := 189.0; d <= 189+7*16; d += 7 { // weekly for four months
		adds = append(adds, at(d))
	}
	f, ok := DefaultParams.Predict(adds, nil, nil)
	if !ok || !f.Confident(DefaultParams) || f.EWMADays != 7 {
		t.Fatalf("weekly now: %+v", f)
	}
}

func TestStrictSkipsCountsEveryEmptyWindow(t *testing.T) {
	p := DefaultParams
	p.StrictSkips = true
	ws := []Span{{at(5), at(9)}, {at(12), at(16)}, {at(19), at(23)}}
	if shown, hit, _ := p.Judge(ws, at(20)); shown != 3 || !hit {
		t.Fatalf("two empty windows then a hit: shown %d hit %v", shown, hit)
	}
	if shown, hit, late := p.Judge(ws, at(2)); shown != 1 || hit || !late {
		t.Fatalf("added before the first window: %d %v %v", shown, hit, late)
	}
	p.StrictSkips = false
	if shown, hit, _ := p.Judge(ws, at(20)); shown != 1 || !hit {
		t.Fatalf("lenient: one trial per cycle: %d %v", shown, hit)
	}
}
