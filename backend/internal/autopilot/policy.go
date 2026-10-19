package autopilot

import "github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"

// Policy holds the bars, by intrusiveness. Tune them with `suggest-eval autopilot`, not by feel.
type Policy struct {
	// The suggest bar: today's Forecast.Confident (predict.DefaultParams MinScore and MaxCV).
	SuggestMinScore float64
	SuggestMaxCV    float64
	// The run-fit bar, on the thing's run fit (FitRun): its run score (a Wilson lower bound over the
	// recent cycles that landed in the predicted run) and its need (the chance it runs out by this
	// run). Assist adds what clears either bar: this one, or the suggest bar on the add forecast.
	AssistMinScore float64
	AssistMinNeed  float64
	// MinRunConfidence is how sure the run plan must be before assist plans for that run.
	MinRunConfidence float64
	// MaxPerRun caps how many things assist adds for one run.
	MaxPerRun int
	// The Up next bar: a house's route is trusted once it has been learned from UpNextMinRuns
	// runs and has predicted the next check-off at least UpNextMinScore of the time.
	UpNextMinRuns  int
	UpNextMinScore float64
}

// DefaultPolicy's run-fit bar was set with `suggest-eval autopilot` on the golden households
// (2026-10-17): run score >= 0.50 and need >= 0.60, in the middle of a plateau (every bar from 0.45
// to 0.60 kept F1 at 76-78% on its own). With the suggest bar beside it, assist scores 83.9%
// precision, 69.6% open recall, F1 76.1% and 0.07 removals per house-week.
var DefaultPolicy = Policy{
	SuggestMinScore: 0.65, SuggestMaxCV: 0.5,
	AssistMinScore: 0.50, AssistMinNeed: 0.60,
	MinRunConfidence: 0.5, MaxPerRun: 8,
	// The score bar is provisional until the route eval sets it.
	UpNextMinRuns: 5, UpNextMinScore: 0.5,
}

// Decide turns a proposal into what to do with it under the house's mode. The modes do not mix:
// Off drops everything; Suggest offers what clears the suggest bar and changes nothing; Assist
// applies, and never offers a suggestion. If it is good enough to suggest, assist adds it: assist
// applies an in-app proposal that clears the bar that picked it (the suggest bar for a forecast
// pick, the run-fit bar for a run pick) and drops the rest.
func Decide(m Mode, pr Proposal, p Policy) Disposition {
	switch m {
	case ModeSuggest:
		if pr.Confidence >= p.SuggestMinScore {
			return Suggest
		}
	case ModeAssist:
		if pr.Effect.InApp() && p.Clears(pr) {
			return Apply
		}
	}
	return Drop
}

// Clears reports whether a proposal clears the bar of the basis that picked it.
func (p Policy) Clears(pr Proposal) bool {
	if pr.Basis == BasisRun {
		return pr.Confidence >= p.AssistMinScore && pr.Need >= p.AssistMinNeed
	}
	return pr.Confidence >= p.SuggestMinScore
}

// RouteClears reports whether a learned route is good enough to order Up next by.
func (p Policy) RouteClears(r *predict.Route) bool {
	return r != nil && r.Runs >= p.UpNextMinRuns && r.Score >= p.UpNextMinScore
}
