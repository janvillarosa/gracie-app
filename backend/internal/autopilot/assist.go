package autopilot

import (
	"sort"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
)

const (
	// fitMinBuys is how many separate purchases a thing needs before assist judges it.
	fitMinBuys = 4
	// fitRecentGaps bounds the gaps the rhythm and the need are read from (habits change).
	fitRecentGaps = 12
	// fitRecentCycles bounds the cycles the run score is judged on (more cycles, a tighter bound).
	fitRecentCycles = 12
)

// RunFit is how well a thing fits the house's runs, judged from its own purchases: assist asks
// "will it be bought in this run?", not "when will someone add it?" (the suggestion forecast).
type RunFit struct {
	// Score is the Wilson lower bound of the recent cycles that landed in the run their rhythm
	// pointed to (within half a run interval of the due time).
	Score float64
	// Need is the chance it is needed by this run, given it was not bought since its last purchase:
	// the share of its recent gaps that end by this run, among those that had not ended before it.
	Need          float64
	Trials, Hits  int
	EveryDays     float64
	LastPurchased time.Time
}

// FitRun judges a thing for one run from its purchases (check-offs, any order), the run's start and
// the house's run interval, all in the house's home time (away spans left out). ok is false when it
// has too few purchases to judge.
func FitRun(purchases []time.Time, runStart time.Time, interval time.Duration, away predict.Away) (RunFit, bool) {
	if interval <= 0 {
		return RunFit{}, false
	}
	ts := append([]time.Time(nil), purchases...)
	sort.Slice(ts, func(i, j int) bool { return ts[i].Before(ts[j]) })
	kept := predict.Collapse(ts)
	if len(kept) < fitMinBuys {
		return RunFit{}, false
	}
	days := func(a, b time.Time) float64 { return away.HomeBetween(a, b).Hours() / 24 }
	gaps := make([]float64, 0, len(kept)-1)
	for i := 1; i < len(kept); i++ {
		gaps = append(gaps, days(kept[i-1], kept[i]))
	}
	half := interval.Hours() / 24 / 2

	// Backtest: each recent purchase against the run its rhythm (from the gaps before it) pointed to.
	var trials, hits int
	from := max(predict.MinOccurrences, len(kept)-fitRecentCycles)
	for i := from; i < len(kept); i++ {
		prior := recent(gaps[:i-1], fitRecentGaps)
		d := medianOf(prior)
		if d <= 0 {
			continue
		}
		trials++
		if off := days(kept[i-1], kept[i]) - d; off <= half && off >= -half {
			hits++
		}
	}
	rg := recent(gaps, fitRecentGaps)
	last := kept[len(kept)-1]
	fit := RunFit{Trials: trials, Hits: hits, EveryDays: medianOf(rg), LastPurchased: last}
	fit.Score = predict.Wilson(hits, trials, predict.WilsonZ)

	// Need: it was not bought before this run's window opened (a); will its gap end by the run's
	// window closing (b)? Laplace-smoothed so thin history never reads as certain.
	sinceLast := days(last, runStart)
	a, b := sinceLast-half, sinceLast+half
	cdf := func(x float64) float64 {
		n := 0
		for _, g := range rg {
			if g <= x {
				n++
			}
		}
		return (float64(n) + 0.5) / (float64(len(rg)) + 1)
	}
	if overdue(rg, a) {
		// Longer since the last purchase than any recent gap: a run was skipped (a busy week, a trip)
		// and it is wanted now, unless it is so overdue that the habit has stopped.
		if sinceLast <= 2*fit.EveryDays+half {
			fit.Need = 1
		}
		return fit, true
	}
	fit.Need = (cdf(b) - cdf(a)) / (1 - cdf(a))
	return fit, true
}

// overdue reports whether every recent gap ended before x.
func overdue(gaps []float64, x float64) bool {
	for _, g := range gaps {
		if g > x {
			return false
		}
	}
	return true
}

func recent(xs []float64, n int) []float64 {
	if len(xs) > n {
		return xs[len(xs)-n:]
	}
	return xs
}

func medianOf(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	s := append([]float64(nil), xs...)
	sort.Float64s(s)
	if len(s)%2 == 1 {
		return s[len(s)/2]
	}
	return (s[len(s)/2-1] + s[len(s)/2]) / 2
}

// Purchases are the check-off times among a thing's events.
func Purchases(evs []KeyEvent) []time.Time {
	var out []time.Time
	for _, e := range evs {
		if e.Name == evChecked {
			out = append(out, e.At)
		}
	}
	return out
}

// Assess puts a candidate's run fit on it for the assist horizon: its Score and NeedBy become the
// fit's, which is what Decide judges against the assist bar. ok is false when it cannot be judged.
func Assess(r Ranked, evs []KeyEvent, run RunPlan, away predict.Away) (Ranked, bool) {
	fit, ok := FitRun(Purchases(evs), run.Next.Start, run.After.Start.Sub(run.Next.Start), away)
	if !ok {
		return r, false
	}
	r.Score, r.NeedBy, r.EveryDays = fit.Score, fit.Need, fit.EveryDays
	// One action per purchase cycle: the cycle is named by the last purchase.
	r.LastAt = fit.LastPurchased
	return r, true
}

// BestOfLookAlikes keeps one name per look-alike cluster ("yogurt", "yogurts"): the one most surely
// needed, then the best run fit. Order is otherwise kept.
func BestOfLookAlikes(rs []Ranked) []Ranked {
	better := func(a, b Ranked) bool {
		if a.NeedBy != b.NeedBy {
			return a.NeedBy > b.NeedBy
		}
		return a.Score > b.Score
	}
	out := make([]Ranked, 0, len(rs))
	for _, r := range rs {
		dup := -1
		for i, o := range out {
			if likeAny(r.Key, []string{o.Key}) {
				dup = i
				break
			}
		}
		switch {
		case dup < 0:
			out = append(out, r)
		case better(r, out[dup]):
			out[dup] = r
		}
	}
	return out
}
