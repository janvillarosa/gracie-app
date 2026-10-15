package trips

import (
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

// googlePlaces visits every place slot of a trip (destination, stops, todo places, booking
// places). The callback may return a replacement; places are immutable values, so a changed
// one is a fresh copy and the slot is reassigned.
func eachPlaceSlot(t *models.Trip, fn func(p **models.Place), stopFn func(p *models.Place)) {
	fn(&t.Destination)
	for i := range t.Stops {
		stopFn(&t.Stops[i])
	}
	for i := range t.Todos {
		fn(&t.Todos[i].Place)
	}
	for i := range t.Bookings {
		fn(&t.Bookings[i].Place)
		fn(&t.Bookings[i].EndPlace)
	}
}

func hasGoogleCoords(p *models.Place) bool {
	return p != nil && p.Source == models.SourceGoogle && p.Lat != nil && p.CoordsFetchedAt != nil
}

// RecomputeCoordsExpiry sets t.CoordsExpireAt to the moment the oldest stored Google
// coordinate turns 30 days old, or nil when the trip holds none.
func RecomputeCoordsExpiry(t *models.Trip) {
	var oldest *time.Time
	see := func(p *models.Place) {
		if hasGoogleCoords(p) && (oldest == nil || p.CoordsFetchedAt.Before(*oldest)) {
			oldest = p.CoordsFetchedAt
		}
	}
	eachPlaceSlot(t, func(p **models.Place) { see(*p) }, see)
	if oldest == nil {
		t.CoordsExpireAt = nil
		return
	}
	e := oldest.Add(models.CoordsMaxAge)
	t.CoordsExpireAt = &e
}

func staleGoogle(p *models.Place, now time.Time) bool {
	return hasGoogleCoords(p) && now.Sub(*p.CoordsFetchedAt) > models.CoordsMaxAge
}

// purged returns a copy of p without lat, lng and coords_fetched_at (place_id and tz stay).
func purged(p *models.Place) *models.Place {
	c := *p
	c.Lat, c.Lng, c.CoordsFetchedAt = nil, nil, nil
	return &c
}

// PurgeStaleCoords nulls Google coordinates older than 30 days (Google Maps Platform terms).
// Touched todos and bookings get v = newV, updated_by = models.SystemActor and updated_at,
// the trip's fields get v = newV when destination or stops changed, and t.Version/UpdatedAt
// move so clients receive a delta. It reports whether t must be written. Idempotent: a second
// call finds nothing stale.
func PurgeStaleCoords(t *models.Trip, now time.Time) bool {
	newV := t.Version + 1
	at := now.UTC()
	touched, tripFieldsTouched := false, false

	if staleGoogle(t.Destination, now) {
		t.Destination = purged(t.Destination)
		touched, tripFieldsTouched = true, true
	}
	var stops []models.Place
	for i := range t.Stops {
		if staleGoogle(&t.Stops[i], now) {
			if stops == nil {
				stops = append([]models.Place(nil), t.Stops...) // never mutate a shared slice
			}
			stops[i] = *purged(&t.Stops[i])
		}
	}
	if stops != nil {
		t.Stops = stops
		touched, tripFieldsTouched = true, true
	}
	for i := range t.Todos {
		if td := &t.Todos[i]; staleGoogle(td.Place, now) {
			td.Place = purged(td.Place)
			td.V, td.UpdatedBy, td.UpdatedAt = newV, models.SystemActor, &at
			touched = true
		}
	}
	for i := range t.Bookings {
		b := &t.Bookings[i]
		hit := false
		if staleGoogle(b.Place, now) {
			b.Place, hit = purged(b.Place), true
		}
		if staleGoogle(b.EndPlace, now) {
			b.EndPlace, hit = purged(b.EndPlace), true
		}
		if hit {
			b.V, b.UpdatedBy, b.UpdatedAt = newV, models.SystemActor, &at
			touched = true
		}
	}

	prev := t.CoordsExpireAt
	RecomputeCoordsExpiry(t)
	if !touched {
		// nothing stale on the trip itself; still write if the stored expiry was wrong
		return (prev == nil) != (t.CoordsExpireAt == nil) || (prev != nil && !prev.Equal(*t.CoordsExpireAt))
	}
	t.Version = newV
	t.UpdatedAt = at
	if tripFieldsTouched {
		t.V = newV
	}
	return true
}
