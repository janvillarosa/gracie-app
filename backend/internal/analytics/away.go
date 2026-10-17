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

// WithAway sets the away calendar. nil (the default) means nobody is ever away, which is the
// behavior before away calendars existed.
func (w *Worker) WithAway(c AwayCalendar) *Worker {
	w.away = c
	return w
}
