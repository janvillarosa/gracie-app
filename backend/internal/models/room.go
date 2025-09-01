package models

import "time"

type Room struct {
    RoomID         string            `dynamodbav:"room_id" json:"-"`
    MemberIDs      []string          `dynamodbav:"member_ids" json:"-"`
    DisplayName    string            `dynamodbav:"display_name,omitempty" json:"display_name,omitempty"`
    Description    string            `dynamodbav:"description,omitempty" json:"description,omitempty"`
    ShareToken     *string           `dynamodbav:"share_token,omitempty" json:"share_token,omitempty"`
    DeletionVotes  map[string]string `dynamodbav:"deletion_votes,omitempty" json:"deletion_votes,omitempty"`
    CreatedAt      time.Time         `dynamodbav:"created_at" json:"created_at"`
    UpdatedAt      time.Time         `dynamodbav:"updated_at" json:"updated_at"`
}
