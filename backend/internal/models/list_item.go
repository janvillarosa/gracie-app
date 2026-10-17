package models

import "time"

// ListItem represents an item within a list. Items can be completed (toggled)
// and can be deleted by any room member. Completion does not delete the item.
type ListItem struct {
	ItemID string `bson:"item_id" json:"item_id"`
	ListID string `bson:"list_id" json:"list_id"`
	RoomID string `bson:"room_id" json:"room_id"`
	// Order controls the display order within a list. Lower comes first.
	// Float64 allows midpoint insertion without immediate renumbering.
	Order       float64 `bson:"order,omitempty" json:"order,omitempty"`
	Description string  `bson:"description" json:"description"`
	Quantity    string  `bson:"quantity,omitempty" json:"quantity,omitempty"`
	Unit        string  `bson:"unit,omitempty" json:"unit,omitempty"`
	Category    string  `bson:"category,omitempty" json:"category,omitempty"`
	IsStarred   bool    `bson:"is_starred,omitempty" json:"is_starred"`
	IsArchived  bool    `bson:"is_archived,omitempty" json:"is_archived"`
	Completed   bool    `bson:"completed" json:"completed"`
	// Source says who put the item on the list when it was not a person: "autopilot" for an
	// assist-mode add (the app marks it and can show why). Empty for people's adds.
	Source string `bson:"source,omitempty" json:"source,omitempty"`
	// Actor and time stamps feed behavior analytics; absent on items that predate them.
	CreatedBy   string     `bson:"created_by,omitempty" json:"-"`
	CompletedAt *time.Time `bson:"completed_at,omitempty" json:"-"`
	CompletedBy string     `bson:"completed_by,omitempty" json:"-"`
	CreatedAt   time.Time  `bson:"created_at" json:"created_at"`
	UpdatedAt   time.Time  `bson:"updated_at" json:"updated_at"`
}
