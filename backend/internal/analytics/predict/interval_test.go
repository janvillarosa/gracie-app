package predict

import (
	"math"
	"testing"
	"time"
)

var day0 = time.Date(2026, 1, 1, 9, 0, 0, 0, time.UTC)

func at(days float64) time.Time { return day0.Add(time.Duration(days * 24 * float64(time.Hour))) }

func TestIntervalsRegular(t *testing.T) {
	r := Intervals([]time.Time{at(0), at(7), at(14), at(21)})
	if r.N != 4 || math.Abs(r.EWMADays-7) > 1e-9 || r.CV > 1e-9 || !r.Last.Equal(at(21)) {
		t.Fatalf("got %+v", r)
	}
	due, ok := r.Due()
	if !ok || !due.Equal(at(28)) {
		t.Fatalf("due %v %v", due, ok)
	}
}

func TestIntervalsWeightsRecentGaps(t *testing.T) {
	// Gaps 10,10,10 then 4: the smoothed value moves toward 4 but not all the way.
	r := Intervals([]time.Time{at(0), at(10), at(20), at(30), at(34)})
	want := Alpha*4 + (1-Alpha)*10
	if math.Abs(r.EWMADays-want) > 1e-9 {
		t.Fatalf("ewma %v want %v", r.EWMADays, want)
	}
	if r.CV <= 0 {
		t.Fatal("irregular gaps must have a positive CV")
	}
}

func TestIntervalsCollapsesBursts(t *testing.T) {
	// check / uncheck / check within hours counts once.
	r := Intervals([]time.Time{at(0), at(0.01), at(0.1), at(7), at(7.05), at(14)})
	if r.N != 3 || math.Abs(r.EWMADays-7) > 1e-9 {
		t.Fatalf("got %+v", r)
	}
}

func TestDueNeedsEnoughHistory(t *testing.T) {
	if _, ok := Intervals([]time.Time{at(0), at(7)}).Due(); ok {
		t.Fatal("two occurrences are not enough")
	}
	if _, ok := Intervals(nil).Due(); ok {
		t.Fatal("no history")
	}
	if r := Intervals([]time.Time{at(3)}); r.N != 1 || !r.Last.Equal(at(3)) {
		t.Fatalf("single: %+v", r)
	}
}
