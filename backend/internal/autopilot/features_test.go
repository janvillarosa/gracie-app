package autopilot

import (
	"slices"
	"testing"
)

var allFeatures = []Feature{FeatureSuggestions, FeatureAutoAdd, FeatureRunHint, FeatureUpNext}

func TestTiers(t *testing.T) {
	cases := []struct {
		m    Mode
		f    Feature
		want bool
	}{
		{ModeSuggest, FeatureUpNext, true},
		{ModeAssist, FeatureUpNext, true},
		{ModeOff, FeatureUpNext, false},
		{ModeSuggest, FeatureSuggestions, true},
		{ModeAssist, FeatureSuggestions, false},
		{ModeAssist, FeatureAutoAdd, true},
		{ModeSuggest, FeatureAutoAdd, false},
		{ModeSuggest, FeatureRunHint, true},
		{ModeOff, FeatureRunHint, false},
	}
	for _, c := range cases {
		if got := Has(c.m, c.f); got != c.want {
			t.Errorf("Has(%s, %s) = %v, want %v", c.m, c.f, got, c.want)
		}
	}
	if got := Features(ModeOff); len(got) != 0 {
		t.Errorf("Features(off) = %v, want none", got)
	}
	if got := Features(ModeSuggest); !slices.Equal(got, []Feature{FeatureRunHint, FeatureSuggestions, FeatureUpNext}) {
		t.Errorf("Features(suggest) = %v", got)
	}
}

func TestEveryFeatureHasATier(t *testing.T) {
	for _, f := range allFeatures {
		if len(Tiers[f]) == 0 {
			t.Errorf("feature %s has no tier", f)
		}
	}
	for _, f := range SlipOrder {
		if _, ok := Tiers[f]; !ok {
			t.Errorf("slip %s has no tier", f)
		}
		if f == FeatureRunHint {
			t.Errorf("the run hint is not a slip")
		}
	}
}

// Decide keeps its per-mode bar logic; this pins that it agrees with the table.
func TestDecideAgreesWithTiers(t *testing.T) {
	pr := Proposal{Effect: EffectAddToList, Basis: BasisForecast, Confidence: 1, Need: 1}
	for _, m := range []Mode{ModeOff, ModeSuggest, ModeAssist} {
		d := Decide(m, pr, DefaultPolicy)
		if (d == Suggest) != Has(m, FeatureSuggestions) {
			t.Errorf("%s: Decide=%s but Has(suggestions)=%v", m, d, Has(m, FeatureSuggestions))
		}
		if (d == Apply) != Has(m, FeatureAutoAdd) {
			t.Errorf("%s: Decide=%s but Has(auto_add)=%v", m, d, Has(m, FeatureAutoAdd))
		}
	}
}
