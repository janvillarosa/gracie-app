package services

import (
	"context"
	"math"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

// Run likelihoods: how sure the house's habits make us that a shopping run is happening now.
const (
	RunExpected = "expected" // their usual time: fewer checks start a run
	RunUnknown  = "unknown"  // not enough history, or an in-between hour
	RunUnlikely = "unlikely" // an hour they never shop: more checks start a run
)

const (
	runHintMinRuns     = 3   // runs before a rhythm says anything
	runHintTypicalRuns = 5   // runs before "what a run usually looks like" is shown
	runHintConfidence  = 0.5 // next_run confidence that makes the window count
	runHintHabitShare  = 0.5 // share of the run_how peak that makes an hour a habit
	runHintOddShare    = 0.1 // below this share an hour is one they never shop at
	runHintSlack       = time.Hour
)

// RunTypical is what this person's (or house's) run on a list usually looks like.
type RunTypical struct {
	Minutes int `json:"minutes"`
	Items   int `json:"items"`
}

// RunHint tells the List page how to spot a shopping run from live check-offs. The page decides;
// the hint only sets its thresholds from what analytics has learned.
type RunHint struct {
	Likely        string      `json:"likely"`
	ChecksToStart int         `json:"checks_to_start"`
	IdleEndMin    int         `json:"idle_end_min"`
	BurstSec      int         `json:"burst_sec"`
	Typical       *RunTypical `json:"typical,omitempty"`
}

// DefaultRunHint is the rule with nothing learned: predict.RunMin checks, ended by predict.RunGap.
func DefaultRunHint() RunHint {
	return RunHint{Likely: RunUnknown, ChecksToStart: predict.RunMin, IdleEndMin: int(predict.RunGap.Minutes()), BurstSec: 15}
}

// ComputeRunHint is pure: own is the person's profile, house the house's (either may be nil).
// The person's own rhythm on the list wins once it has runHintMinRuns runs.
func ComputeRunHint(own, house *analytics.Profile, listID string, now time.Time) RunHint {
	h := DefaultRunHint()
	p, c, ok := pickRhythm(own, house, "list:"+listID)
	if !ok {
		return h
	}
	if c.RunGapSec > 0 {
		gap := time.Duration(c.RunGapSec * float64(time.Second))
		h.IdleEndMin = int(clampDuration(4*gap, 15*time.Minute, predict.RunGap).Minutes())
		h.BurstSec = int(math.Round(clampDuration(gap/5, 5*time.Second, 30*time.Second).Seconds()))
	}
	if c.Runs >= runHintTypicalRuns && c.RunMinutes > 0 {
		h.Typical = &RunTypical{Minutes: int(math.Round(c.RunMinutes)), Items: int(math.Round(c.RunItems))}
	}
	if c.Runs < runHintMinRuns {
		return h
	}
	inWindow := c.NextRun != nil && c.NextRun.Confidence >= runHintConfidence &&
		!now.Before(c.NextRun.Start.Add(-runHintSlack)) && !now.After(c.NextRun.End.Add(runHintSlack))
	share := habitShare(c.RunHOW, now, p.TZ)
	switch {
	case inWindow || share >= runHintHabitShare:
		h.Likely, h.ChecksToStart = RunExpected, 2
	case share < runHintOddShare:
		h.Likely, h.ChecksToStart = RunUnlikely, 4
	}
	return h
}

func pickRhythm(own, house *analytics.Profile, key string) (*analytics.Profile, analytics.ContainerRhythm, bool) {
	get := func(p *analytics.Profile) (analytics.ContainerRhythm, bool) {
		if p == nil {
			return analytics.ContainerRhythm{}, false
		}
		c, ok := p.Containers[key]
		return c, ok
	}
	oc, ownOK := get(own)
	if ownOK && oc.Runs >= runHintMinRuns {
		return own, oc, true
	}
	if hc, ok := get(house); ok {
		return house, hc, true
	}
	return own, oc, ownOK
}

// habitShare is the heaviest of this hour of week and its two neighbours, as a share of the peak.
func habitShare(how []float64, now time.Time, tz string) float64 {
	if len(how) != predict.HoursInWeek {
		return 0
	}
	peak := 0.0
	for _, v := range how {
		peak = math.Max(peak, v)
	}
	if peak == 0 {
		return 0
	}
	loc := time.UTC
	if l, err := time.LoadLocation(tz); err == nil && tz != "" {
		loc = l
	}
	l := now.In(loc)
	at := int(l.Weekday())*24 + l.Hour()
	best := 0.0
	for d := -1; d <= 1; d++ {
		best = math.Max(best, how[(at+d+predict.HoursInWeek)%predict.HoursInWeek])
	}
	return best / peak
}

func clampDuration(d, lo, hi time.Duration) time.Duration {
	return min(max(d, lo), hi)
}

// RunHintFor reads the person's and the house's profiles (point lookups) and computes the hint.
// With analytics off, or suggestions off for the house, it answers with the default rule.
func (s *SuggestionService) RunHintFor(ctx context.Context, user *models.User, roomID, listID string) (RunHint, error) {
	room, err := s.checkList(ctx, user, roomID, listID)
	if err != nil {
		return RunHint{}, err
	}
	if s.reader == nil || room.SuggestionsOff {
		return DefaultRunHint(), nil
	}
	own, err := s.reader.Profile(ctx, user.UserID)
	if err != nil {
		return RunHint{}, err
	}
	house, err := s.reader.HouseProfile(ctx, roomID)
	if err != nil {
		return RunHint{}, err
	}
	return ComputeRunHint(own, house, listID, s.now().UTC()), nil
}
