package predict

import (
	"testing"
	"time"
)

// occAt builds occurrences in UTC at day offsets from a Sunday, at an hour and minute.
func occAt(days []float64, hour, minute int) []Occurrence {
	sunday := time.Date(2026, 1, 4, 0, 0, 0, 0, time.UTC)
	var out []Occurrence
	for _, d := range days {
		t := sunday.Add(time.Duration(d*24)*time.Hour + time.Duration(hour)*time.Hour + time.Duration(minute)*time.Minute)
		out = append(out, Occurrence{At: t, HOW: int(t.Weekday())*24 + t.Hour()})
	}
	return out
}

func span(from, n, step float64) []float64 {
	var out []float64
	for i := 0.0; i < n; i++ {
		out = append(out, from+i*step)
	}
	return out
}

func TestDetectWeeklyBinsEveryOtherTuesday(t *testing.T) {
	occ := append(occAt(span(2, 5, 14), 19, 50), occAt(span(72, 5, 14), 20, 10)...) // 10 cycles ~20:00
	w, ok := DetectWeekly(occ, nil)
	if !ok || w.EveryWeeks != 2 || w.Weekday != int(time.Tuesday) || w.Hour != 20 || w.Share != 1 {
		t.Fatalf("got %+v %v", w, ok)
	}
}

func TestDetectWeeklySaturday(t *testing.T) {
	w, ok := DetectWeekly(occAt(span(6, 8, 7), 10, 0), nil)
	if !ok || w.EveryWeeks != 1 || w.Weekday != int(time.Saturday) || w.Hour != 10 {
		t.Fatalf("got %+v %v", w, ok)
	}
}

func TestDetectWeeklyRejects(t *testing.T) {
	if w, ok := DetectWeekly(occAt(span(0, 10, 9), 10, 0), nil); ok {
		t.Fatalf("every 9 days is not the calendar: %+v", w)
	}
	if w, ok := DetectWeekly(occAt(span(6, 3, 7), 10, 0), nil); ok {
		t.Fatalf("3 occurrences is too few: %+v", w)
	}
	// weekly, but on any day of the week
	mixed := occAt([]float64{6, 12, 20, 27, 32, 41, 48, 53}, 10, 0)
	if w, ok := DetectWeekly(mixed, nil); ok {
		t.Fatalf("no weekday holds 80%%: %+v", w)
	}
}

func TestDetectWeeklySurvivesATwoWeekTrip(t *testing.T) {
	// weekly Tuesdays, none during a 2-week trip
	days := append(span(2, 6, 7), span(58, 6, 7)...)
	sunday := time.Date(2026, 1, 4, 0, 0, 0, 0, time.UTC)
	trip := Away{{Opens: sunday.AddDate(0, 0, 40), Closes: sunday.AddDate(0, 0, 54)}}
	w, ok := DetectWeekly(occAt(days, 20, 0), trip)
	if !ok || w.EveryWeeks != 1 || w.Weekday != int(time.Tuesday) {
		t.Fatalf("got %+v %v", w, ok)
	}
}
