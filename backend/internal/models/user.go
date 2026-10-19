package models

import "time"

// UserPreferences holds per-user settings. A nil field means "use the default".
type UserPreferences struct {
	TripsShowNextStop *bool `bson:"trips_show_next_stop,omitempty" json:"trips_show_next_stop,omitempty"`
	// Push notification switches, one per kind. Nil means on.
	NotifyItemAdds  *bool `bson:"notify_item_adds,omitempty" json:"-"`
	NotifyAutopilot *bool `bson:"notify_autopilot,omitempty" json:"-"`
	NotifyTrips     *bool `bson:"notify_trips,omitempty" json:"-"`
}

type User struct {
	UserID          string     `bson:"user_id" json:"user_id"`
	Name            string     `bson:"name" json:"name"`
	Username        string     `bson:"username,omitempty" json:"username,omitempty"`
	PasswordEnc     string     `bson:"password_enc" json:"-"`
	APIKeyHash      string     `bson:"api_key_hash,omitempty" json:"-"`
	APIKeyLookup    string     `bson:"api_key_lookup,omitempty" json:"-"`
	APIKeyExpiresAt *time.Time `bson:"api_key_expires_at,omitempty" json:"-"`
	// APIKeyIssuedAt is when the current key was issued (login rotates it). A push device last
	// refreshed before it belongs to an older login and is skipped. Absent on keys issued before
	// it was recorded.
	APIKeyIssuedAt *time.Time `bson:"api_key_issued_at,omitempty" json:"-"`
	// TZ is the last-seen IANA zone (from the X-Timezone header), used by background jobs.
	TZ string `bson:"tz,omitempty" json:"-"`
	// TestAccount marks an account that may use test mode (internal/services TestModeService). It is
	// set only by the operator command cmd/testaccount, never through the API.
	TestAccount bool            `bson:"test_account,omitempty" json:"-"`
	RoomID      *string         `bson:"room_id,omitempty" json:"room_id,omitempty"`
	Preferences UserPreferences `bson:"preferences,omitempty" json:"preferences"`
	CreatedAt   time.Time       `bson:"created_at" json:"created_at"`
	UpdatedAt   time.Time       `bson:"updated_at" json:"updated_at"`
}

// TripsShowNextStop resolves the preference; the default is true.
func (u *User) TripsShowNextStop() bool {
	return u.Preferences.TripsShowNextStop == nil || *u.Preferences.TripsShowNextStop
}

// Notifies reports whether the user wants push notifications of this kind (default on).
func (u *User) Notifies(kind string) bool {
	var v *bool
	switch kind {
	case PushKindItemAdds, PushKindItemChecks: // one "List activity" switch
		v = u.Preferences.NotifyItemAdds
	case PushKindAutopilot:
		v = u.Preferences.NotifyAutopilot
	case PushKindTrip:
		v = u.Preferences.NotifyTrips
	default:
		return false
	}
	return v == nil || *v
}
