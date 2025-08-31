package models

import "time"

type User struct {
    UserID      string     `dynamodbav:"user_id" json:"user_id"`
    Name        string     `dynamodbav:"name" json:"name"`
    APIKeyHash  string     `dynamodbav:"api_key_hash" json:"-"`
    APIKeyLookup string    `dynamodbav:"api_key_lookup" json:"-"`
    RoomID      *string    `dynamodbav:"room_id" json:"room_id,omitempty"`
    CreatedAt   time.Time  `dynamodbav:"created_at" json:"created_at"`
    UpdatedAt   time.Time  `dynamodbav:"updated_at" json:"updated_at"`
}
