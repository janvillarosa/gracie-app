package models

import "time"

// Session is one signed-in device (collection "sessions"). Each login creates its own, so signing
// in on one device never signs out another. The key is stored like the legacy per-user API key:
// a bcrypt hash plus a SHA-256 lookup for indexed retrieval; the plain key is shown only once.
type Session struct {
	SessionID string    `bson:"session_id"`
	UserID    string    `bson:"user_id"`
	KeyHash   string    `bson:"key_hash"`
	KeyLookup string    `bson:"key_lookup"`
	CreatedAt time.Time `bson:"created_at"`
	// ExpiresAt ends the session; a TTL index removes it then.
	ExpiresAt time.Time `bson:"expires_at"`
}
