package models

import "time"

type Room struct {
    RoomID        string            `bson:"room_id"        dynamodbav:"room_id"        json:"-"`
    MemberIDs     []string          `bson:"member_ids"     dynamodbav:"member_ids"     json:"-"`
    DisplayName   string            `bson:"display_name,omitempty" dynamodbav:"display_name,omitempty" json:"display_name,omitempty"`
    Description   string            `bson:"description,omitempty"  dynamodbav:"description,omitempty"  json:"description,omitempty"`
    ShareToken    *string           `bson:"share_token,omitempty"  dynamodbav:"share_token,omitempty"  json:"share_token,omitempty"`
    DeletionVotes map[string]string `bson:"deletion_votes,omitempty" dynamodbav:"deletion_votes,omitempty" json:"deletion_votes,omitempty"`
    CreatedAt     time.Time         `bson:"created_at"     dynamodbav:"created_at"     json:"created_at"`
    UpdatedAt     time.Time         `bson:"updated_at"     dynamodbav:"updated_at"     json:"updated_at"`
}
