package predict

import (
	"math"
	"testing"
	"time"
)

func confidentWeekly() Forecast {
	f, _ := DefaultParams.Predict(every(7, 10), nil, nil)
	f.CV = 0.2 // a realistic wobble around the weekly rhythm
	return f
}

func TestNeedByFollowsTheRhythm(t *testing.T) {
	f := confidentWeekly()
	if !f.Confident(DefaultParams) {
		t.Fatal("fixture should be confident")
	}
	if p := NeedBy(f, f.DueAt, nil); math.Abs(p-0.5) > 0.01 {
		t.Fatalf("at the due time: %v", p)
	}
	if p := NeedBy(f, f.LastAt.Add(time.Hour), nil); p > 0.01 {
		t.Fatalf("right after buying it: %v", p)
	}
	if p := NeedBy(f, f.LastAt, nil); p != 0 {
		t.Fatalf("at the last buy: %v", p)
	}
	if p := NeedBy(f, f.DueAt.Add(5*24*time.Hour), nil); p < 0.95 {
		t.Fatalf("far past due: %v", p)
	}
	early, late := NeedBy(f, f.DueAt.Add(-24*time.Hour), nil), NeedBy(f, f.DueAt.Add(24*time.Hour), nil)
	if !(early < 0.5 && late > 0.5) {
		t.Fatalf("monotone around due: %v %v", early, late)
	}
}

func TestNeedByStepWhenPerfectlyRegular(t *testing.T) {
	f := confidentWeekly()
	f.CV = 0
	if NeedBy(f, f.DueAt.Add(-time.Minute), nil) != 0 || NeedBy(f, f.DueAt, nil) != 1 {
		t.Fatal("CV 0 is a step at the due time")
	}
}

func TestDueByThinHistory(t *testing.T) {
	if NeedBy(Forecast{}, at(100), nil) != 0 {
		t.Fatal("no forecast: 0")
	}
	thin, ok := DefaultParams.Predict(every(7, 4), nil, nil)
	if !ok || thin.Confident(DefaultParams) {
		t.Fatalf("fixture should be a forecast that is not confident: %+v", thin)
	}
	if p := NeedBy(thin, thin.DueAt.Add(30*24*time.Hour), nil); p > 0.5 {
		t.Fatalf("thin history can never pass an assist bar: %v", p)
	}
}

func TestNeedByUsesTheForecastsClock(t *testing.T) {
	f := confidentWeekly()
	trip := Away{{Opens: f.LastAt.Add(2 * 24 * time.Hour), Closes: f.LastAt.Add(7 * 24 * time.Hour)}}
	wall := NeedBy(f, f.DueAt, trip) // a wall-clock forecast ignores away spans
	f.Clock = ClockHome
	home := NeedBy(f, f.DueAt, trip) // only 2 home days have passed by the wall due time
	if math.Abs(wall-0.5) > 0.01 || home > 0.01 {
		t.Fatalf("wall %v home %v", wall, home)
	}
}
