package autopilot

import (
	"slices"
	"sort"
)

// Feature is one thing the autopilot does for a house. Which modes switch it on lives in Tiers, and
// nowhere else: every gate asks Has, so a new tier is one edit to this table.
type Feature string

const (
	// FeatureSuggestions is the suggestion slip: things to add, offered for a tap.
	FeatureSuggestions Feature = "suggestions"
	// FeatureAutoAdd is the ticker adding what it would have suggested (assist).
	FeatureAutoAdd Feature = "auto_add"
	// FeatureRunHint is the run hint on a list (when the next shop is).
	FeatureRunHint Feature = "run_hint"
	// FeatureUpNext is the Up next slip.
	FeatureUpNext Feature = "up_next"
)

// Tiers maps each feature to the modes that have it.
var Tiers = map[Feature][]Mode{
	FeatureSuggestions: {ModeSuggest},
	FeatureAutoAdd:     {ModeAssist},
	FeatureRunHint:     {ModeSuggest, ModeAssist},
	FeatureUpNext:      {ModeSuggest, ModeAssist},
}

// SlipOrder is the order the autopilot slips stack on a list, most specific first. The run hint is
// not a slip, so it is not here.
var SlipOrder = []Feature{FeatureUpNext, FeatureAutoAdd, FeatureSuggestions}

// Has reports whether a house in mode m has feature f.
func Has(m Mode, f Feature) bool { return slices.Contains(Tiers[f], m) }

// Features lists what mode m has, sorted by name. It is never nil, so it encodes as [].
func Features(m Mode) []Feature {
	out := []Feature{}
	for f := range Tiers {
		if Has(m, f) {
			out = append(out, f)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}
