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

// RunSpan is one run: when it started and ended, how many completions it held, and the gaps
// between them.
type RunSpan struct {
	Start, End time.Time
	Count      int
	Gaps       []time.Duration
}

// RunSpans groups times (ascending) into runs of at least RunMin with no gap above RunGap.
func RunSpans(times []time.Time) []RunSpan {
	var out []RunSpan
	start := 0
	flush := func(end int) { // times[start:end] is one stretch
		if end-start < RunMin {
			return
		}
		s := RunSpan{Start: times[start], End: times[end-1], Count: end - start}
		for i := start + 1; i < end; i++ {
			s.Gaps = append(s.Gaps, times[i].Sub(times[i-1]))
		}
		out = append(out, s)
	}
	for i := 1; i < len(times); i++ {
		if times[i].Sub(times[i-1]) > RunGap {
			flush(i)
			start = i
		}
	}
	if len(times) > 0 {
		flush(len(times))
	}
	return out
}

// Runs returns the first time of each run (see RunSpans): when the person started.
func Runs(times []time.Time) []time.Time {
	spans := RunSpans(times)
	out := make([]time.Time, len(spans))
	for i, s := range spans {
		out[i] = s.Start
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
	return NextWindowAway(r, how, loc, now, nil)
}

// NextWindowAway is NextWindow in home time: the due day is projected past the away spans, and a
// window that would fall while the house is away moves to the first usual hour after it is back.
func NextWindowAway(r Rhythm, how Histogram, loc *time.Location, now time.Time, away Away) (Window, bool) {
	w, ok := nextWindow(r, how, loc, now, away)
	for tries := 0; ok && away.Contains(w.Start) && tries < 3; tries++ {
		back := away.NextHome(w.Start)
		w, ok = nextWindow(r, how, loc, maxTime(now, back), away)
		if ok && w.Start.Before(back) && back.Before(w.End) {
			w.Start = back.UTC() // home part way through the usual hours
		}
	}
	return w, ok
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func nextWindow(r Rhythm, how Histogram, loc *time.Location, now time.Time, away Away) (Window, bool) {
	due, ok := r.DueAway(away)
	if !ok {
		return Window{}, false
	}
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

// Weekly is a thing that follows the calendar: done every one or two weeks on one local weekday
// (bin day), at about one hour.
type Weekly struct {
	EveryWeeks int     `bson:"every_weeks" json:"every_weeks"` // 1 or 2
	Weekday    int     `bson:"weekday" json:"weekday"`         // 0 = Sunday, local
	Hour       int     `bson:"hour" json:"hour"`               // local
	Share      float64 `bson:"share" json:"share"`             // of occurrences on that weekday
}

const (
	weeklyMin   = 4   // occurrences it takes
	weeklyShare = 0.8 // share on one weekday
)

// DetectWeekly finds a calendar pattern: at least 4 occurrences (bursts collapsed), at least 80%
// of them on one local weekday (from HOW), and a median home-time gap within a day of 7 or 14
// days. Hour is the mean local time of day on that weekday, rounded (the minutes come from the
// UTC instant, so a half-hour zone is off by its half hour).
func DetectWeekly(occ []Occurrence, away Away) (Weekly, bool) {
	sorted := append([]Occurrence(nil), occ...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].At.Before(sorted[j].At) })
	var kept []Occurrence
	for _, o := range sorted {
		if o.HOW < 0 || o.HOW >= HoursInWeek {
			continue
		}
		if len(kept) == 0 || o.At.Sub(kept[len(kept)-1].At) >= MinGap {
			kept = append(kept, o)
		}
	}
	if len(kept) < weeklyMin {
		return Weekly{}, false
	}
	var byDay [7]int
	for _, o := range kept {
		byDay[o.HOW/24]++
	}
	day := 0
	for d := 1; d < 7; d++ {
		if byDay[d] > byDay[day] {
			day = d
		}
	}
	share := float64(byDay[day]) / float64(len(kept))
	if share < weeklyShare {
		return Weekly{}, false
	}
	gaps := make([]float64, 0, len(kept)-1)
	for i := 1; i < len(kept); i++ {
		gaps = append(gaps, away.homeDays(kept[i-1].At, kept[i].At))
	}
	med, _ := Median(gaps)
	every := 0
	switch {
	case math.Abs(med-7) <= 1:
		every = 1
	case math.Abs(med-14) <= 1:
		every = 2
	default:
		return Weekly{}, false
	}
	var sum float64
	for _, o := range kept {
		if o.HOW/24 == day {
			sum += float64(o.HOW%24) + float64(o.At.Minute())/60
		}
	}
	hour := int(math.Round(sum/float64(byDay[day]))) % 24
	return Weekly{EveryWeeks: every, Weekday: day, Hour: hour, Share: math.Round(share*100) / 100}, true
}
