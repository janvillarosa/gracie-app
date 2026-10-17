package main

import (
	"fmt"
	"math/rand"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
)

// synthHouse is one made-up household: who lives there and the trips they took.
type synthHouse struct {
	room    string
	members []string
	trips   []models.Trip
}

// synthetic builds a deterministic year of made-up households, for when there is no dev database
// to replay (-synthetic). Each house has 6-14 recurring items and 0-3 whole-house holidays plus some
// solo trips. Two kinds of items: most are used up at home, so their next buy comes a rhythm of
// *home* time after the last one (the house does not eat while away); the rest follow the wall
// calendar (a weekly delivery, bin bags), so a holiday just skips their buys. The eval is honest
// only if both kinds are there: home time must help the first without hurting the second.
func synthetic(seed int64) ([]analytics.Event, []synthHouse) {
	rng := rand.New(rand.NewSource(seed))
	end := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	start := end.AddDate(-1, 0, 0)
	var evs []analytics.Event
	var houses []synthHouse
	for h := 0; h < 24; h++ {
		room := fmt.Sprintf("room_syn%02d", h)
		hs := synthHouse{room: room, members: []string{room + "_a"}}
		if rng.Float64() < 0.75 {
			hs.members = append(hs.members, room+"_b")
		}
		for k := rng.Intn(4); k > 0; k-- { // whole-house holidays
			s := start.AddDate(0, 0, 20+rng.Intn(320))
			hs.trips = append(hs.trips, synthTrip(s, 4+rng.Intn(14)))
		}
		if len(hs.members) > 1 {
			for k := rng.Intn(3); k > 0; k-- { // one member goes alone: the house is still home
				s := start.AddDate(0, 0, 20+rng.Intn(320))
				hs.trips = append(hs.trips, synthTrip(s, 3+rng.Intn(6), hs.members[rng.Intn(len(hs.members))]))
			}
		}
		houses = append(houses, hs)
		away := trips.HouseAway(hs.trips, hs.members, "UTC")

		for i, n := 0, 6+rng.Intn(9); i < n; i++ {
			key := fmt.Sprintf("item%02d", i)
			gap := []float64{3.5, 7, 7, 7, 7, 10, 14, 14, 30}[rng.Intn(9)]
			jitter := []float64{0.05, 0.1, 0.2, 0.35}[rng.Intn(4)]
			skip := []float64{0, 0.05, 0.15}[rng.Intn(3)]
			calendar := rng.Float64() < 0.25
			t := start.Add(time.Duration(rng.Float64()*gap*24) * time.Hour).Add(9 * time.Hour)
			for t.Before(end) {
				if !away.Contains(t) && rng.Float64() >= skip {
					actor := hs.members[rng.Intn(len(hs.members))]
					evs = append(evs, synthEvent("item.added", room, actor, key, t))
					if rng.Float64() < 0.85 {
						evs = append(evs, synthEvent("item.checked", room, actor, key, t.Add(time.Duration(12+rng.Intn(60))*time.Hour)))
					}
				}
				step := time.Duration(gap * (1 + jitter*(rng.Float64()*2-1)) * 24 * float64(time.Hour))
				if calendar {
					t = t.Add(step)
				} else {
					t = predict.Away(away).AddHome(t, step)
				}
			}
		}
	}
	return evs, houses
}

func synthTrip(start time.Time, days int, travellers ...string) models.Trip {
	s, e := start.Format("2006-01-02"), start.AddDate(0, 0, days-1).Format("2006-01-02")
	t := models.Trip{TripID: "trip_" + s}
	t.TZ = "UTC"
	t.StartDate, t.EndDate, t.Travellers = &s, &e, travellers
	return t
}

func synthEvent(name, room, actor, key string, at time.Time) analytics.Event {
	e := analytics.Event{Name: name, Source: analytics.SourceServer, ActorID: actor, RoomID: room, Key: key, OccurredAt: at,
		Subject: analytics.Ref{Type: "item", ID: room + key}, Container: &analytics.Ref{Type: "list", ID: room + "_list"}}
	analytics.Stamp(&e, at, "UTC", 400*24*time.Hour)
	return e
}
