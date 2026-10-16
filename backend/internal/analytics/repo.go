package analytics

import (
	"context"
	"sync"
	"time"
)

// EventRepository is the raw event store. It lives here, not in internal/store,
// so the persistence packages depend on analytics and never the reverse.
type EventRepository interface {
	// InsertMany appends events; a duplicate event_id is silently ignored (idempotent).
	InsertMany(ctx context.Context, evs []Event) error
	// ListIngestedBetween returns events with from <= ingested_at < to, oldest first, up to limit.
	ListIngestedBetween(ctx context.Context, from, to time.Time, limit int) ([]Event, error)
	// DeleteByActor and DeleteByRoom remove raw events when an account or house is deleted.
	DeleteByActor(ctx context.Context, userID string) error
	DeleteByRoom(ctx context.Context, roomID string) error
}

// MemRecorder captures events for assertions in tests.
type MemRecorder struct {
	mu     sync.Mutex
	events []Event
	reg    *Registry
}

// NewMemRecorder validates names against reg when it is non-nil.
func NewMemRecorder(reg *Registry) *MemRecorder { return &MemRecorder{reg: reg} }

func (m *MemRecorder) Record(ctx context.Context, ev Event) {
	if m.reg != nil {
		if _, ok := m.reg.Resolve(ev.Name); !ok {
			return
		}
	}
	Stamp(&ev, time.Now(), TZFrom(ctx), 400*24*time.Hour)
	m.mu.Lock()
	m.events = append(m.events, ev)
	m.mu.Unlock()
}

// Events returns a copy of everything recorded so far.
func (m *MemRecorder) Events() []Event {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]Event(nil), m.events...)
}

// Names returns recorded event names in order.
func (m *MemRecorder) Names() []string {
	evs := m.Events()
	out := make([]string, len(evs))
	for i, e := range evs {
		out[i] = e.Name
	}
	return out
}
