package services

import "github.com/janvillarosa/gracie-app/backend/internal/analytics"

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

		analytics.EventDef{Name: "item.added", Role: analytics.RoleRequest},
		analytics.EventDef{Name: "item.checked", Role: analytics.RoleComplete},
		analytics.EventDef{Name: "item.unchecked"},
		analytics.EventDef{Name: "item.edited", Props: fieldsSpec},
		analytics.EventDef{Name: "item.starred"},
		analytics.EventDef{Name: "item.unstarred"},
		analytics.EventDef{Name: "item.deleted"},
		analytics.EventDef{Name: "item.reordered", Skip: true},

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
	)
}
