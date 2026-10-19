package predict

import (
	"math"
	"slices"
	"sort"
)

const (
	// RouteMinItems is how many keys a run needs to say anything about the route; shorter
	// runs are top-ups, not a walk through the shop.
	RouteMinItems = 4
	// RouteWindow is how many of the newest qualifying runs the route is learned from.
	RouteWindow = 12
	// RouteHalfLife is how fast old runs fade, in runs.
	RouteHalfLife = 4.0
	// RouteHitWindow is how many of the next keys in a run count as having predicted
	// correctly: the pick may be one step off.
	RouteHitWindow = 2
	// RouteMinSeen is how many runs a key must appear in before it gets a spot.
	RouteMinSeen = 2
)

// RunOrder is one trip's distinct keys in the order they were checked off.
type RunOrder []string

// Route is a house's usual walk through the shop. Spots place each key on 0..1 (start to
// end of the shop); Score is how well the spots predicted the next check-off in the past.
type Route struct {
	Runs  int                `bson:"runs" json:"runs"`
	Score float64            `bson:"score" json:"score"`
	Spots map[string]float64 `bson:"spots" json:"spots"`
}

// LearnRoute learns the route from runs, oldest first. Runs shorter than RouteMinItems are
// dropped, the last RouteWindow of the rest are kept, and a key's spot is its mean position
// weighted toward recent runs.
func LearnRoute(runs []RunOrder) Route {
	q := qualifyingRuns(runs)
	hits, trials := backtest(q)
	return Route{
		Runs:  len(q),
		Score: Wilson(hits, trials, WilsonZ),
		Spots: learnSpots(q),
	}
}

// BacktestRoute replays the newest runs: each is predicted, step by step, from the spots
// learned from the runs before it. A step is a hit when the pick lands in the next
// RouteHitWindow keys actually checked.
func BacktestRoute(runs []RunOrder) (hits, trials int) {
	return backtest(qualifyingRuns(runs))
}

// PickNext is the pick rule on keys: the unchecked key with the smallest spot at or after
// anchor, doubling back to the smallest spot overall when nothing is ahead. then is the
// key that follows next (strictly later spot, no doubling back), or "" if none. Keys
// without a spot are ignored; ties go to the smaller key.
func PickNext(spots map[string]float64, unchecked []string, anchor float64) (next, then string) {
	type slot struct {
		key  string
		spot float64
	}
	var ordered []slot
	for _, k := range unchecked {
		if s, ok := spots[k]; ok {
			ordered = append(ordered, slot{k, s})
		}
	}
	if len(ordered) == 0 {
		return "", ""
	}
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].spot != ordered[j].spot {
			return ordered[i].spot < ordered[j].spot
		}
		return ordered[i].key < ordered[j].key
	})
	at := 0
	for at < len(ordered) && ordered[at].spot < anchor {
		at++
	}
	if at == len(ordered) {
		at = 0 // nothing ahead: double back to the start of the shop
	}
	next = ordered[at].key
	for _, s := range ordered[at+1:] {
		if s.spot > ordered[at].spot {
			return next, s.key
		}
	}
	return next, ""
}

// qualifyingRuns drops top-ups and keeps the newest RouteWindow runs.
func qualifyingRuns(runs []RunOrder) []RunOrder {
	var q []RunOrder
	for _, r := range runs {
		if len(r) >= RouteMinItems {
			q = append(q, r)
		}
	}
	if len(q) > RouteWindow {
		q = q[len(q)-RouteWindow:]
	}
	return q
}

// learnSpots is the recency-weighted mean position of each key over runs (oldest first,
// already qualifying). Keys seen in fewer than RouteMinSeen runs get no spot.
func learnSpots(runs []RunOrder) map[string]float64 {
	type acc struct {
		sum, weight float64
		seen        int
	}
	byKey := map[string]*acc{}
	for i, r := range runs {
		age := float64(len(runs) - 1 - i)
		w := math.Pow(0.5, age/RouteHalfLife)
		for k, key := range r {
			a := byKey[key]
			if a == nil {
				a = &acc{}
				byKey[key] = a
			}
			a.sum += w * float64(k) / float64(len(r)-1)
			a.weight += w
			a.seen++
		}
	}
	spots := map[string]float64{}
	for key, a := range byKey {
		if a.seen >= RouteMinSeen {
			spots[key] = a.sum / a.weight
		}
	}
	return spots
}

func backtest(q []RunOrder) (hits, trials int) {
	for i := RouteMinSeen; i < len(q); i++ {
		spots := learnSpots(q[:i])
		run := q[i]
		anchor := 0.0
		for j := 1; j < len(run); j++ {
			if s, ok := spots[run[j-1]]; ok {
				anchor = s
			}
			next, _ := PickNext(spots, run[j:], anchor)
			if next == "" {
				continue
			}
			trials++
			if slices.Contains(run[j:min(j+RouteHitWindow, len(run))], next) {
				hits++
			}
		}
	}
	return hits, trials
}
