package predict

import (
	"math"
	"sort"
	"time"
)

const (
	// HalfLife is how fast old habits fade from the hour-of-week histograms.
	HalfLife = 28 * 24 * time.Hour
	// RunGap is the longest pause inside one trip to the shops (or one packing session).
	RunGap = 45 * time.Minute
	// RunMin is how many completions in a row make a run.
	RunMin = 3
	// HoursInWeek is the histogram length: dow*24 + hour, Sunday first.
	HoursInWeek = 168
)

// Occurrence is one thing that happened, bucketed in the actor's local time.
type Occurrence struct {
	At  time.Time
	HOW int // hour of week, 0-167
}

// Histogram is a decayed hour-of-week count: recent weeks weigh more than old ones.
type Histogram [HoursInWeek]float64

// HOWHistogram builds the decayed histogram as of now.
func HOWHistogram(occ []Occurrence, now time.Time) Histogram {
	var h Histogram
	for _, o := range occ {
		if o.HOW < 0 || o.HOW >= HoursInWeek || o.At.After(now) {
			continue
		}
		age := now.Sub(o.At)
		h[o.HOW] += math.Pow(0.5, float64(age)/float64(HalfLife))
	}
	return h
}

// Runs groups times (ascending) into runs of at least RunMin with no gap above RunGap,
// and returns the first time of each run: when the person started.
func Runs(times []time.Time) []time.Time {
	var out []time.Time
	start, count := 0, 0
	flush := func(end int) {
		if count >= RunMin {
			out = append(out, times[start])
		}
		_ = end
	}
	for i, t := range times {
		if i == 0 || t.Sub(times[i-1]) > RunGap {
			if i > 0 {
				flush(i)
			}
			start, count = i, 0
		}
		count++
	}
	if len(times) > 0 {
		flush(len(times))
	}
	return out
}

// Peak returns the heaviest hour of week, or false for an empty histogram.
func (h Histogram) Peak() (int, bool) {
	best, at := 0.0, -1
	for i, v := range h {
		if v > best {
			best, at = v, i
		}
	}
	return at, at >= 0
}

// peakOnDay returns the heaviest hour (0-23) on one weekday, or false when that day has no mass.
func (h Histogram) peakOnDay(dow int) (int, bool) {
	best, at := 0.0, -1
	for hr := 0; hr < 24; hr++ {
		if v := h[dow*24+hr]; v > best {
			best, at = v, hr
		}
	}
	return at, at >= 0
}

// Window is when something is expected, with how much to trust it.
type Window struct {
	Start, End time.Time
	Confidence float64
}

// Confidence trusts a rhythm more with more occurrences and steadier gaps; 0 below MinOccurrences.
func Confidence(n int, cv float64) float64 {
	if n < MinOccurrences {
		return 0
	}
	regular := 1 - math.Min(cv, 1)
	return math.Round(regular*math.Min(float64(n)/6, 1)*100) / 100
}

// NextWindow predicts the next occurrence of a rhythm: the day from the last occurrence plus
// the smoothed gap, the hours from this person's own habit on that weekday. A rhythm that is
// overdue is expected "today, at the usual hour" (tomorrow if that hour has passed).
func NextWindow(r Rhythm, how Histogram, loc *time.Location, now time.Time) (Window, bool) {
	if _, ok := r.Due(); !ok {
		return Window{}, false
	}
	due, _ := r.Due()
	day := due.In(loc)
	today := now.In(loc)
	dayStart := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, loc)
	todayStart := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, loc)
	if dayStart.Before(todayStart) {
		dayStart = todayStart
	}
	for attempt := 0; attempt < 2; attempt++ {
		hr, ok := how.peakOnDay(int(dayStart.Weekday()))
		if !ok {
			g, any := how.Peak()
			if !any {
				return Window{}, false
			}
			hr = g % 24
		}
		start := dayStart.Add(time.Duration(maxInt(hr-1, 0)) * time.Hour)
		end := dayStart.Add(time.Duration(minInt(hr+2, 24)) * time.Hour)
		if end.After(now) || attempt == 1 || !dayStart.Equal(todayStart) {
			return Window{Start: start.UTC(), End: end.UTC(), Confidence: Confidence(r.N, r.CV)}, true
		}
		dayStart = dayStart.AddDate(0, 0, 1) // today's usual hour has gone by
	}
	return Window{}, false
}

// Median returns the middle value of xs (the mean of the two middle ones when even).
func Median(xs []float64) (float64, bool) {
	if len(xs) == 0 {
		return 0, false
	}
	s := append([]float64(nil), xs...)
	sort.Float64s(s)
	m := len(s) / 2
	if len(s)%2 == 1 {
		return s[m], true
	}
	return (s[m-1] + s[m]) / 2, true
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
