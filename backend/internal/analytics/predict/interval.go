// Package predict holds the pure prediction math: no I/O, no clocks, easy to tune and test.
package predict

import (
	"math"
	"time"
)

const (
	// Alpha weights the newest gap in the smoothed interval; recent habits win but one odd week does not.
	Alpha = 0.3
	// MinGap collapses a burst (check, uncheck, check again) into one occurrence.
	MinGap = 6 * time.Hour
	// MinOccurrences is how many occurrences it takes before a due date is offered.
	MinOccurrences = 3
)

// Rhythm describes how regularly something happens.
type Rhythm struct {
	N        int       // occurrences counted after collapsing bursts
	EWMADays float64   // smoothed gap between occurrences, in days
	CV       float64   // standard deviation of the gaps over their mean; low means regular
	Last     time.Time // latest counted occurrence
}

// Intervals computes a Rhythm from occurrence times in ascending order.
func Intervals(times []time.Time) Rhythm { return IntervalsAway(times, nil) }

// IntervalsAway is Intervals with the gaps measured in home time: a gap that spans a holiday
// counts only the days the house was home.
func IntervalsAway(times []time.Time, away Away) Rhythm {
	kept := Collapse(times)
	r := Rhythm{N: len(kept)}
	if len(kept) == 0 {
		return r
	}
	r.Last = kept[len(kept)-1]
	if len(kept) < 2 {
		return r
	}
	gaps := make([]float64, 0, len(kept)-1)
	for i := 1; i < len(kept); i++ {
		gaps = append(gaps, away.homeDays(kept[i-1], kept[i]))
	}
	ewma, sum := gaps[0], 0.0
	for i, g := range gaps {
		if i > 0 {
			ewma = Alpha*g + (1-Alpha)*ewma
		}
		sum += g
	}
	mean := sum / float64(len(gaps))
	var sq float64
	for _, g := range gaps {
		sq += (g - mean) * (g - mean)
	}
	r.EWMADays = ewma
	if mean > 0 {
		r.CV = math.Sqrt(sq/float64(len(gaps))) / mean
	}
	return r
}

// Collapse drops occurrences closer than MinGap to the previous kept one (times ascending).
func Collapse(times []time.Time) []time.Time {
	var kept []time.Time
	for _, t := range times {
		if len(kept) == 0 || t.Sub(kept[len(kept)-1]) >= MinGap {
			kept = append(kept, t)
		}
	}
	return kept
}

// Due returns when the next occurrence is expected, or false when there is too little history.
func (r Rhythm) Due() (time.Time, bool) { return r.DueAway(nil) }

// DueAway projects the due time in home time: the smoothed gap counts only days at home, so a
// trip in the way pushes it back by the trip's length.
func (r Rhythm) DueAway(away Away) (time.Time, bool) {
	if r.N < MinOccurrences || r.EWMADays <= 0 {
		return time.Time{}, false
	}
	return away.addDays(r.Last, r.EWMADays), true
}
