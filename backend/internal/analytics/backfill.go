package analytics

import (
	"context"
	"time"
)

// BackfillEvents is what a backfill needs from the raw event store: append, and find
// when live recording began. Kept apart from EventRepository so request-path fakes
// don't have to grow a method they never use.
type BackfillEvents interface {
	InsertMany(ctx context.Context, evs []Event) error
	// EarliestOccurred returns the oldest occurred_at among events from source; ok is
	// false when there are none.
	EarliestOccurred(ctx context.Context, source string) (at time.Time, ok bool, err error)
}
