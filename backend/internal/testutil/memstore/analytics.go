package memstore

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
)

// EventRepo is an in-memory analytics.EventRepository.
type EventRepo struct {
	mu   sync.Mutex
	evs  []analytics.Event
	seen map[string]bool
}

func NewEventRepo() *EventRepo { return &EventRepo{seen: map[string]bool{}} }

func (r *EventRepo) InsertMany(_ context.Context, evs []analytics.Event) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, e := range evs {
		if r.seen[e.EventID] {
			continue
		}
		r.seen[e.EventID] = true
		r.evs = append(r.evs, e)
	}
	return nil
}

func (r *EventRepo) ListIngestedBetween(_ context.Context, from, to time.Time, limit int) ([]analytics.Event, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []analytics.Event
	for _, e := range r.evs {
		if !e.IngestedAt.Before(from) && e.IngestedAt.Before(to) {
			out = append(out, e)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].IngestedAt.Before(out[j].IngestedAt) })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (r *EventRepo) ListForKey(_ context.Context, roomID, subjectType, key string, limit int) ([]analytics.Event, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []analytics.Event
	for _, e := range r.evs {
		if e.RoomID == roomID && e.Key == key && e.Subject.Type == subjectType {
			out = append(out, e)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].OccurredAt.Before(out[j].OccurredAt) })
	if limit > 0 && len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out, nil
}

func (r *EventRepo) DeleteByActor(_ context.Context, userID string) error {
	return r.deleteWhere(func(e analytics.Event) bool { return e.ActorID == userID })
}

func (r *EventRepo) DeleteByRoom(_ context.Context, roomID string) error {
	return r.deleteWhere(func(e analytics.Event) bool { return e.RoomID == roomID })
}

func (r *EventRepo) deleteWhere(match func(analytics.Event) bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	kept := r.evs[:0]
	for _, e := range r.evs {
		if match(e) {
			delete(r.seen, e.EventID)
			continue
		}
		kept = append(kept, e)
	}
	r.evs = kept
	return nil
}

// All returns a copy of every stored event (test helper).
func (r *EventRepo) All() []analytics.Event {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]analytics.Event(nil), r.evs...)
}

func (r *EventRepo) EarliestOccurred(_ context.Context, source string) (time.Time, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var first time.Time
	for _, e := range r.evs {
		if e.Source == source && (first.IsZero() || e.OccurredAt.Before(first)) {
			first = e.OccurredAt
		}
	}
	return first, !first.IsZero(), nil
}

var (
	_ analytics.EventRepository = (*EventRepo)(nil)
	_ analytics.BackfillEvents  = (*EventRepo)(nil)
)
