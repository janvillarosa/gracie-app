package analytics

import (
	"context"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/janvillarosa/gracie-app/backend/pkg/ids"
)

// Recorder accepts events without ever blocking or failing the caller.
type Recorder interface {
	Record(ctx context.Context, ev Event)
}

// Clock is injectable for tests.
type Clock func() time.Time

// Stamp fills the server-owned fields (id, version, ingest/local time, expiry).
// The caller supplies Name, Source, ActorID, RoomID, Subject and optional extras.
func Stamp(ev *Event, now time.Time, tz string, retention time.Duration) {
	if ev.EventID == "" {
		ev.EventID = ids.NewID("ev")
	}
	ev.V = EnvelopeVersion
	if ev.OccurredAt.IsZero() {
		ev.OccurredAt = now
	}
	ev.OccurredAt = ev.OccurredAt.UTC()
	ev.IngestedAt = now.UTC()
	ev.Local = LocalAt(ev.OccurredAt, tz)
	ev.ExpireAt = ev.OccurredAt.Add(retention)
}

// NopRecorder discards everything (feature off, default in tests).
type NopRecorder struct{}

func (NopRecorder) Record(context.Context, Event) {}

// BufferedRecorder queues events and flushes them in batches. When the buffer is
// full events are dropped and counted, never blocked on: analytics must not slow
// down or fail a user write.
type BufferedRecorder struct {
	repo      EventRepository
	reg       *Registry
	retention time.Duration
	now       Clock
	ch        chan Event
	dropped   atomic.Int64
	wg        sync.WaitGroup
	closeOnce sync.Once
}

const (
	flushEvery = time.Second
	flushSize  = 200
)

// NewBufferedRecorder starts the flusher. Call Close on shutdown to drain.
func NewBufferedRecorder(repo EventRepository, reg *Registry, buffer int, retention time.Duration) *BufferedRecorder {
	if buffer <= 0 {
		buffer = 4096
	}
	r := &BufferedRecorder{repo: repo, reg: reg, retention: retention, now: time.Now, ch: make(chan Event, buffer)}
	r.wg.Add(1)
	go r.run()
	return r
}

// Record stamps and enqueues. Unknown event names are dropped.
func (r *BufferedRecorder) Record(ctx context.Context, ev Event) {
	if _, ok := r.reg.Resolve(ev.Name); !ok {
		return
	}
	Stamp(&ev, r.now(), TZFrom(ctx), r.retention)
	select {
	case r.ch <- ev:
	default:
		if n := r.dropped.Add(1); n%100 == 1 {
			log.Printf("analytics: buffer full, %d events dropped so far", n)
		}
	}
}

// Dropped reports how many events were discarded because the buffer was full.
func (r *BufferedRecorder) Dropped() int64 { return r.dropped.Load() }

func (r *BufferedRecorder) run() {
	defer r.wg.Done()
	t := time.NewTicker(flushEvery)
	defer t.Stop()
	batch := make([]Event, 0, flushSize)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := r.repo.InsertMany(ctx, batch); err != nil {
			log.Printf("analytics: flush of %d events failed: %v", len(batch), err)
		}
		batch = batch[:0]
	}
	for {
		select {
		case ev, ok := <-r.ch:
			if !ok {
				flush()
				return
			}
			batch = append(batch, ev)
			if len(batch) >= flushSize {
				flush()
			}
		case <-t.C:
			flush()
		}
	}
}

// Close drains the buffer and stops the flusher. Record must not be called afterwards.
func (r *BufferedRecorder) Close(ctx context.Context) error {
	r.closeOnce.Do(func() { close(r.ch) })
	done := make(chan struct{})
	go func() { r.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
