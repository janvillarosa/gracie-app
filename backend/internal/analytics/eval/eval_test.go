package eval

import (
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

var day0 = time.Date(2026, 1, 1, 9, 0, 0, 0, time.UTC)

func at(d float64) time.Time { return day0.Add(time.Duration(d * 24 * float64(time.Hour))) }

func every(gap float64, n int) []time.Time {
	out := make([]time.Time, n)
	for i := range out {
		out[i] = at(gap * float64(i))
	}
	return out
}

func TestReplayWeeklyMilkIsAllHitsAndJitterNeverQualifies(t *testing.T) {
	weekly := Series{Room: "r", Key: "milk", Added: every(7, 12)}
	jitter := Series{Room: "r", Key: "bread", Added: []time.Time{at(0), at(2), at(12), at(14), at(26), at(27), at(40), at(41), at(52), at(53)}}
	rep := Replay([]Series{weekly, jitter}, predict.DefaultParams)
	if rep.Series != 2 || rep.Qualifying != 1 {
		t.Fatalf("series %d qualifying %d", rep.Series, rep.Qualifying)
	}
	if rep.Predictions == 0 || rep.Hits != rep.Predictions || rep.Precision() != 1 {
		t.Fatalf("%+v", rep)
	}
}

func TestReplayCountsAHabitChangeAsMisses(t *testing.T) {
	adds := append(every(7, 8), at(52), at(55), at(58), at(61), at(64))
	rep := Replay([]Series{{Room: "r", Key: "milk", Added: adds}}, predict.DefaultParams)
	if rep.TooLate == 0 || rep.Precision() >= 1 {
		t.Fatalf("a changed habit must cost precision: %+v", rep)
	}
}

func TestReplayUsesChecksForAChecksOnlyHouse(t *testing.T) {
	rep := Replay([]Series{{Room: "r", Key: "milk", Checked: every(7, 10)}}, predict.DefaultParams)
	if rep.Qualifying != 1 || rep.Hits == 0 {
		t.Fatalf("%+v", rep)
	}
}

func TestSweepIsMonotonic(t *testing.T) {
	all := []Series{{Room: "r", Key: "milk", Added: every(7, 12)}}
	rows := Sweep(all, predict.DefaultParams, []float64{0.3, 0.65, 0.95})
	if rows[0].Predictions < rows[1].Predictions || rows[1].Predictions < rows[2].Predictions {
		t.Fatalf("a higher bar can only show fewer: %v %v %v", rows[0].Predictions, rows[1].Predictions, rows[2].Predictions)
	}
}

func TestGroupEvents(t *testing.T) {
	mk := func(name string, d float64) analytics.Event {
		return analytics.Event{Name: name, RoomID: "r", Key: "milk", OccurredAt: at(d)}
	}
	got := GroupEvents([]analytics.Event{mk("item.checked", 3), mk("item.added", 2), mk("item.added", 1), mk("item.suggestion_ignored", 5), {Name: "item.added", RoomID: "r"}})
	if len(got) != 1 || len(got[0].Added) != 2 || !got[0].Added[0].Before(got[0].Added[1]) || len(got[0].Checked) != 1 || len(got[0].Ignore) != 1 {
		t.Fatalf("%+v", got)
	}
}

func TestShadowJoinsPredictionsWithWhatHappenedNext(t *testing.T) {
	pred := func(key string, open, closes float64) analytics.Event {
		return analytics.Event{Name: "item.suggestion_predicted", RoomID: "r", Key: key, OccurredAt: at(open),
			Props: map[string]any{"closes_at": at(closes).Format(time.RFC3339)}}
	}
	add := func(key string, d float64, src any) analytics.Event {
		e := analytics.Event{Name: "item.added", RoomID: "r", Key: key, OccurredAt: at(d)}
		if src != nil {
			e.Props = map[string]any{"source": src}
		}
		return e
	}
	evs := []analytics.Event{
		pred("milk", 10, 12), add("milk", 11, "suggestion"), // hit, accepted
		pred("eggs", 10, 12), add("eggs", 15, nil), // came after the window closed
		pred("rice", 10, 12), // nothing yet, window closed: premature
		pred("jam", 10, 20),  // window still open
		{Name: "item.suggestion_ignored", RoomID: "r", Key: "jam", OccurredAt: at(10.5)},
	}
	rep := Shadow(evs, at(13))
	if rep.Predictions != 4 || rep.Hits != 1 || rep.Accepted != 1 || rep.TooEarly != 2 || rep.Ignored != 1 || rep.Pending != 1 {
		t.Fatalf("%+v", rep)
	}
	if rep.Precision() != 1.0/3 {
		t.Fatalf("precision %v", rep.Precision())
	}
}

func TestBackfillIsDeterministicAndSkipsWhatExists(t *testing.T) {
	done := at(3)
	items := []models.ListItem{
		{ItemID: "a", RoomID: "r", ListID: "l", Description: "Whole MILK", CreatedBy: "u1", CreatedAt: at(1), Completed: true, CompletedAt: &done, CompletedBy: "u2"},
		{ItemID: "b", RoomID: "r", ListID: "l", Description: "eggs", CreatedAt: at(2)},
		{ItemID: "c", RoomID: "r", ListID: "l", Description: "tracked", CreatedAt: at(2)},
		{ItemID: "d", RoomID: "r", ListID: "l", Description: "ancient", CreatedAt: at(-900)},
	}
	have := map[string]bool{"c|item.added": true}
	now := at(10)
	first := BackfillEvents(items, have, now, 400*24*time.Hour)
	second := BackfillEvents(items, have, now.Add(time.Hour), 400*24*time.Hour)
	if len(first) != 3 || len(second) != 3 {
		t.Fatalf("want milk added+checked and eggs added; got %d", len(first))
	}
	for i := range first {
		if first[i].EventID != second[i].EventID {
			t.Fatal("ids must be stable so a re-run inserts nothing")
		}
	}
	if first[0].Key != "whole milk" || first[1].ActorID != "u2" || first[0].Source != "backfill" {
		t.Fatalf("%+v", first)
	}
}

func TestReplayAwayDoesNotPunishAHoliday(t *testing.T) {
	// weekly, then a 10 day whole-house holiday, then weekly again one home week after the last buy
	adds := every(7, 6)
	for i := 0; i < 6; i++ {
		adds = append(adds, at(52+7*float64(i)))
	}
	s := []Series{{Room: "r", Key: "milk", Added: adds}}
	away := map[string]predict.Away{"r": {{Opens: at(36), Closes: at(46)}}}
	wall := Replay(s, predict.DefaultParams)
	home := ReplayAway(s, predict.DefaultParams, away)
	if home.Precision() < wall.Precision() || home.Hits != home.Predictions {
		t.Fatalf("home %+v wall %+v", home, wall)
	}
	if other := ReplayAway(s, predict.DefaultParams, map[string]predict.Away{"x": away["r"]}); other.Hits != wall.Hits || other.Predictions != wall.Predictions {
		t.Fatal("another house's trips change nothing")
	}
}
