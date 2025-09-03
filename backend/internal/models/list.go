package models

import "time"

// List represents a collaborative checklist owned by a room (house).
// Deletion is a soft-delete gated by member votes.
type List struct {
    ListID        string            `bson:"list_id"        dynamodbav:"list_id"        json:"list_id"`
    RoomID        string            `bson:"room_id"        dynamodbav:"room_id"        json:"room_id"`
    Name          string            `bson:"name"           dynamodbav:"name"           json:"name"`
    Description   string            `bson:"description,omitempty" dynamodbav:"description,omitempty" json:"description,omitempty"`
    Icon          string            `bson:"icon,omitempty"  dynamodbav:"icon,omitempty"  json:"icon,omitempty"`
    DeletionVotes map[string]string `bson:"deletion_votes,omitempty" dynamodbav:"deletion_votes,omitempty" json:"deletion_votes,omitempty"`
    IsDeleted     bool              `bson:"is_deleted,omitempty"   dynamodbav:"is_deleted,omitempty"   json:"is_deleted"`
    CreatedAt     time.Time         `bson:"created_at"     dynamodbav:"created_at"     json:"created_at"`
    UpdatedAt     time.Time         `bson:"updated_at"     dynamodbav:"updated_at"     json:"updated_at"`
}
