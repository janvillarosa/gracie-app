package models

import "time"

// ListItem represents an item within a list. Items can be completed (toggled)
// and can be deleted by any room member. Completion does not delete the item.
type ListItem struct {
    ItemID      string    `bson:"item_id"      dynamodbav:"item_id"      json:"item_id"`
    ListID      string    `bson:"list_id"      dynamodbav:"list_id"      json:"list_id"`
    RoomID      string    `bson:"room_id"      dynamodbav:"room_id"      json:"room_id"`
    // Order controls the display order within a list. Lower comes first.
    // Float64 allows midpoint insertion without immediate renumbering.
    Order       float64   `bson:"order,omitempty"      dynamodbav:"order"      json:"order,omitempty"`
    Description string    `bson:"description"  dynamodbav:"description"  json:"description"`
    Quantity    string    `bson:"quantity,omitempty"   dynamodbav:"quantity,omitempty"  json:"quantity,omitempty"`
    Unit        string    `bson:"unit,omitempty"       dynamodbav:"unit,omitempty"      json:"unit,omitempty"`
    Category    string    `bson:"category,omitempty"   dynamodbav:"category,omitempty"  json:"category,omitempty"`
    IsStarred   bool      `bson:"is_starred,omitempty" dynamodbav:"is_starred,omitempty" json:"is_starred"`
    IsArchived  bool      `bson:"is_archived,omitempty" dynamodbav:"is_archived,omitempty" json:"is_archived"`
    Completed   bool      `bson:"completed"    dynamodbav:"completed"    json:"completed"`
    CreatedAt   time.Time `bson:"created_at"   dynamodbav:"created_at"   json:"created_at"`
    UpdatedAt   time.Time `bson:"updated_at"   dynamodbav:"updated_at"   json:"updated_at"`
}
