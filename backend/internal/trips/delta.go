package trips

import (
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
