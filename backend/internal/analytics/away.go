package analytics

import (
	"context"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
)

// AwayCalendar is the port through which a feature tells analytics when a house, or one person
// in it, is away. Analytics knows no feature: trips implement it (services.AwayCalendar), and
// nothing here imports them. Away time is not time for a rhythm (see predict.Away).
type AwayCalendar interface {
	HouseAway(ctx context.Context, roomID string) (predict.Away, error)
	MemberAway(ctx context.Context, roomID, userID string) (predict.Away, error)
}

// awayCache holds each room's away spans for one fold tick, so a tick asks the calendar once per
// room. A new tick starts empty: a trip moved since is seen on the next tick.
type awayCache map[string]predict.Away

// houseAway returns the room's house-away spans from the cache, asking the calendar on a miss.
func (w *Worker) houseAway(ctx context.Context, cache awayCache, roomID string) (predict.Away, error) {
	if w.away == nil {
		return nil, nil
	}
	if a, ok := cache[roomID]; ok {
		return a, nil
	}
	a, err := w.away.HouseAway(ctx, roomID)
	if err != nil {
		return nil, err
	}
	a = a.Normalize()
	cache[roomID] = a
	return a, nil
}

// WithAway sets the away calendar. nil (the default) means nobody is ever away, which is the
// behavior before away calendars existed.
func (w *Worker) WithAway(c AwayCalendar) *Worker {
	w.away = c
	return w
}
