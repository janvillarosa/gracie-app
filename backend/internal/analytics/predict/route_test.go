package predict

import (
	"slices"
	"testing"
)

func repeatRuns(n int, r RunOrder) []RunOrder {
	out := make([]RunOrder, n)
	for i := range out {
		out[i] = slices.Clone(r)
	}
	return out
}

func TestLearnRouteSpots(t *testing.T) {
	r := LearnRoute(repeatRuns(6, RunOrder{"bananas", "milk", "eggs", "bread", "cheese"}))
	if r.Runs != 6 {
		t.Errorf("Runs = %d want 6", r.Runs)
	}
	for k, want := range map[string]float64{"bananas": 0, "eggs": 0.5, "cheese": 1} {
		if got := r.Spots[k]; got != want {
			t.Errorf("Spots[%s] = %v want %v", k, got, want)
		}
	}
}

func TestLearnRouteDropsTopUps(t *testing.T) {
	r := LearnRoute(repeatRuns(5, RunOrder{"a", "b", "c"}))
	if r.Runs != 0 || len(r.Spots) != 0 {
		t.Errorf("got Runs=%d Spots=%v, want none", r.Runs, r.Spots)
	}
}

func TestLearnRouteNeedsTwoSightings(t *testing.T) {
	runs := repeatRuns(4, RunOrder{"a", "b", "c", "d"})
	runs = append(runs, RunOrder{"a", "b", "once", "c", "d"})
	r := LearnRoute(runs)
	if _, ok := r.Spots["once"]; ok {
		t.Errorf("a key seen once has a spot")
	}
	if _, ok := r.Spots["a"]; !ok {
		t.Errorf("a key seen five times has no spot")
	}
}

func TestLearnRouteFollowsHabitChange(t *testing.T) {
	runs := repeatRuns(6, RunOrder{"a", "eggs", "b", "c", "d"})
	runs = append(runs, repeatRuns(4, RunOrder{"a", "b", "c", "d", "eggs"})...)
	if got := LearnRoute(runs).Spots["eggs"]; got <= 0.6 {
		t.Errorf("eggs spot = %v, want > 0.6 after the habit moved", got)
	}
}

func TestBacktestConsistentHouse(t *testing.T) {
	hits, trials := BacktestRoute(repeatRuns(10, RunOrder{"a", "b", "c", "d", "e", "f"}))
	if trials == 0 || hits != trials {
		t.Errorf("hits/trials = %d/%d, want all hits", hits, trials)
	}
}

func TestBacktestTwoStores(t *testing.T) {
	fwd := RunOrder{"a", "b", "c", "d", "e", "f"}
	rev := RunOrder{"f", "e", "d", "c", "b", "a"}
	var runs []RunOrder
	for range 5 {
		runs = append(runs, fwd, rev)
	}
	if got := LearnRoute(runs).Score; got >= 0.5 {
		t.Errorf("Score = %v, want < 0.5 for a house with two routes", got)
	}
}

func TestBacktestHitWindow(t *testing.T) {
	base := repeatRuns(3, RunOrder{"a", "b", "c", "d", "e"})
	// b is the 2nd next after a: still a hit.
	hits, trials := BacktestRoute(append(slices.Clone(base), RunOrder{"a", "c", "b", "d", "e"}))
	if hits != trials {
		t.Errorf("2nd-next: hits/trials = %d/%d, want all hits", hits, trials)
	}
	// b is the 3rd next after a: a miss.
	hits, trials = BacktestRoute(append(slices.Clone(base), RunOrder{"a", "c", "d", "b", "e"}))
	if hits >= trials {
		t.Errorf("3rd-next: hits/trials = %d/%d, want a miss", hits, trials)
	}
}

func TestPickNext(t *testing.T) {
	spots := map[string]float64{"a": 0, "b": .25, "c": .5, "d": .75}
	cases := []struct {
		name       string
		unchecked  []string
		anchor     float64
		next, then string
	}{
		{"ahead", []string{"b", "c", "d"}, .3, "c", "d"},
		{"doubles back", []string{"b", "c", "d"}, .8, "b", "c"},
		{"last one", []string{"d"}, 0, "d", ""},
		{"empty", nil, 0, "", ""},
		{"unspotted ignored", []string{"zzz", "c"}, 0, "c", ""},
	}
	for _, c := range cases {
		next, then := PickNext(spots, c.unchecked, c.anchor)
		if next != c.next || then != c.then {
			t.Errorf("%s: got (%q,%q) want (%q,%q)", c.name, next, then, c.next, c.then)
		}
	}
}
