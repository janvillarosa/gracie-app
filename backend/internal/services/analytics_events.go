package services

import (
	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/parse"
)

var nudgeProps = map[string]analytics.PropSpec{"kind": {Kind: analytics.PropString, MaxLen: 32}}

var predictedProps = map[string]analytics.PropSpec{
	"mode":      {Kind: analytics.PropEnum, Values: []string{"shadow", "on"}}, // "shadow": events from before shadow mode was retired
	"score_pct": {Kind: analytics.PropInt},
	"opens_at":  {Kind: analytics.PropString, MaxLen: 32},
	"closes_at": {Kind: analytics.PropString, MaxLen: 32},
	"series":    {Kind: analytics.PropEnum, Values: []string{"added", "checked"}},
	"during":    {Kind: analytics.PropEnum, Values: []string{analytics.DuringRun}},
}

var duringProps = map[string]analytics.PropSpec{"during": {Kind: analytics.PropEnum, Values: []string{analytics.DuringRun}}}

var fieldsSpec = map[string]analytics.PropSpec{"fields": {Kind: analytics.PropString, MaxLen: 128}}

// RegisterAnalyticsEvents declares the events emitted by lists, items, houses and accounts.
// Subject/Container mapping: item -> list; list, house and user stand alone.
func RegisterAnalyticsEvents(reg *analytics.Registry) {
	reg.MustRegister(
		analytics.EventDef{Name: "list.created"},
		analytics.EventDef{Name: "list.updated", Props: fieldsSpec},
		analytics.EventDef{Name: "list.delete_voted"},
		analytics.EventDef{Name: "list.delete_vote_cancelled"},
		analytics.EventDef{Name: "list.deleted"},
		analytics.EventDef{Name: "list.cleared", Props: map[string]analytics.PropSpec{"count": {Kind: analytics.PropInt}}},

		// qty/unit: the parsed amount (thousandths and a canonical unit, parse.ParseAmount), never
		// the typed text. Nothing reads them yet: they start the history consumption forecasts need.
		analytics.EventDef{Name: "item.added", Role: analytics.RoleRequest, Props: map[string]analytics.PropSpec{
			"source": {Kind: analytics.PropEnum, Values: []string{AddSourceSuggestion}},
			"qty":    {Kind: analytics.PropInt, Min: 0, Max: parse.MaxAmountMilli},
			"unit":   {Kind: analytics.PropEnum, Values: parse.AmountUnits()},
		}},
		analytics.EventDef{Name: "item.checked", Role: analytics.RoleComplete},
		analytics.EventDef{Name: "item.unchecked"},
		analytics.EventDef{Name: "item.edited", Props: fieldsSpec},
		analytics.EventDef{Name: "item.starred"},
		analytics.EventDef{Name: "item.unstarred"},
		analytics.EventDef{Name: "item.deleted"},
		analytics.EventDef{Name: "item.reordered", Skip: true},
		// Smart suggestions. An ignore counts against the item's forecast; a prediction is a
		// measurement record, stored for suggest-eval and never rolled up.
		analytics.EventDef{Name: "item.suggestion_ignored", Role: analytics.RoleDismiss, Props: duringProps},
		analytics.EventDef{Name: "item.suggestion_predicted", Skip: true, Props: predictedProps},
		// An add that came from tapping a suggestion. With the ignores, it is what decides whether the
		// house is still interested (two ignores in a row pause suggestions on that list).
		analytics.EventDef{Name: "item.suggestion_accepted"},

		analytics.EventDef{Name: "house.created"},
		analytics.EventDef{Name: "house.joined"},
		analytics.EventDef{Name: "house.invite_rotated"},
		analytics.EventDef{Name: "house.delete_voted"},
		analytics.EventDef{Name: "house.delete_vote_cancelled"},
		analytics.EventDef{Name: "house.deleted"},
		analytics.EventDef{Name: "house.settings_updated", Props: fieldsSpec},

		analytics.EventDef{Name: "user.signed_up"},
		analytics.EventDef{Name: "user.logged_in"},
		analytics.EventDef{Name: "user.profile_updated", Props: fieldsSpec},
		analytics.EventDef{Name: "user.password_changed"},

		// Sent by the app through POST /events. Subject.Type must equal the name's prefix.
		analytics.EventDef{Name: "app.open", Client: true},
		analytics.EventDef{Name: "app.resume", Client: true},
		analytics.EventDef{Name: "list.view", Client: true},
		analytics.EventDef{Name: "item.delete_undone", Client: true},
		analytics.EventDef{Name: "add_bar.suggestions_shown", Client: true, Props: map[string]analytics.PropSpec{"count": {Kind: analytics.PropInt}}},
		analytics.EventDef{Name: "add_bar.suggestion_accepted", Client: true, Props: map[string]analytics.PropSpec{"rank": {Kind: analytics.PropInt}}},
		analytics.EventDef{Name: "nudge.shown", Client: true, Props: nudgeProps},
		analytics.EventDef{Name: "nudge.tapped", Client: true, Props: nudgeProps},
		analytics.EventDef{Name: "nudge.dismissed", Client: true, Props: nudgeProps},
		// A shopping run finished on a list (the run-done stamp landed).
		analytics.EventDef{Name: "list.run_stamped", Client: true, Props: map[string]analytics.PropSpec{"items": {Kind: analytics.PropInt}, "minutes": {Kind: analytics.PropInt}}},
	)
}
