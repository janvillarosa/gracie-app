package models

import "time"

// Push notification kinds. Each has its own switch in UserPreferences.
const (
	PushKindItemAdds = "item_adds"
	// PushKindItemChecks is "<person> is checking off …". It shares the "List activity" switch
	// (UserPreferences.NotifyItemAdds) with adds.
	PushKindItemChecks = "item_checks"
	PushKindAutopilot  = "autopilot"
	PushKindTrip       = "trip"
)

// Push job states.
const (
	PushJobPending = "pending"
	PushJobSending = "sending"
	PushJobDone    = "done"
)

// PushSubscription is one browser's Web Push subscription (collection "push_subscriptions").
// Endpoint is unique: a device that signs in as someone else moves to that user.
type PushSubscription struct {
	SubID  string `bson:"sub_id"`
	UserID string `bson:"user_id"`
	// SessionID is the signed-in device session that subscribed (empty for a legacy per-user key).
	// The device gets notifications only while that session lives.
	SessionID string `bson:"session_id,omitempty"`
	Endpoint  string `bson:"endpoint"`
	// P256dhEnc and AuthEnc are the subscription's encryption keys, AES-GCM encrypted at rest.
	P256dhEnc string     `bson:"p256dh_enc"`
	AuthEnc   string     `bson:"auth_enc"`
	UserAgent string     `bson:"user_agent,omitempty"`
	CreatedAt time.Time  `bson:"created_at"`
	UpdatedAt time.Time  `bson:"updated_at"`
	LastOKAt  *time.Time `bson:"last_ok_at,omitempty"`
}

// PushJob is one notification waiting in the outbox (collection "push_jobs"). Jobs with the same
// CoalesceKey merge while pending: a burst of adds becomes one notification.
type PushJob struct {
	JobID       string `bson:"job_id"`
	CoalesceKey string `bson:"coalesce_key"`
	Kind        string `bson:"kind"`
	RoomID      string `bson:"room_id"`
	// ActorID is never notified (you don't hear about your own adds).
	ActorID string `bson:"actor_id,omitempty"`
	// Recipients, when set, limits the job to these users (still only current house members).
	// Empty means every house member.
	Recipients []string `bson:"recipients,omitempty"`
	ListID     string   `bson:"list_id,omitempty"`
	URL        string   `bson:"url"`
	// Title and Body are fixed text (trip reminders). Item jobs are worded at send time from
	// Names and Count, so they read well however many adds were merged.
	Title      string     `bson:"title,omitempty"`
	Body       string     `bson:"body,omitempty"`
	Names      []string   `bson:"names,omitempty"`
	Count      int        `bson:"count"`
	Status     string     `bson:"status"`
	SendAfter  time.Time  `bson:"send_after"`
	LeaseUntil *time.Time `bson:"lease_until,omitempty"`
	Attempts   int        `bson:"attempts"`
	// LastAt is the latest event merged into a run job (check-offs); the run ends after a quiet gap.
	LastAt    *time.Time `bson:"last_at,omitempty"`
	CreatedAt time.Time  `bson:"created_at"`
	// ExpireAt drives the TTL index: a done job is kept a week (it dedupes trip reminders), and
	// a pending one that never sends is dropped after that too.
	ExpireAt time.Time `bson:"expire_at"`
}
