package services

import (
	"context"
	"log"
	"math/rand"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

const (
	// todoReminderLead: a timed to-do is announced this long before it starts.
	todoReminderLead = time.Hour
	// bookingReminderLead: a booking is announced this long before it starts.
	bookingReminderLead = 24 * time.Hour
	// tripScanLimit bounds the trips one reminder pass reads.
	tripScanLimit = 5000
)

// UseTrips gives the service the trips it reminds about. Without it there are no trip reminders.
func (s *NotifyService) UseTrips(trips store.TripRepository) { s.trips = trips }

// RemindOnce queues a reminder for every timed to-do starting within the hour and every booking
// starting within a day. Each is keyed by its id and start, so it is sent once however often the
// pass runs (or on how many instances), and again if the start moves. It returns how many it queued.
func (s *NotifyService) RemindOnce(ctx context.Context) (int, error) {
	if s.trips == nil {
		return 0, nil
	}
	now := s.now().UTC()
	trips, err := s.trips.ListCurrent(ctx, now.AddDate(0, 0, -1).Format("2006-01-02"), tripScanLimit)
	if err != nil {
		return 0, err
	}
	queued := 0
	for i := range trips {
		t := &trips[i]
		title := t.Title
		if title == "" {
			title = "Trip"
		}
		job := func(key, body string) *models.PushJob {
			queued++
			return &models.PushJob{
				CoalesceKey: key, Kind: models.PushKindTrip, RoomID: t.RoomID, Recipients: t.Travellers,
				URL: "/app/trips/" + t.TripID, Title: title, Body: body, SendAfter: now,
			}
		}
		for _, td := range t.Todos {
			if td.Done || td.Day == nil || td.StartTime == nil {
				continue
			}
			at, ok := localTime(*td.Day+"T"+*td.StartTime, firstTZ(td.TZ, t.TZ))
			if !ok || !due(now, at, todoReminderLead) {
				continue
			}
			s.enqueue(ctx, job("trip:todo:"+td.TodoID+":"+*td.Day+"T"+*td.StartTime, td.Title+" at "+at.Format("15:04")), true)
		}
		for _, b := range t.Bookings {
			if b.StartsAt == nil {
				continue
			}
			tz := t.TZ
			if b.StartTZ != nil {
				tz = firstTZ(*b.StartTZ, t.TZ)
			}
			at, ok := localTime(*b.StartsAt, tz)
			if !ok || !due(now, at, bookingReminderLead) {
				continue
			}
			s.enqueue(ctx, job("trip:booking:"+b.BookingID+":"+*b.StartsAt, b.Title+" · "+at.Format("Mon 2 Jan, 15:04")), true)
		}
	}
	return queued, nil
}

// due reports whether a start at `at` is within `lead` from now and has not begun.
func due(now, at time.Time, lead time.Duration) bool {
	return !now.Before(at.Add(-lead)) && now.Before(at)
}

func firstTZ(tzs ...string) string {
	for _, tz := range tzs {
		if tz != "" {
			return tz
		}
	}
	return "UTC"
}

// localTime reads a trips wall-clock value ("2006-01-02T15:04") in its zone.
func localTime(v, tz string) (time.Time, bool) {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	at, err := time.ParseInLocation("2006-01-02T15:04", v, loc)
	return at, err == nil
}

// RunTripReminders queues reminders on a jittered timer until ctx ends.
func (s *NotifyService) RunTripReminders(ctx context.Context, every time.Duration) {
	for {
		if _, err := s.RemindOnce(ctx); err != nil && ctx.Err() == nil {
			log.Printf("push: trip reminders: %v", err)
		}
		wait := every + time.Duration(rand.Int63n(int64(every/10)+1))
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}
