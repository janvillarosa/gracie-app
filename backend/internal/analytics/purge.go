package analytics

import (
	"context"
	"log"
	"time"
)

// Purger erases behavior data when an account or a house is deleted.
type Purger struct {
	events EventRepository
	aggs   AggregateRepository
	// sweepAfter schedules a second pass: events still in a recorder buffer when the first
	// pass ran are flushed after it, and would otherwise outlive the account until their TTL.
	sweepAfter time.Duration
}

func NewPurger(events EventRepository, aggs AggregateRepository) *Purger {
	return &Purger{events: events, aggs: aggs, sweepAfter: 15 * time.Second}
}

// WithSweep overrides the delay of the second pass (zero disables it).
func (p *Purger) WithSweep(d time.Duration) *Purger {
	p.sweepAfter = d
	return p
}

func (p *Purger) sweep(run func(context.Context) error, what string) {
	if p.sweepAfter <= 0 {
		return
	}
	time.AfterFunc(p.sweepAfter, func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := run(ctx); err != nil {
			log.Printf("analytics: sweep %s: %v", what, err)
		}
	})
}

// PurgeUser removes everything recorded about one person: the events they performed and
// their personal period stats and profile.
func (p *Purger) PurgeUser(ctx context.Context, userID string) error {
	run := func(ctx context.Context) error {
		if err := p.events.DeleteByActor(ctx, userID); err != nil {
			return err
		}
		return p.aggs.DeleteByUser(ctx, userID)
	}
	if err := run(ctx); err != nil {
		return err
	}
	p.sweep(run, "user")
	return nil
}

// PurgeRoom removes a deleted house's events, period stats, key stats and profile.
func (p *Purger) PurgeRoom(ctx context.Context, roomID string) error {
	run := func(ctx context.Context) error {
		if err := p.events.DeleteByRoom(ctx, roomID); err != nil {
			return err
		}
		return p.aggs.DeleteByRoom(ctx, roomID)
	}
	if err := run(ctx); err != nil {
		return err
	}
	p.sweep(run, "room")
	return nil
}

// ForgetRoomAggregates drops only the house-level aggregates of a room that no longer
// exists, keeping the raw events. It is for a solo house dissolved when its owner joins
// another: the person's own history (their profile is built from their events) goes on.
func (p *Purger) ForgetRoomAggregates(ctx context.Context, roomID string) error {
	return p.aggs.DeleteByRoom(ctx, roomID)
}
