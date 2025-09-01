package models

import "time"

// ListItem represents an item within a list. Items can be completed (toggled)
// and can be deleted by any room member. Completion does not delete the item.
type ListItem struct {
    ItemID      string    `dynamodbav:"item_id" json:"item_id"`
    ListID      string    `dynamodbav:"list_id" json:"list_id"`
    RoomID      string    `dynamodbav:"room_id" json:"room_id"`
    Description string    `dynamodbav:"description" json:"description"`
    Completed   bool      `dynamodbav:"completed" json:"completed"`
    CreatedAt   time.Time `dynamodbav:"created_at" json:"created_at"`
    UpdatedAt   time.Time `dynamodbav:"updated_at" json:"updated_at"`
}

