package models

import "time"

type User struct {
    UserID      string     `dynamodbav:"user_id" json:"user_id"`
    Name        string     `dynamodbav:"name" json:"name"`
    Username    string     `dynamodbav:"username" json:"username,omitempty"`
    PasswordEnc string     `dynamodbav:"password_enc" json:"-"`
    APIKeyHash  string     `dynamodbav:"api_key_hash,omitempty" json:"-"`
    APIKeyLookup string    `dynamodbav:"api_key_lookup,omitempty" json:"-"`
    RoomID      *string    `dynamodbav:"room_id,omitempty" json:"room_id,omitempty"`
    CreatedAt   time.Time  `dynamodbav:"created_at" json:"created_at"`
    UpdatedAt   time.Time  `dynamodbav:"updated_at" json:"updated_at"`
}
