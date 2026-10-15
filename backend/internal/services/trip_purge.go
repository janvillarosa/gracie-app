package services

import (
	"context"
	"log"
	"math/rand"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/trips"
)

const purgeBatch = 100

// PurgeStaleCoords enforces the Google Maps Platform 30-day rule: it nulls lat, lng and
// coords_fetched_at on Google places older than 30 days (place_id and tz stay), bumps the
// entity v and the trip version so clients receive a delta, and attributes the change to
// models.SystemActor. It reads only trips whose indexed coords_expire_at is due, writes each
// with the same compare-and-swap as user ops (a lost race is picked up by the next run), and
// is idempotent. It returns how many trips were rewritten.
func (s *TripService) PurgeStaleCoords(ctx context.Context) (int, error) {
	now := s.now().UTC()
	total := 0
	for {
		due, err := s.trips.ListCoordsExpired(ctx, now, purgeBatch)
		if err != nil {
			return total, err
		}
		progress := 0
		for i := range due {
			t := &due[i]
			base := t.Version
			if !trips.PurgeStaleCoords(t, now) {
				continue
			}
			ok, err := s.trips.ReplaceCAS(ctx, t, base)
			if err != nil {
				return total, err
			}
			if ok {
				progress++
			}
		}
		total += progress
		if progress == 0 || len(due) < purgeBatch {
			return total, nil
		}
	}
}

// RunCoordsPurge runs PurgeStaleCoords once at startup and then every `every` plus a random
// delay of up to `jitter` (so instances do not fire together), until ctx is cancelled.
func (s *TripService) RunCoordsPurge(ctx context.Context, every, jitter time.Duration) {
	run := func() {
		n, err := s.PurgeStaleCoords(ctx)
		switch {
		case err != nil && ctx.Err() == nil:
			log.Printf("trips: coordinate purge failed after %d trips: %v", n, err)
		case n > 0:
			log.Printf("trips: coordinate purge rewrote %d trips", n)
		}
	}
	run()
	for {
		d := every
		if jitter > 0 {
			d += time.Duration(rand.Int63n(int64(jitter)))
		}
		timer := time.NewTimer(d)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
			run()
		}
	}
}
