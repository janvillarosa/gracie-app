package autopilot

// Policy holds the bars, by intrusiveness. Tune them with `suggest-eval autopilot`, not by feel.
type Policy struct {
	// The suggest bar: today's Forecast.Confident (predict.DefaultParams MinScore and MaxCV).
	SuggestMinScore float64
	SuggestMaxCV    float64
	// The assist bar is stricter: a high forecast score and a high chance the thing is needed
	// before the run after next.
	AssistMinScore float64
	AssistMinNeed  float64
	// MinRunConfidence is how sure the run plan must be before assist plans for that run.
	MinRunConfidence float64
	// MaxPerRun caps how many things assist adds for one run.
	MaxPerRun int
}

// DefaultPolicy is the starting point; Task 9's eval decides the assist bar.
var DefaultPolicy = Policy{
	SuggestMinScore: 0.65, SuggestMaxCV: 0.5,
	AssistMinScore: 0.80, AssistMinNeed: 0.70,
	MinRunConfidence: 0.5, MaxPerRun: 8,
}

// Decide turns a proposal into what to do with it under the house's mode. Off drops everything;
// suggest only ever suggests; assist applies what clears the stricter bar and is in-app, and
// suggests the rest that clears the suggest bar.
func Decide(m Mode, pr Proposal, p Policy) Disposition {
	if m == ModeOff || pr.Confidence < p.SuggestMinScore {
		return Drop
	}
	if m != ModeAssist || !pr.Effect.InApp() {
		return Suggest
	}
	if pr.Confidence >= p.AssistMinScore && pr.Need >= p.AssistMinNeed {
		return Apply
	}
	return Suggest
}
