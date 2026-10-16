package analytics

import (
	"context"
	"log"
	"math/rand"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/pkg/ids"
)

const (
	// ingestLag leaves room for events still in a recorder buffer or a retrying flush, so a
	// window is only folded once nothing older can still arrive.
	ingestLag = 2 * time.Minute
	foldLimit = 5000
	leaseTTL  = 5 * time.Minute
	keyEvents = 500 // newest events read per key when recomputing its rhythm
)

func minTime(cur, t time.Time) time.Time {
	if cur.IsZero() || t.Before(cur) {
		return t
	}
	return cur
}

func maxTime(cur, t time.Time) time.Time {
	if cur.IsZero() || t.After(cur) {
		return t
	}
	return cur
}

// Worker folds raw events into the precomputed aggregates.
type Worker struct {
	events EventRepository
	aggs   AggregateRepository
	reg    *Registry
	owner  string
	now    func() time.Time
}

func NewWorker(events EventRepository, aggs AggregateRepository, reg *Registry) *Worker {
	return &Worker{events: events, aggs: aggs, reg: reg, owner: ids.NewID("worker"), now: time.Now}
}

// WithClock replaces the clock (tests drive the ingest lag and staleness with it).
func (w *Worker) WithClock(now func() time.Time) *Worker {
	w.now = now
	return w
}

// FoldOnce runs one fold pass and returns how many events it folded. Only the instance
// holding the lease does work, so any number of instances can run it safely.
func (w *Worker) FoldOnce(ctx context.Context) (int, error) {
	now := w.now().UTC()
	watermark, ok, err := w.aggs.AcquireLease(ctx, w.owner, leaseTTL, now)
	if err != nil || !ok {
		return 0, err
	}
	defer func() { _ = w.aggs.ReleaseLease(context.Background(), w.owner) }()

	upper := now.Add(-ingestLag).Truncate(time.Millisecond)
	evs, err := w.events.ListIngestedBetween(ctx, watermark, upper, foldLimit)
	if err != nil || len(evs) == 0 {
		return 0, err
	}
	next := upper
	if len(evs) == foldLimit {
		// The page is full, so more may follow. Drop the trailing events that share the last
		// timestamp (they are read again next pass) and resume just after the last one kept.
		last := evs[len(evs)-1].IngestedAt
		cut := len(evs)
		for cut > 0 && evs[cut-1].IngestedAt.Equal(last) {
			cut--
		}
		if cut > 0 {
			evs = evs[:cut]
			next = evs[cut-1].IngestedAt.Add(time.Millisecond)
		} // else every event shares one millisecond: take them all and move on
	}
	batch := Fold(w.reg, evs)
	if err := w.aggs.ApplyBatch(ctx, batch, w.owner, next); err != nil {
		return 0, err
	}
	// Intervals are derived from the raw history, so recomputing is idempotent and sits
	// outside the transaction. A failure here is repaired by the next event for the key.
	for _, ref := range batch.Touched {
		if err := w.recomputeKey(ctx, ref); err != nil {
			log.Printf("analytics: recompute %s: %v", ref.ID(), err)
		}
	}
	return len(evs), nil
}

// recomputeKey rebuilds one key's rhythm from its newest events: completions first, and
// requests when there are too few completions to say anything.
func (w *Worker) recomputeKey(ctx context.Context, ref KeyRef) error {
	evs, err := w.events.ListForKey(ctx, ref.RoomID, ref.SubjectType, ref.Key, keyEvents)
	if err != nil {
		return err
	}
	var done, asked []time.Time
	for _, e := range evs {
		def, ok := w.reg.Resolve(e.Name)
		if !ok {
			continue
		}
		switch def.Role {
		case RoleComplete:
			done = append(done, e.OccurredAt)
		case RoleRequest:
			asked = append(asked, e.OccurredAt)
		}
	}
	source, rhythm := "complete", predict.Intervals(done)
	if rhythm.N < predict.MinOccurrences {
		if alt := predict.Intervals(asked); alt.N > rhythm.N {
			source, rhythm = "request", alt
		}
	}
	iv := KeyIntervals{N: rhythm.N, Source: source, EWMADays: rhythm.EWMADays, CV: rhythm.CV, LastAt: rhythm.Last, ComputedAt: w.now().UTC()}
	if due, ok := rhythm.Due(); ok {
		iv.DueAt = &due
	}
	return w.aggs.SetKeyIntervals(ctx, ref.ID(), iv)
}

// RunFold folds on a jittered timer until ctx ends, like the coordinate purge.
func (w *Worker) RunFold(ctx context.Context, every, jitter time.Duration) {
	for {
		if n, err := w.FoldOnce(ctx); err != nil {
			log.Printf("analytics: fold: %v", err)
		} else if n > 0 {
			log.Printf("analytics: folded %d events", n)
		}
		wait := every
		if jitter > 0 {
			wait += time.Duration(rand.Int63n(int64(jitter)))
		}
		t := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-t.C:
		}
	}
}
