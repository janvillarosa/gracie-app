package predict

import (
	"math"
	"testing"
	"time"
)

func TestRunsNeedThreeInARow(t *testing.T) {
	d := time.Date(2026, 10, 3, 10, 0, 0, 0, time.UTC) // a Saturday
	times := []time.Time{
		d, d.Add(5 * time.Minute), d.Add(20 * time.Minute), // run 1: three within the gap
		d.Add(24 * time.Hour), d.Add(24*time.Hour + 2*time.Minute), // only two: not a run
		d.Add(7 * 24 * time.Hour), d.Add(7*24*time.Hour + 40*time.Minute), d.Add(7*24*time.Hour + 80*time.Minute), // 40m gaps keep it going
	}
	got := Runs(times)
	if len(got) != 2 || !got[0].Equal(d) || !got[1].Equal(d.Add(7*24*time.Hour)) {
		t.Fatalf("runs: %v", got)
	}
	if len(Runs(nil)) != 0 {
		t.Fatal("no times, no runs")
	}
	// A pause over the gap splits one stretch into two short ones.
	split := []time.Time{d, d.Add(time.Minute), d.Add(2 * time.Minute), d.Add(3 * time.Hour), d.Add(3*time.Hour + time.Minute)}
	if got := Runs(split); len(got) != 1 {
		t.Fatalf("split: %v", got)
	}
}

func TestHistogramDecaysOldHabits(t *testing.T) {
	now := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	h := HOWHistogram([]Occurrence{
		{At: now, HOW: 10},
		{At: now.Add(-HalfLife), HOW: 20}, // one half-life ago weighs half
		{At: now.Add(-2 * HalfLife), HOW: 30},
		{At: now.Add(time.Hour), HOW: 40}, // the future is ignored
		{At: now, HOW: 999},               // out of range is ignored
	}, now)
	if math.Abs(h[10]-1) > 1e-9 || math.Abs(h[20]-0.5) > 1e-9 || math.Abs(h[30]-0.25) > 1e-9 || h[40] != 0 {
		t.Fatalf("hist: %v %v %v %v", h[10], h[20], h[30], h[40])
	}
	if p, ok := h.Peak(); !ok || p != 10 {
		t.Fatalf("peak %d %v", p, ok)
	}
	if _, ok := (Histogram{}).Peak(); ok {
		t.Fatal("empty histogram has no peak")
	}
}

func saturdays(n int) []time.Time {
	d := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC) // Saturday 10:00
	out := make([]time.Time, n)
	for i := range out {
		out[i] = d.AddDate(0, 0, 7*i)
	}
	return out
}

func TestNextWindowFollowsTheWeeklyHabit(t *testing.T) {
	times := saturdays(8) // last: 2026-09-19
	r := Intervals(times)
	var occ []Occurrence
	for _, at := range times {
		occ = append(occ, Occurrence{At: at, HOW: int(at.Weekday())*24 + at.Hour()})
	}
	now := time.Date(2026, 9, 21, 9, 0, 0, 0, time.UTC) // Monday after
	how := HOWHistogram(occ, now)
	w, ok := NextWindow(r, how, time.UTC, now)
	if !ok {
		t.Fatal("expected a window")
	}
	want := time.Date(2026, 9, 26, 9, 0, 0, 0, time.UTC) // next Saturday, an hour either side of 10:00
	if !w.Start.Equal(want) || !w.End.Equal(want.Add(3*time.Hour)) {
		t.Fatalf("window %v - %v, want start %v", w.Start, w.End, want)
	}
	if w.Confidence < 0.9 {
		t.Fatalf("a perfectly regular habit should be trusted: %v", w.Confidence)
	}
}

func TestNextWindowOverdueMeansTodayOrTomorrow(t *testing.T) {
	times := saturdays(6)
	r := Intervals(times)
	var occ []Occurrence
	for _, at := range times {
		occ = append(occ, Occurrence{At: at, HOW: int(at.Weekday())*24 + at.Hour()})
	}
	// A month later and nothing happened: the due day is long past.
	now := time.Date(2026, 10, 20, 8, 0, 0, 0, time.UTC) // a Tuesday morning
	w, ok := NextWindow(r, HOWHistogram(occ, now), time.UTC, now)
	if !ok || w.Start.Before(now.Add(-time.Hour)) {
		t.Fatalf("overdue window %v ok=%v", w, ok)
	}
	// Late in the evening, today's usual hour has gone by, so it rolls to tomorrow.
	late := time.Date(2026, 10, 20, 22, 0, 0, 0, time.UTC)
	w, _ = NextWindow(r, HOWHistogram(occ, late), time.UTC, late)
	if !w.End.After(late) {
		t.Fatalf("window must be in the future: %v", w)
	}
}

func TestNextWindowWithholdsThinHistory(t *testing.T) {
	r := Intervals(saturdays(2))
	if _, ok := NextWindow(r, Histogram{}, time.UTC, time.Now()); ok {
		t.Fatal("two occurrences are not enough to predict")
	}
}

func TestConfidenceAndMedian(t *testing.T) {
	if Confidence(2, 0) != 0 {
		t.Fatal("below the minimum there is no confidence")
	}
	if Confidence(6, 0) != 1 || Confidence(6, 5) != 0 {
		t.Fatalf("bounds: %v %v", Confidence(6, 0), Confidence(6, 5))
	}
	if Confidence(3, 0.2) >= Confidence(6, 0.2) {
		t.Fatal("more history should raise confidence")
	}
	if m, ok := Median([]float64{5, 1, 3}); !ok || m != 3 {
		t.Fatal("odd median")
	}
	if m, _ := Median([]float64{1, 2, 3, 10}); m != 2.5 {
		t.Fatal("even median")
	}
	if _, ok := Median(nil); ok {
		t.Fatal("empty median")
	}
}
