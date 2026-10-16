package analytics

import (
	"context"
	"log"
	"math/rand"
	"strings"
	"time"
)

const (
	profileBatch   = 100
	profileEvents  = 20000
	staleAfter     = 24 * time.Hour
	staleRequeueMx = 200
)

// ProfilePass recomputes the profiles of subjects marked dirty by the fold, plus a slice of
// profiles gone stale. A subject whose recompute fails is put back for the next pass.
func (w *Worker) ProfilePass(ctx context.Context) (int, error) {
	now := w.now().UTC()
	if _, err := w.aggs.RequeueStale(ctx, now.Add(-staleAfter), staleRequeueMx); err != nil {
		log.Printf("analytics: requeue stale profiles: %v", err)
	}
	subjects, err := w.aggs.ClaimDirty(ctx, profileBatch)
	if err != nil || len(subjects) == 0 {
		return 0, err
	}
	done := 0
	for _, id := range subjects {
		if err := w.recomputeProfile(ctx, id, now); err != nil {
			log.Printf("analytics: profile %s: %v", id, err)
			_ = w.aggs.MarkDirty(context.Background(), id)
			continue
		}
		done++
	}
	return done, nil
}

func (w *Worker) recomputeProfile(ctx context.Context, id string, now time.Time) error {
	scope, owner, ok := strings.Cut(id, ":")
	if !ok || owner == "" {
		return nil // malformed ids are dropped, not retried forever
	}
	since := now.Add(-ProfileWindow)
	var evs []Event
	var err error
	switch scope {
	case "u":
		evs, err = w.events.ListByActorSince(ctx, owner, since, profileEvents)
	case "h":
		evs, err = w.events.ListByRoomSince(ctx, owner, since, profileEvents)
	default:
		return nil
	}
	if err != nil {
		return err
	}
	return w.aggs.PutProfile(ctx, BuildProfile(w.reg, id, evs, now))
}

// RunProfiles recomputes profiles on a jittered timer until ctx ends.
func (w *Worker) RunProfiles(ctx context.Context, every, jitter time.Duration) {
	for {
		if n, err := w.ProfilePass(ctx); err != nil {
			log.Printf("analytics: profiles: %v", err)
		} else if n > 0 {
			log.Printf("analytics: recomputed %d profiles", n)
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
