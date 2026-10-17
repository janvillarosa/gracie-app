package autopilot

import (
	"math"
	"sort"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/parse"
)

const (
	// homeListShare is how much of a thing's activity must happen on a list for it to be
	// proposed there: milk belongs to the groceries list, not to a party list.
	homeListShare = 0.6
	// pauseAfterIgnores ignores in a row on a list (none accepted in between) mean the house is
	// not interested right now: proposals on that list pause until the streak lapses.
	pauseAfterIgnores = 2
	// maxRunLookahead caps how far run mode looks ahead for things due before the next shop.
	maxRunLookahead = 14 * 24 * time.Hour
	// DuringRun marks a run-mode ignore.
	DuringRun = "run"
)

// Event names the cycle and pause rules read.
const (
	evIgnored          = "item.suggestion_ignored"
	evAccepted         = "item.suggestion_accepted"
	evAdded            = "item.added"
	evChecked          = "item.checked"
	evAutopilotAdded   = "item.autopilot_added"
	evAutopilotRemoved = "item.autopilot_removed"
)

// ReactionEvents are the events Paused reads.
var ReactionEvents = []string{evIgnored, evAccepted}

// Paused reports whether the house's latest reactions on a list (newest first) are all ignores,
// pauseAfterIgnores of them. An accepted suggestion ends the streak, and the streak lapses on its
// own once it falls out of the window, so there is no state to reset.
func Paused(reactions []KeyEvent) bool {
	if len(reactions) < pauseAfterIgnores {
		return false
	}
	for _, e := range reactions[:pauseAfterIgnores] {
		if e.Name != evIgnored {
			return false
		}
	}
	return true
}

// RunLookahead is how far run mode looks ahead on a list: the house's run interval there, capped
// at maxRunLookahead; 0 while no run rhythm has been learned.
func RunLookahead(runs int, intervalDays float64) time.Duration {
	if runs < predict.MinOccurrences || intervalDays <= 0 {
		return 0
	}
	return min(time.Duration(intervalDays*24*float64(time.Hour)), maxRunLookahead)
}

// confident is the suggest bar: today's predict.Forecast.Confident with the policy's numbers.
func confident(c Candidate, p Policy) bool {
	return c.Trials > 0 && c.Score >= p.SuggestMinScore && c.CV <= p.SuggestMaxCV
}

// Rank runs the pure filters over candidates (most confident first, as the signals return them):
// the suggest bar, home list, one name per look-alike cluster (the first, most confident, wins),
// and nothing already on the list or a look-alike of it. The "now" and "next_run" horizons then
// put open windows first and the soonest next; assist keeps the order it was given.
func Rank(cands []Candidate, listID string, h Horizon, onList []string, now time.Time, p Policy) []Ranked {
	var out []Ranked
	var taken []string
	for _, c := range cands {
		if !confident(c, p) || !isHomeList(c.Containers, listID) {
			continue
		}
		if likeAny(c.Key, taken) {
			continue
		}
		taken = append(taken, c.Key)
		if likeAny(c.Key, onList) {
			continue
		}
		out = append(out, Ranked{Candidate: c, DueInDays: daysUntilOpen(c, now)})
	}
	if h != HorizonRunAfterNext {
		sort.SliceStable(out, func(i, j int) bool { return out[i].DueInDays < out[j].DueInDays })
	}
	return out
}

// CycleOpen reads a thing's raw events (fresher than the rollup) and says no when the house turned
// it down this cycle, or already did it since the forecast was made (the rollup has not caught up).
func CycleOpen(r Ranked, evs []KeyEvent, h Horizon) bool {
	// Only the kind of event the forecast learned from starts a new cycle: checking off what was
	// added (the purchase itself, often a day later) is part of the same cycle.
	cycleEvent := evAdded
	if r.Series == predict.SeriesChecked {
		cycleEvent = evChecked
	}
	since := r.LastAt.Add(predict.MinGap)
	duringRun := h != HorizonNow
	for _, e := range evs {
		switch e.Name {
		case evIgnored:
			// A run-mode ignore turns something down early, mid-shop: it only hides the thing from
			// run mode, and only until it is actually due (window open), when it may come back.
			if e.During == DuringRun && (!duringRun || r.DueInDays == 0) {
				continue
			}
			if e.At.After(r.LastAt) {
				return false
			}
		case evAutopilotAdded, evAutopilotRemoved:
			// Autopilot already acted on it this cycle (and maybe was undone): once per cycle.
			if e.At.After(r.LastAt) {
				return false
			}
		case cycleEvent:
			if e.At.After(since) {
				return false
			}
		}
	}
	return true
}

// isHomeList reports whether most of a thing's activity happens on listID.
func isHomeList(containers map[string]int64, listID string) bool {
	var total int64
	for _, n := range containers {
		total += n
	}
	if total == 0 {
		return false
	}
	return float64(containers["list:"+listID])/float64(total) >= homeListShare
}

// likeAny reports whether key names the same thing as any of keys ("oranges" for "orange").
func likeAny(key string, keys []string) bool {
	for _, k := range keys {
		if k == key || parse.Similar(key, k) {
			return true
		}
	}
	return false
}

// daysUntilOpen is 0 when a window is open at now, else the whole days (rounded up) until the
// earliest window that has not closed opens.
func daysUntilOpen(c Candidate, now time.Time) int {
	spans := append([]predict.Span{{Opens: c.OpensAt, Closes: c.ClosesAt}}, c.Windows...)
	var next time.Time
	for _, w := range spans {
		if w.Closes.Before(now) {
			continue
		}
		if !w.Opens.After(now) {
			return 0
		}
		if next.IsZero() || w.Opens.Before(next) {
			next = w.Opens
		}
	}
	if next.IsZero() {
		return 0
	}
	return int(math.Ceil(next.Sub(now).Hours() / 24))
}
