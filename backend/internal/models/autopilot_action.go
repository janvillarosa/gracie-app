package models

import "time"

// Autopilot action states. An action starts applied and ends in exactly one other state.
const (
	ActionApplied   = "applied"   // autopilot put the item on the list
	ActionConfirmed = "confirmed" // someone checked it off: it was wanted
	ActionRemoved   = "removed"   // someone deleted the item: a miss
	ActionUndone    = "undone"    // someone tapped Undo: a miss
	ActionExpired   = "expired"   // its run came and went with the item still unchecked
)

// AutopilotReason says why an action was taken, as data the app turns into words.
type AutopilotReason struct {
	Code   string         `bson:"code" json:"code"`
	Params map[string]any `bson:"params,omitempty" json:"params,omitempty"`
}

// AutopilotAction is one in-app action autopilot applied for a house. Only applied actions are
// stored (suggestions stay stateless): "did we already add this?" must be exact, and the event
// recorder may drop events. (room_id, kind, key, cycle) is unique, so one thing gets at most one
// action per forecast cycle, however many instances race.
type AutopilotAction struct {
	ActionID   string          `bson:"action_id" json:"action_id"`
	RoomID     string          `bson:"room_id" json:"-"`
	ListID     string          `bson:"list_id" json:"list_id"`
	Kind       string          `bson:"kind" json:"kind"`
	Key        string          `bson:"key" json:"key"`
	Cycle      string          `bson:"cycle" json:"cycle"`
	ItemID     string          `bson:"item_id,omitempty" json:"item_id,omitempty"`
	State      string          `bson:"state" json:"state"`
	Confidence float64         `bson:"confidence" json:"confidence"`
	Reason     AutopilotReason `bson:"reason" json:"reason"`
	// RunAt is when the run the action was planned for starts.
	RunAt      time.Time  `bson:"run_at" json:"run_at"`
	CreatedAt  time.Time  `bson:"created_at" json:"created_at"`
	ResolvedAt *time.Time `bson:"resolved_at,omitempty" json:"resolved_at,omitempty"`
	// PurgeAt is set on resolution (resolved_at + 180 days); a TTL index removes the row then.
	PurgeAt *time.Time `bson:"purge_at,omitempty" json:"-"`
}
