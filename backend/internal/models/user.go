package models

import "time"

type User struct {
	UserID          string     `bson:"user_id" json:"user_id"`
	Name            string     `bson:"name" json:"name"`
	Username        string     `bson:"username,omitempty" json:"username,omitempty"`
	PasswordEnc     string     `bson:"password_enc" json:"-"`
	APIKeyHash      string     `bson:"api_key_hash,omitempty" json:"-"`
	APIKeyLookup    string     `bson:"api_key_lookup,omitempty" json:"-"`
	APIKeyExpiresAt *time.Time `bson:"api_key_expires_at,omitempty" json:"-"`
	RoomID          *string    `bson:"room_id,omitempty" json:"room_id,omitempty"`
	CreatedAt       time.Time  `bson:"created_at" json:"created_at"`
	UpdatedAt       time.Time  `bson:"updated_at" json:"updated_at"`
}
