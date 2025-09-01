package models

import "time"

type User struct {
    UserID          string     `bson:"user_id"       dynamodbav:"user_id"       json:"user_id"`
    Name            string     `bson:"name"          dynamodbav:"name"          json:"name"`
    Username        string     `bson:"username,omitempty" dynamodbav:"username,omitempty" json:"username,omitempty"`
    PasswordEnc     string     `bson:"password_enc"  dynamodbav:"password_enc"  json:"-"`
    APIKeyHash      string     `bson:"api_key_hash,omitempty" dynamodbav:"api_key_hash,omitempty" json:"-"`
    APIKeyLookup    string     `bson:"api_key_lookup,omitempty" dynamodbav:"api_key_lookup,omitempty" json:"-"`
    APIKeyExpiresAt *time.Time `bson:"api_key_expires_at,omitempty" dynamodbav:"api_key_expires_at,omitempty" json:"-"`
    RoomID          *string    `bson:"room_id,omitempty" dynamodbav:"room_id,omitempty" json:"room_id,omitempty"`
    CreatedAt       time.Time  `bson:"created_at"    dynamodbav:"created_at"    json:"created_at"`
    UpdatedAt       time.Time  `bson:"updated_at"    dynamodbav:"updated_at"    json:"updated_at"`
}
