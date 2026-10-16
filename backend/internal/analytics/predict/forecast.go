package predict

import (
	"math"
	"time"
)

// Which history a forecast was learned from.
const (
	SeriesAdded   = "added"   // the times the thing was asked for: what a suggestion replaces
	SeriesChecked = "checked" // completions, a proxy when adds are thin (a re-add follows a check)
)

const (
	// WilsonZ is the z of the Wilson lower bound used as the score (80% one-sided).
	WilsonZ = 1.28
	// MinSeries is how many collapsed adds it takes before adds are preferred over checks.
	MinSeries = 4
)

// Params are the tunable knobs of a forecast. suggest-eval sweeps them against real history.
type Params struct {
	LeadFrac, GraceFrac float64       // window around the due time, as a fraction of the rhythm
	MinLead, MaxLead    time.Duration // clamps on the lead
	MinGrace, MaxGrace  time.Duration // clamps on the grace
	// JitterK widens the window by this many standard deviations of the house's own gaps, so a
	// "Saturday or Sunday" habit (gaps of 6 and 8 days) still lands inside it. MaxJitterGrace
	// caps how late that widening may reach; the lead stays capped by MaxLead.
	JitterK        float64
	MaxJitterGrace time.Duration
	MinScore       float64 // a forecast below this is never shown
	MaxCV          float64 // a rhythm more irregular than this is never shown
}

// DefaultParams appear a little before the habit would happen and step aside soon after.
var DefaultParams = Params{
	LeadFrac: 0.2, GraceFrac: 0.1,
	MinLead: 12 * time.Hour, MaxLead: 48 * time.Hour,
	MinGrace: 6 * time.Hour, MaxGrace: 24 * time.Hour,
	JitterK: 2, MaxJitterGrace: 36 * time.Hour,
	MinScore: 0.65, MaxCV: 0.5,
}

// Forecast is when something is next expected and how far its track record can be trusted.
type Forecast struct {
	Series   string
	N        int
	EWMADays float64
	CV       float64
	LastAt   time.Time // latest counted occurrence: the start of the current cycle
	DueAt    time.Time
	OpensAt  time.Time
	ClosesAt time.Time
	Trials   int
	Hits     int
	Score    float64
}

// Confident is the bar for showing a forecast to anyone.
func (f Forecast) Confident(p Params) bool {
	return f.Trials > 0 && f.Score >= p.MinScore && f.CV <= p.MaxCV
}

// OpenAt reports whether now falls inside the suggestion window.
func (f Forecast) OpenAt(now time.Time) bool {
	return !now.Before(f.OpensAt) && !now.After(f.ClosesAt)
}

func clampDur(d, lo, hi time.Duration) time.Duration {
	return max(lo, min(hi, d))
}

func fracOfDays(days, frac float64) time.Duration {
	return time.Duration(days * frac * 24 * float64(time.Hour))
}

// Window is when a suggestion for something due at `due` is shown. It is a fixed share of the
// rhythm (ewmaDays), widened to cover the rhythm's own wobble (cv is the gaps' spread over their
// mean): a steady habit keeps a tight window, a looser one gets room on both sides. It never
// shrinks below the fixed share.
func (p Params) Window(due time.Time, ewmaDays, cv float64) (opens, closes time.Time) {
	lead := clampDur(fracOfDays(ewmaDays, p.LeadFrac), p.MinLead, p.MaxLead)
	grace := clampDur(fracOfDays(ewmaDays, p.GraceFrac), p.MinGrace, p.MaxGrace)
	if wobble := fracOfDays(ewmaDays, cv*p.JitterK); wobble > 0 {
		lead = max(lead, min(wobble, p.MaxLead))
		grace = max(grace, min(wobble, p.MaxJitterGrace))
	}
	return due.Add(-lead), due.Add(grace)
}

// Backtest replays history (ascending): for every occurrence after the first MinOccurrences,
// predict it from the ones before and count a hit when it landed inside the window, so the
// suggestion would have been on screen right when it was needed. An ignore inside a cycle
// makes that cycle a miss: the house told us the suggestion was wrong.
func (p Params) Backtest(times, ignores []time.Time) (trials, hits int) {
	kept := Collapse(times)
	for i := MinOccurrences; i < len(kept); i++ {
		r := Intervals(kept[:i])
		due, ok := r.Due()
		if !ok {
			continue
		}
		trials++
		opens, closes := p.Window(due, r.EWMADays, r.CV)
		actual := kept[i]
		if actual.Before(opens) || actual.After(closes) || ignoredBetween(ignores, kept[i-1], actual) {
			continue
		}
		hits++
	}
	return trials, hits
}

func ignoredBetween(ignores []time.Time, after, upTo time.Time) bool {
	for _, t := range ignores {
		if t.After(after) && !t.After(upTo) {
			return true
		}
	}
	return false
}

// Wilson is the lower bound of the Wilson score interval for hits/trials. It is low for
// thin evidence (1/1 is 0.38) and approaches the hit rate as trials grow.
func Wilson(hits, trials int, z float64) float64 {
	if trials <= 0 {
		return 0
	}
	n := float64(trials)
	ph := float64(hits) / n
	z2 := z * z
	lb := (ph + z2/(2*n) - z*math.Sqrt(ph*(1-ph)/n+z2/(4*n*n))) / (1 + z2/n)
	return max(0, lb)
}

// Predict forecasts the next add from adds when there are enough of them, and from checks
// otherwise. ok is false when neither history is long enough to give a due time.
func (p Params) Predict(added, checked, ignores []time.Time) (Forecast, bool) {
	series, times := SeriesAdded, added
	if adds := Collapse(added); len(adds) < MinSeries && len(Collapse(checked)) > len(adds) {
		series, times = SeriesChecked, checked
	}
	r := Intervals(times)
	due, ok := r.Due()
	if !ok {
		return Forecast{}, false
	}
	f := Forecast{Series: series, N: r.N, EWMADays: r.EWMADays, CV: r.CV, LastAt: r.Last, DueAt: due}
	f.OpensAt, f.ClosesAt = p.Window(due, r.EWMADays, r.CV)
	f.Trials, f.Hits = p.Backtest(times, ignores)
	f.Score = Wilson(f.Hits, f.Trials, WilsonZ)
	return f, true
}
