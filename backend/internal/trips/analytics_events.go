package trips

import (
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

var fieldsSpec = map[string]analytics.PropSpec{"fields": {Kind: analytics.PropString, MaxLen: 128}}

// daysToStart is the key lead-time feature: how far ahead of the trip this happened.
var daysSpec = analytics.PropSpec{Kind: analytics.PropInt}

// RegisterAnalyticsEvents declares trip events.
// Mapping: trip is its own subject; todo and booking sit in the trip as container.
func RegisterAnalyticsEvents(reg *analytics.Registry) {
	reg.MustRegister(
		analytics.EventDef{Name: "trip.created", Props: map[string]analytics.PropSpec{"days_to_start": daysSpec}},
		analytics.EventDef{Name: "trip.updated", Props: map[string]analytics.PropSpec{"fields": fieldsSpec["fields"], "days_to_start": daysSpec}},
		analytics.EventDef{Name: "trip.view", Client: true, Props: map[string]analytics.PropSpec{"tab": {Kind: analytics.PropString, MaxLen: 16}}},
		analytics.EventDef{Name: "trip.deleted"},
		analytics.EventDef{Name: "trip.restored"},
		analytics.EventDef{Name: "trip.packing_list_created", Props: map[string]analytics.PropSpec{"days_to_start": daysSpec}},
		// The house's away calendar moved (dates, zone or who is going changed, or a dated trip was
		// created, deleted or restored): analytics re-learns the house's forecasts in home time.
		analytics.EventDef{Name: "trip.away_changed", RequeueRoom: true},

		analytics.EventDef{Name: "todo.created", Props: map[string]analytics.PropSpec{"days_to_start": daysSpec}},
		analytics.EventDef{Name: "todo.checked", Role: analytics.RoleComplete, Props: map[string]analytics.PropSpec{"days_to_start": daysSpec}},
		analytics.EventDef{Name: "todo.unchecked", Props: map[string]analytics.PropSpec{"days_to_start": daysSpec}},
		analytics.EventDef{Name: "todo.scheduled", Props: map[string]analytics.PropSpec{"days_to_start": daysSpec}},
		analytics.EventDef{Name: "todo.unscheduled", Props: map[string]analytics.PropSpec{"days_to_start": daysSpec}},
		analytics.EventDef{Name: "todo.edited", Props: map[string]analytics.PropSpec{"fields": fieldsSpec["fields"], "days_to_start": daysSpec}},
		analytics.EventDef{Name: "todo.deleted", Props: map[string]analytics.PropSpec{"days_to_start": daysSpec}},

		analytics.EventDef{Name: "booking.created", Props: map[string]analytics.PropSpec{"kind": {Kind: analytics.PropString, MaxLen: 16}, "days_to_start": daysSpec}},
		analytics.EventDef{Name: "booking.updated", Props: map[string]analytics.PropSpec{"fields": fieldsSpec["fields"], "days_to_start": daysSpec}},
		analytics.EventDef{Name: "booking.deleted", Props: map[string]analytics.PropSpec{"days_to_start": daysSpec}},
	)
}

// maxBackdate bounds how far back a client op's own clock may place an event, so an
// offline batch keeps its true time without a skewed clock rewriting history.
const maxBackdate = 7 * 24 * time.Hour

// DaysToStart returns whole days from localDate (the actor's local date, 2006-01-02)
// to the trip's start date; ok is false when the trip has no start date.
func DaysToStart(t *models.Trip, localDate string) (int64, bool) {
	if t.StartDate == nil {
		return 0, false
	}
	start, err1 := time.Parse("2006-01-02", *t.StartDate)
	today, err2 := time.Parse("2006-01-02", localDate)
	if err1 != nil || err2 != nil {
		return 0, false
	}
	return int64(start.Sub(today).Hours() / 24), true
}

// EventsFor derives the behavior events for one op that took effect. t is the trip after
// the op was applied. It is pure: no I/O, and nothing from user-typed text is copied
// (titles, notes, places, confirmation codes never leave the trip document).
func EventsFor(t *models.Trip, op models.Op, res models.OpResult, actor string, now time.Time, tz string) []analytics.Event {
	if res.Status != models.OpApplied && res.Status != models.OpConflicted {
		return nil
	}
	keys := patchKeys(op.Patch, res.SkippedFields)
	if res.Status == models.OpConflicted && len(keys) == 0 {
		return nil
	}
	tripRef := analytics.Ref{Type: "trip", ID: t.TripID}
	base := analytics.Event{
		Source: analytics.SourceServer, ActorID: actor, RoomID: t.RoomID,
		ClientID: op.ClientID, OccurredAt: opTime(op, now),
	}
	days, hasDays := DaysToStart(t, analytics.LocalAt(base.OccurredAt, tz).Date)
	mk := func(name string, subject analytics.Ref, container *analytics.Ref, props map[string]any) analytics.Event {
		ev := base
		ev.Name, ev.Subject, ev.Container = name, subject, container
		if hasDays && name != "trip.deleted" && name != "trip.restored" && name != "trip.away_changed" {
			if props == nil {
				props = map[string]any{}
			}
			props["days_to_start"] = days
		}
		ev.Props = props
		return ev
	}
	todo := func(name string, props map[string]any) analytics.Event {
		ev := mk(name, analytics.Ref{Type: "todo", ID: op.EntityID}, &tripRef, props)
		if td := todoByID(t, op.EntityID); td != nil {
			ev.Category = td.Category
		}
		return ev
	}
	fields := func(skip ...string) map[string]any {
		var out []string
		drop := map[string]bool{}
		for _, s := range skip {
			drop[s] = true
		}
		for _, k := range keys {
			if !drop[k] {
				out = append(out, k)
			}
		}
		if len(out) == 0 {
			return nil
		}
		return map[string]any{"fields": strings.Join(out, ",")}
	}
	has := func(k string) bool {
		for _, x := range keys {
			if x == k {
				return true
			}
		}
		return false
	}

	dated := t.StartDate != nil && t.EndDate != nil
	// withAway appends trip.away_changed when the op moved who is away when.
	withAway := func(ev analytics.Event, moved bool) []analytics.Event {
		if !moved {
			return []analytics.Event{ev}
		}
		return []analytics.Event{ev, mk("trip.away_changed", tripRef, nil, nil)}
	}

	switch op.Type {
	case TypeTripCreate:
		return withAway(mk("trip.created", tripRef, nil, nil), dated)
	case TypeTripUpdate:
		moved := has("start_date") || has("end_date") || has("travellers") || has("tz")
		return withAway(mk("trip.updated", tripRef, nil, fields()), moved)
	case TypeTripDelete:
		return withAway(mk("trip.deleted", tripRef, nil, nil), dated)
	case TypeTripRestore:
		return withAway(mk("trip.restored", tripRef, nil, nil), dated)
	case TypeTodoCreate:
		return []analytics.Event{todo("todo.created", nil)}
	case TypeTodoDelete:
		return []analytics.Event{todo("todo.deleted", nil)}
	case TypeTodoUpdate:
		var out []analytics.Event
		if has("done") {
			if td := todoByID(t, op.EntityID); td != nil && td.Done {
				out = append(out, todo("todo.checked", nil))
			} else {
				out = append(out, todo("todo.unchecked", nil))
			}
		}
		if has("day") {
			if td := todoByID(t, op.EntityID); td != nil && td.Day != nil {
				out = append(out, todo("todo.scheduled", nil))
			} else {
				out = append(out, todo("todo.unscheduled", nil))
			}
		}
		if f := fields("done", "day"); f != nil {
			out = append(out, todo("todo.edited", f))
		}
		return out
	case TypeBookingCreate:
		props := map[string]any{}
		if b := bookingByID(t, op.EntityID); b != nil {
			props["kind"] = b.Kind
		}
		return []analytics.Event{mk("booking.created", analytics.Ref{Type: "booking", ID: op.EntityID}, &tripRef, props)}
	case TypeBookingUpdate:
		return []analytics.Event{mk("booking.updated", analytics.Ref{Type: "booking", ID: op.EntityID}, &tripRef, fields())}
	case TypeBookingDelete:
		return []analytics.Event{mk("booking.deleted", analytics.Ref{Type: "booking", ID: op.EntityID}, &tripRef, nil)}
	}
	return nil
}

// opTime uses the client's own clock for when the action happened, clamped to
// [now-7d, now], so offline edits land on the day they were made.
func opTime(op models.Op, now time.Time) time.Time {
	if op.At <= 0 {
		return now
	}
	t := time.UnixMilli(op.At).UTC()
	if t.After(now) {
		return now
	}
	if t.Before(now.Add(-maxBackdate)) {
		return now.Add(-maxBackdate)
	}
	return t
}

// patchKeys lists the top-level patch fields that actually took effect, sorted.
func patchKeys(patch json.RawMessage, skipped []string) []string {
	if len(patch) == 0 {
		return nil
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(patch, &m) != nil {
		return nil
	}
	drop := map[string]bool{}
	for _, s := range skipped {
		drop[s] = true
	}
	out := make([]string, 0, len(m))
	for k := range m {
		if !drop[k] {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

func todoByID(t *models.Trip, id string) *models.TripTodo {
	for i := range t.Todos {
		if t.Todos[i].TodoID == id {
			return &t.Todos[i]
		}
	}
	return nil
}

func bookingByID(t *models.Trip, id string) *models.Booking {
	for i := range t.Bookings {
		if t.Bookings[i].BookingID == id {
			return &t.Bookings[i]
		}
	}
	return nil
}
