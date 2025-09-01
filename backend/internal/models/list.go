package models

import "time"

// List represents a collaborative checklist owned by a room (house).
// Deletion is a soft-delete gated by member votes.
type List struct {
    ListID        string            `dynamodbav:"list_id" json:"list_id"`
    RoomID        string            `dynamodbav:"room_id" json:"room_id"`
    Name          string            `dynamodbav:"name" json:"name"`
    Description   string            `dynamodbav:"description,omitempty" json:"description,omitempty"`
    DeletionVotes map[string]string `dynamodbav:"deletion_votes,omitempty" json:"deletion_votes,omitempty"`
    IsDeleted     bool              `dynamodbav:"is_deleted,omitempty" json:"is_deleted"`
    CreatedAt     time.Time         `dynamodbav:"created_at" json:"created_at"`
    UpdatedAt     time.Time         `dynamodbav:"updated_at" json:"updated_at"`
}

