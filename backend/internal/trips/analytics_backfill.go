package trips

import (
	"context"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

// TripWalker streams every trip of a house ("" = all). store.BackfillReader.EachTrip
// satisfies it; taking a function keeps this package free of I/O.
type TripWalker func(ctx context.Context, roomID string, fn func(models.Trip) error) error

// BackfillActor stands in for a trip event whose actor was not recorded.
const BackfillActor = "system:backfill"

type backfillSource struct{ each TripWalker }

// NewBackfillSource rebuilds the trip events that predate analytics: trip.created,
// trip.deleted and todo.checked. Todo and booking creation, edits and packing-list
// creation carry no timestamps, so they cannot be recovered.
func NewBackfillSource(each TripWalker) analytics.BackfillSource { return backfillSource{each} }

func (backfillSource) Name() string { return "trips" }

func (s backfillSource) Each(ctx context.Context, env analytics.BackfillEnv, emit func(analytics.Event, string) error) error {
	return s.each(ctx, env.RoomID, func(t models.Trip) error {
		// The person's own zone matches how live events are bucketed (their device). The
		// trip's zone is only a fallback for people we have never seen a zone for.
		zoneFor := func(actor string) string {
			if env.TZ != nil {
				if z := env.TZ(ctx, actor, t.RoomID); z != "" {
					return z
				}
			}
			return t.TZ
		}
		for _, ev := range deriveTripEvents(t, zoneFor) {
			if err := emit(ev, zoneFor(ev.ActorID)); err != nil {
				return err
			}
		}
		return nil
	})
}

// deriveTripEvents returns the events a trip implies, shaped like EventsFor's. zoneFor gives
// the zone an actor's local date is read in ("" = UTC); days_to_start depends on it.
func deriveTripEvents(t models.Trip, zoneFor func(actor string) string) []analytics.Event {
	tripRef := analytics.Ref{Type: "trip", ID: t.TripID}
	actorOr := func(actor string) string {
		if actor == "" {
			return BackfillActor
		}
		return actor
	}
	withDays := func(ev analytics.Event) analytics.Event {
		if days, ok := DaysToStart(&t, analytics.LocalAt(ev.OccurredAt, zoneFor(ev.ActorID)).Date); ok {
			ev.Props = map[string]any{"days_to_start": days}
		}
		return ev
	}

	out := []analytics.Event{withDays(analytics.Event{
		Name: "trip.created", ActorID: actorOr(t.CreatedBy), RoomID: t.RoomID,
		Subject: tripRef, OccurredAt: t.CreatedAt,
	})}
	if t.DeletedAt != nil {
		// Like live trip.deleted, no days_to_start: the lead time of a delete means nothing.
		out = append(out, analytics.Event{
			Name: "trip.deleted", ActorID: actorOr(t.DeletedBy), RoomID: t.RoomID,
			Subject: tripRef, OccurredAt: *t.DeletedAt,
		})
	}
	for _, td := range t.Todos {
		if !td.Done || td.DoneAt == nil {
			continue
		}
		out = append(out, withDays(analytics.Event{
			Name: "todo.checked", ActorID: actorOr(td.DoneBy), RoomID: t.RoomID,
			Subject: analytics.Ref{Type: "todo", ID: td.TodoID}, Container: &tripRef,
			Category: td.Category, OccurredAt: *td.DoneAt,
		}))
	}
	return out
}
