package models

import "time"

type Room struct {
	RoomID        string            `bson:"room_id" json:"-"`
	MemberIDs     []string          `bson:"member_ids" json:"-"`
	DisplayName   string            `bson:"display_name,omitempty" json:"display_name,omitempty"`
	Description   string            `bson:"description,omitempty" json:"description,omitempty"`
	ShareToken    *string           `bson:"share_token,omitempty" json:"share_token,omitempty"`
	DeletionVotes map[string]string `bson:"deletion_votes,omitempty" json:"deletion_votes,omitempty"`
	// AutopilotMode is the house's autopilot setting: "off", "suggest" or "assist". Absent means
	// suggest. Read it through autopilot.HouseMode, which also honours SuggestionsOff.
	AutopilotMode string `bson:"autopilot_mode,omitempty" json:"-"`
	// SuggestionsOff is the setting from before autopilot modes: true reads as mode off. Writing a
	// mode clears it, so no migration is needed.
	SuggestionsOff bool      `bson:"suggestions_off,omitempty" json:"-"`
	CreatedAt      time.Time `bson:"created_at" json:"created_at"`
	UpdatedAt      time.Time `bson:"updated_at" json:"updated_at"`
}
