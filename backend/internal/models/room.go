package models

import "time"

type Room struct {
    RoomID         string            `dynamodbav:"room_id" json:"room_id"`
    MemberIDs      []string          `dynamodbav:"member_ids" json:"member_ids"`
    ShareToken     *string           `dynamodbav:"share_token" json:"share_token,omitempty"`
    DeletionVotes  map[string]string `dynamodbav:"deletion_votes" json:"deletion_votes,omitempty"`
    CreatedAt      time.Time         `dynamodbav:"created_at" json:"created_at"`
    UpdatedAt      time.Time         `dynamodbav:"updated_at" json:"updated_at"`
}

