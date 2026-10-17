package autopilot

// Policy holds the bars, by intrusiveness. Tune them with `suggest-eval autopilot`, not by feel.
type Policy struct {
	// The suggest bar: today's Forecast.Confident (predict.DefaultParams MinScore and MaxCV).
	SuggestMinScore float64
	SuggestMaxCV    float64
	// The assist bar, on the thing's run fit (FitRun): its run score (a Wilson lower bound over the
	// recent cycles that landed in the predicted run) and its need (the chance it runs out by this
	// run). Independent of the suggest bar, which is on the add forecast.
	AssistMinScore float64
	AssistMinNeed  float64
	// MinRunConfidence is how sure the run plan must be before assist plans for that run.
	MinRunConfidence float64
	// MaxPerRun caps how many things assist adds for one run.
	MaxPerRun int
}

// DefaultPolicy's assist bar was set with `suggest-eval autopilot` on the golden households
// (2026-10-17): run score >= 0.50 and need >= 0.60 gives 97.8% precision, F1 77.7% and 0.01 removals
// per house-week, in the middle of a plateau (every bar from 0.45 to 0.60 keeps F1 at 76-78%).
var DefaultPolicy = Policy{
	SuggestMinScore: 0.65, SuggestMaxCV: 0.5,
	AssistMinScore: 0.50, AssistMinNeed: 0.60,
	MinRunConfidence: 0.5, MaxPerRun: 8,
}

// Decide turns a proposal into what to do with it under the house's mode. Off drops everything.
// Assist applies what clears the assist bar and is in-app. Anything else that clears the suggest
// bar is suggested; the rest is dropped. The two bars are independent: assist judges a proposal by
// its run fit, a suggestion by its add forecast.
func Decide(m Mode, pr Proposal, p Policy) Disposition {
	if m == ModeOff {
		return Drop
	}
	if m == ModeAssist && pr.Effect.InApp() && pr.Confidence >= p.AssistMinScore && pr.Need >= p.AssistMinNeed {
		return Apply
	}
	if pr.Confidence >= p.SuggestMinScore {
		return Suggest
	}
	return Drop
}
