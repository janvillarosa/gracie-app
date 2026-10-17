package predict

import (
	"math"
	"testing"
	"time"
)

// weeklyWithHoliday is 12 weekly adds with a 10-day whole-house trip in the middle: nothing was
// bought while away, and buying resumed a week of home time after the last buy.
func weeklyWithHoliday() ([]time.Time, Away) {
	var ts []time.Time
	for i := 0; i < 6; i++ {
		ts = append(ts, at(7*float64(i)))
	}
	trip := Away{{Opens: at(36), Closes: at(46)}}
	// last buy at 35, one home day, 10 days away, then 6 more home days: the next buy is at 52.
	for i := 0; i < 6; i++ {
		ts = append(ts, at(52+7*float64(i)))
	}
	return ts, trip
}

func TestHolidayDoesNotStretchRhythm(t *testing.T) {
	ts, trip := weeklyWithHoliday()
	wall, _ := DefaultParams.Predict(ts, nil, nil)
	home, ok := DefaultParams.PredictAway(ts, nil, nil, trip)
	if !ok {
		t.Fatal("no forecast")
	}
	if home.EWMADays != 7 {
		t.Fatalf("home-time median gap = %v, want 7", home.EWMADays)
	}
	if home.CV > 1e-9 {
		t.Fatalf("the holiday gap is a clean 7 home days: cv %v", home.CV)
	}
	if !(wall.CV > home.CV) {
		t.Fatalf("wall time sees the holiday as an irregular gap (cv %v vs %v)", wall.CV, home.CV)
	}
	if home.Score < wall.Score {
		t.Fatalf("home time must not score worse: %v < %v", home.Score, wall.Score)
	}
	r := IntervalsAway(ts, trip)
	plain := Intervals(ts)
	if math.Abs(r.EWMADays-7) > 1e-9 || !(plain.EWMADays > r.EWMADays) {
		t.Fatalf("smoothed rhythm: home %v wall %v", r.EWMADays, plain.EWMADays)
	}
}

func TestDueShiftsPastTrip(t *testing.T) {
	ts := every(7, 6) // last buy at day 35, due at 42
	trip := Away{{Opens: at(38), Closes: at(43)}}
	f, ok := DefaultParams.PredictAway(ts, nil, nil, trip)
	if !ok {
		t.Fatal("no forecast")
	}
	// 7 home days from 35 with 5 days away in between: due at 47.
	if !f.DueAt.Equal(at(47)) {
		t.Fatalf("due %v, want %v", f.DueAt, at(47))
	}
	// No window is open while the house is away, so coming back is not a burst of overdue items.
	for _, w := range f.Windows {
		if trip.Contains(w.Opens) {
			t.Fatalf("window opens while away: %v", w)
		}
	}
	if f.OpenAt(at(40)) {
		t.Fatal("nothing is suggested mid-trip")
	}
	// A trip that ends right when the item was due: the window opens on the way home, not before.
	long := Away{{Opens: at(36), Closes: at(44)}}
	g, _ := DefaultParams.PredictAway(ts, nil, nil, long)
	if g.OpensAt.Before(at(44)) || !g.DueAt.Equal(at(50)) {
		t.Fatalf("opens %v due %v", g.OpensAt, g.DueAt)
	}
	// A rhythm due before a later trip is untouched by it.
	h, _ := DefaultParams.PredictAway(every(7, 6), nil, nil, Away{{Opens: at(60), Closes: at(70)}})
	plain, _ := DefaultParams.Predict(every(7, 6), nil, nil)
	if !h.DueAt.Equal(plain.DueAt) || !h.OpensAt.Equal(plain.OpensAt) {
		t.Fatalf("a later trip moved the due date: %v vs %v", h.DueAt, plain.DueAt)
	}
}

func TestBacktestSkipsACycleBoughtWhileAway(t *testing.T) {
	ts := every(7, 8)
	all, _ := DefaultParams.Backtest(ts, nil)
	// one of the later buys happened during a (solo-looking) house-away span: no trial for it
	trip := Away{{Opens: at(41.5), Closes: at(42.5)}}
	trials, hits := DefaultParams.BacktestAway(ts, nil, trip)
	if trials != all-1 || hits != trials {
		t.Fatalf("trials %d (of %d) hits %d", trials, all, hits)
	}
}

func TestNextWindowAwayWaitsForTheHouseToBeBack(t *testing.T) {
	ts := saturdays(6) // weekly Saturday runs at 10:00 UTC
	var occ []Occurrence
	for _, x := range ts {
		occ = append(occ, Occurrence{At: x, HOW: int(x.Weekday())*24 + x.Hour()})
	}
	now := ts[len(ts)-1].Add(24 * time.Hour)
	h := HOWHistogram(occ, now)
	r := IntervalsAway(ts, nil)
	plain, ok := NextWindow(r, h, time.UTC, now)
	if !ok {
		t.Fatal("no window")
	}
	// Away from the day before the next run until three days after it.
	trip := Away{{Opens: plain.Start.Add(-24 * time.Hour), Closes: plain.Start.Add(72 * time.Hour)}}
	w, ok := NextWindowAway(r, h, time.UTC, now, trip)
	if !ok || trip.Contains(w.Start) || !w.Start.After(plain.Start) {
		t.Fatalf("window %v during or before the trip %v", w, trip)
	}
	// A week of home time: due four days after the usual Saturday, at the habit's usual hour.
	if !w.Start.After(trip[0].Closes) || w.Start.Hour() != 9 {
		t.Fatalf("window %v should be after the trip at the usual hour", w.Start)
	}
}
