package trips

import (
	"strings"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

// DeltaSince builds what a client at version `known` needs to reach t.Version.
// present=false means the client has no copy. A client older than the pruned
// tombstone floor also gets a full copy, because it can't learn every deletion.
func DeltaSince(t *models.Trip, known int64, present bool) models.TripDelta {
	d := models.TripDelta{
		TripID: t.TripID, Version: t.Version, BaseVersion: known,
		Deleted: t.DeletedAt != nil, DeletedBy: t.DeletedBy,
	}
	full := !present || known < t.TombFloor
	if full {
		d.Full, d.BaseVersion = true, 0
		known = 0
	}
	if full || t.V > known {
		f := t.TripFields
		d.Trip = &f
	}
	for _, td := range t.Todos {
		if full || td.V > known {
			d.Todos = append(d.Todos, td)
		}
	}
	for _, b := range t.Bookings {
		if full || b.V > known {
			d.Bookings = append(d.Bookings, b)
		}
	}
	if !full {
		for _, ts := range t.Tombstones {
			if ts.V > known {
				d.RemovedIDs = append(d.RemovedIDs, ts.ID)
			}
		}
	}
	return d
}

// Prune bounds the document: tombstones, idle client ack entries and clocks of removed
// day labels all expire after 30 days.
func Prune(t *models.Trip, now time.Time) {
	PruneTombstones(t, now)
	PruneAcked(t, now)
	PruneDayClocks(t, now)
}

// PruneAcked drops client_id entries idle for more than 30 days. Entries from before
// last-seen tracking are stamped with now and age out from there.
func PruneAcked(t *models.Trip, now time.Time) {
	cutoff := now.Add(-tombstoneTTL).UnixMilli()
	for id := range t.Acked {
		ts, ok := t.AckedAt[id]
		if !ok {
			if t.AckedAt == nil {
				t.AckedAt = map[string]int64{}
			}
			t.AckedAt[id] = now.UnixMilli()
			continue
		}
		if ts < cutoff {
			delete(t.Acked, id)
			delete(t.AckedAt, id)
		}
	}
	for id := range t.AckedAt {
		if _, ok := t.Acked[id]; !ok {
			delete(t.AckedAt, id)
		}
	}
}

// PruneDayClocks drops field clocks of unlabelled dates once older than the tombstone TTL
// (clocks are clamped to server time, so a stale op that old can no longer beat them).
func PruneDayClocks(t *models.Trip, now time.Time) {
	cutoff := now.Add(-tombstoneTTL).UnixMilli()
	for k, at := range t.FieldAt {
		if !strings.HasPrefix(k, "days.") {
			continue
		}
		if _, labelled := t.Days[strings.TrimPrefix(k, "days.")]; !labelled && at < cutoff {
			delete(t.FieldAt, k)
		}
	}
}

// PruneTombstones drops tombstones older than 30 days and raises TombFloor to the
// highest pruned version, so clients behind it are sent a full copy.
func PruneTombstones(t *models.Trip, now time.Time) {
	cutoff := now.Add(-tombstoneTTL)
	kept := make([]models.Tombstone, 0, len(t.Tombstones))
	for _, ts := range t.Tombstones {
		if ts.At.Before(cutoff) {
			if ts.V > t.TombFloor {
				t.TombFloor = ts.V
			}
			continue
		}
		kept = append(kept, ts)
	}
	t.Tombstones = kept
}
