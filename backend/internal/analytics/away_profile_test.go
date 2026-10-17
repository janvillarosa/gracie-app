package analytics_test

import (
	"math"
	"strings"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
)

func TestRunRhythmWithAHolidayKeepsItsInterval(t *testing.T) {
	lastSat := time.Date(2026, 9, 19, 10, 0, 0, 0, ny)
	now := time.Date(2026, 9, 21, 9, 0, 0, 0, ny)
	holidaySat := lastSat.AddDate(0, 0, -21) // the house was away that week and did not shop
	var evs []analytics.Event
	for _, e := range weeklyShopper(8, lastSat) {
		if !strings.Contains(e.EventID, holidaySat.Format("0102")) {
			evs = append(evs, e)
		}
	}
	away := predict.Away{{Opens: holidaySat.AddDate(0, 0, -6), Closes: holidaySat.AddDate(0, 0, 1)}}

	wall := analytics.BuildProfile(fullRegistry(), "h:room_1", evs, now).Containers["list:list_1"]
	home := analytics.BuildProfileAway(fullRegistry(), "h:room_1", evs, now, away).Containers["list:list_1"]
	if home.Runs != 7 || math.Abs(home.IntervalDay-7) > 0.01 || home.CV > 0.01 {
		t.Fatalf("home-time run rhythm: %+v", home)
	}
	if !(wall.IntervalDay > 7.5) {
		t.Fatalf("wall time is stretched by the holiday: %v", wall.IntervalDay)
	}
	if home.NextRun == nil || !home.NextRun.Start.Equal(time.Date(2026, 9, 26, 9, 0, 0, 0, ny).UTC()) {
		t.Fatalf("next run: %+v", home.NextRun)
	}
}
