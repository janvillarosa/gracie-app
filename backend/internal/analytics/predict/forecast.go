package predict

import (
	"math"
	"sort"
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
	// Skips is how many missed cycles a forecast rides through: when a window passes without an
	// add, another opens a rhythm later (0: one window only). "Most weeks" habits need it.
	Skips int
	// MedianCadence takes the rhythm from the median of the recent gaps, which a skipped week
	// does not stretch, and measures regularity after folding skipped cycles (a 14 day gap on a
	// 7 day rhythm is two clean cycles). Off: the smoothed average of all gaps.
	MedianCadence bool
	// RecentGaps bounds how many of the latest gaps MedianCadence looks at (0: all), so a habit
	// that changed is learned from how it is now.
	RecentGaps int
	// StrictSkips scores every window that was shown without an add as a miss. Off: one trial
	// per cycle, a hit when the add landed in any of its windows.
	StrictSkips bool
	// RecentCycles scores the track record on only the latest cycles (0: all), so confidence
	// reflects how the house behaves now, not a habit it has since changed.
	RecentCycles int
}

// Span is one suggestion window.
type Span struct {
	Opens, Closes time.Time
}

// DefaultParams were tuned with `suggest-eval tune` on a real household's year of history
// (2026-10-16): weekend shoppers who buy most weeks and sometimes skip two or three, and whose
// habits changed during the year. The rhythm is the median of the latest 12 gaps, windows repeat
// for up to four skipped cycles, and confidence is judged on the latest 8 cycles. The bar itself
// (MinScore, MaxCV) is unchanged.
var DefaultParams = Params{
	LeadFrac: 0.5, GraceFrac: 0.25,
	MinLead: 12 * time.Hour, MaxLead: 72 * time.Hour,
	MinGrace: 6 * time.Hour, MaxGrace: 48 * time.Hour,
	JitterK: 2, MaxJitterGrace: 48 * time.Hour,
	MinScore: 0.65, MaxCV: 0.5,
	MedianCadence: true, RecentGaps: 12, Skips: 4, RecentCycles: 8,
}

// ClassicParams are the first, single-window model (smoothed average, one window, whole
// history). Kept for comparison in suggest-eval and for tests of the window arithmetic.
var ClassicParams = Params{
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
	// Windows are every window this forecast may show, the first one (OpensAt..ClosesAt) and
	// one per tolerated skip after it.
	Windows []Span
	Trials  int
	Hits    int
	Score   float64
}

// Confident is the bar for showing a forecast to anyone.
func (f Forecast) Confident(p Params) bool {
	return f.Trials > 0 && f.Score >= p.MinScore && f.CV <= p.MaxCV
}

// OpenAt reports whether now falls inside one of the suggestion windows.
func (f Forecast) OpenAt(now time.Time) bool {
	if len(f.Windows) == 0 {
		return !now.Before(f.OpensAt) && !now.After(f.ClosesAt)
	}
	for _, w := range f.Windows {
		if !now.Before(w.Opens) && !now.After(w.Closes) {
			return true
		}
	}
	return false
}

// cadence is a rhythm as the forecast uses it.
type cadence struct {
	n        int
	days, cv float64
	last     time.Time
	ok       bool
}

func (p Params) cadence(times []time.Time) cadence {
	if !p.MedianCadence {
		r := Intervals(times)
		_, ok := r.Due()
		return cadence{n: r.N, days: r.EWMADays, cv: r.CV, last: r.Last, ok: ok}
	}
	kept := Collapse(times)
	c := cadence{n: len(kept)}
	if len(kept) == 0 {
		return c
	}
	c.last = kept[len(kept)-1]
	if len(kept) < MinOccurrences {
		return c
	}
	gaps := make([]float64, 0, len(kept)-1)
	for i := 1; i < len(kept); i++ {
		gaps = append(gaps, kept[i].Sub(kept[i-1]).Hours()/24)
	}
	if p.RecentGaps > 0 && len(gaps) > p.RecentGaps {
		gaps = gaps[len(gaps)-p.RecentGaps:]
	}
	med := median(gaps)
	if med <= 0 {
		return c
	}
	// A gap of about m rhythms (up to the tolerated skips) is m cycles of g/m. Longer breaks are
	// kept whole, so they still count as irregular.
	reduced := make([]float64, len(gaps))
	for i, g := range gaps {
		m := math.Round(g / med)
		if m < 1 || m > float64(p.Skips+1) {
			m = 1
		}
		reduced[i] = g / m
	}
	var sum, sq float64
	for _, g := range reduced {
		sum += g
	}
	mean := sum / float64(len(reduced))
	for _, g := range reduced {
		sq += (g - mean) * (g - mean)
	}
	c.days, c.ok = med, true
	if mean > 0 {
		c.cv = math.Sqrt(sq/float64(len(reduced))) / mean
	}
	return c
}

func median(xs []float64) float64 {
	s := append([]float64(nil), xs...)
	sort.Float64s(s)
	if len(s) == 0 {
		return 0
	}
	if len(s)%2 == 1 {
		return s[len(s)/2]
	}
	return (s[len(s)/2-1] + s[len(s)/2]) / 2
}

// windows are the cycle's windows: one at the due time, and one per tolerated skip after it.
func (p Params) windows(c cadence) []Span {
	out := make([]Span, 0, p.Skips+1)
	for m := 1; m <= p.Skips+1; m++ {
		due := c.last.Add(time.Duration(float64(m) * c.days * 24 * float64(time.Hour)))
		opens, closes := p.Window(due, c.days, c.cv)
		out = append(out, Span{opens, closes})
	}
	return out
}

// Judge scores one cycle: the add at `actual` against the cycle's windows. shown is how many
// windows count as shown (StrictSkips: every one that had opened by the add), hit whether the add
// landed in one of them, late whether it came before the first opened.
func (p Params) Judge(ws []Span, actual time.Time) (shown int, hit, late bool) {
	at := -1
	for k, w := range ws {
		if !actual.Before(w.Opens) && !actual.After(w.Closes) {
			at = k
			break
		}
	}
	late = len(ws) > 0 && actual.Before(ws[0].Opens)
	if !p.StrictSkips || late {
		return 1, at >= 0, late
	}
	for _, w := range ws {
		if !w.Opens.After(actual) {
			shown++
		}
	}
	return max(shown, 1), at >= 0, late
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
	type cycle struct {
		shown int
		hit   bool
	}
	var cycles []cycle
	for i := MinOccurrences; i < len(kept); i++ {
		c := p.cadence(kept[:i])
		if !c.ok {
			continue
		}
		actual := kept[i]
		shown, hit, _ := p.Judge(p.windows(c), actual)
		cycles = append(cycles, cycle{shown, hit && !ignoredBetween(ignores, kept[i-1], actual)})
	}
	if p.RecentCycles > 0 && len(cycles) > p.RecentCycles {
		cycles = cycles[len(cycles)-p.RecentCycles:]
	}
	for _, c := range cycles {
		trials += c.shown
		if c.hit {
			hits++
		}
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
	c := p.cadence(times)
	if !c.ok {
		return Forecast{}, false
	}
	ws := p.windows(c)
	due := c.last.Add(time.Duration(c.days * 24 * float64(time.Hour)))
	f := Forecast{Series: series, N: c.n, EWMADays: c.days, CV: c.cv, LastAt: c.last, DueAt: due, Windows: ws}
	f.OpensAt, f.ClosesAt = ws[0].Opens, ws[0].Closes
	f.Trials, f.Hits = p.Backtest(times, ignores)
	f.Score = Wilson(f.Hits, f.Trials, WilsonZ)
	return f, true
}
