package replay

import (
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/autopilot"
)

// UpNextHitGate is the ship bar for Up next: where it speaks, the item it names is checked within
// the next predict.RouteHitWindow check-offs at least this often.
const UpNextHitGate = 0.70

// UpNextScore is how Up next did on one list's history.
type UpNextScore struct {
	Runs   int // runs replayed
	Spoke  int // runs a route that clears the bar existed for (it showed the slip)
	Hits   int // picks the person followed within the hit window
	Trials int // picks made
}

// HitRate is Hits over Trials, 0 when it never spoke.
func (s UpNextScore) HitRate() float64 { return ratio(s.Hits, s.Trials) }

// Coverage is the share of runs it spoke on.
func (s UpNextScore) Coverage() float64 { return ratio(s.Spoke, s.Runs) }

// Add folds another list's score in (for pooling).
func (s *UpNextScore) Add(o UpNextScore) {
	s.Runs += o.Runs
	s.Spoke += o.Spoke
	s.Hits += o.Hits
	s.Trials += o.Trials
}

// UpNext replays a list's runs (each the keys in check-off order, oldest first). Before each run
// it learns the route from the runs behind it only; if that route clears the policy's bar it walks
// the run the way the app does (anchor at the start, then at the last item checked that has a
// spot), and each pick is a hit when it is among the next predict.RouteHitWindow check-offs.
func UpNext(runs [][]string, p autopilot.Policy) UpNextScore {
	var s UpNextScore
	for i, run := range runs {
		s.Runs++
		past := make([]predict.RunOrder, i)
		for j := range past {
			past[j] = runs[j]
		}
		route := predict.LearnRoute(past)
		if !p.RouteClears(&route) {
			continue
		}
		s.Spoke++
		anchor := 0.0
		for j := range run {
			next, _ := predict.PickNext(route.Spots, run[j:], anchor)
			if next != "" {
				s.Trials++
				end := min(j+predict.RouteHitWindow, len(run))
				for _, k := range run[j:end] {
					if k == next {
						s.Hits++
						break
					}
				}
			}
			if sp, ok := route.Spots[run[j]]; ok {
				anchor = sp
			}
		}
	}
	return s
}
