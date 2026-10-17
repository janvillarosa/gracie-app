package analytics

import (
	"context"
	"regexp"
	"sort"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
)

var rePeriod = regexp.MustCompile(`^\d{4}(-\d{2}(-\d{2})?)?$`)

// ValidPeriod accepts a year (2026), a month (2026-10) or a day (2026-10-16).
func ValidPeriod(p string) bool { return rePeriod.MatchString(p) }

// Reader is the fast-read side: every call is a point lookup or a small indexed range,
// never a scan of raw events. Callers treat a nil result as "nothing learned yet" and
// fall back to non-personalized behavior.
type Reader struct {
	aggs AggregateRepository
	away AwayCalendar // nil: nobody is ever away
}

func NewReader(aggs AggregateRepository) *Reader { return &Reader{aggs: aggs} }

// WithAway sets the away calendar RunPlan projects runs past (nil: nobody is ever away).
func (r *Reader) WithAway(c AwayCalendar) *Reader {
	r.away = c
	return r
}

// RunPlan is a house's next two runs on a container (a shopping trip on a list): Next is the
// learned NextRun, After the one a run interval of home time later.
type RunPlan struct {
	Next, After NextWindow
	Confidence  float64
}

// RunPlan returns the next two runs on a container ("list:<id>"), or nil while the house has no
// learned run rhythm there.
func (r *Reader) RunPlan(ctx context.Context, roomID, containerKey string, now time.Time) (*RunPlan, error) {
	p, err := r.aggs.GetProfile(ctx, "h:"+roomID)
	if err != nil || p == nil {
		return nil, err
	}
	c, ok := p.Containers[containerKey]
	if !ok || c.NextRun == nil || c.IntervalDay <= 0 {
		return nil, nil
	}
	var away predict.Away
	if r.away != nil {
		if away, err = r.away.HouseAway(ctx, roomID); err != nil {
			return nil, err
		}
		away = away.Normalize()
	}
	gap := time.Duration(c.IntervalDay * 24 * float64(time.Hour))
	step := func(w NextWindow) NextWindow {
		out := NextWindow{Start: away.AddHome(w.Start, gap).UTC(), Confidence: w.Confidence}
		out.End = out.Start.Add(w.End.Sub(w.Start))
		return out
	}
	// The stored NextRun was predicted when the profile was computed; if that run has gone by
	// unseen, roll forward a run interval at a time (bounded: a stale profile is recomputed daily).
	next := *c.NextRun
	for i := 0; i < 8 && next.End.Before(now); i++ {
		next = step(next)
	}
	return &RunPlan{Next: next, After: step(next), Confidence: next.Confidence}, nil
}

// KeyNeed is a thing and the probability it is needed before a time.
type KeyNeed struct {
	Stat KeyStat
	P    float64
}

// NeedsBefore returns the things that live in a container ("list:<id>") with the probability each
// is needed before `by` (predict.NeedBy, on each forecast's own clock with `away`), most likely
// first. It is one indexed query over forecasts whose first window opens by `by`; things with
// no forecast, or that never lived in the container, are left out.
func (r *Reader) NeedsBefore(ctx context.Context, roomID, containerKey string, by time.Time, away predict.Away, limit int) ([]KeyNeed, error) {
	stats, err := r.aggs.ForecastKeys(ctx, roomID, by.UTC(), needsScan)
	if err != nil {
		return nil, err
	}
	var out []KeyNeed
	for _, ks := range stats {
		if ks.Intervals == nil || ks.Intervals.Add == nil || ks.Containers[containerKey] == 0 {
			continue
		}
		if p := predict.NeedBy(ks.Intervals.Add.Forecast(), by, away); p > 0 {
			out = append(out, KeyNeed{Stat: ks, P: p})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].P != out[j].P {
			return out[i].P > out[j].P
		}
		return out[i].Stat.Key < out[j].Stat.Key
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// needsScan bounds how many forecasts NeedsBefore reads for one house.
const needsScan = 500

// Profile returns one person's profile, or nil before one exists.
func (r *Reader) Profile(ctx context.Context, userID string) (*Profile, error) {
	return r.aggs.GetProfile(ctx, "u:"+userID)
}

// HouseProfile returns a house's profile, or nil before one exists.
func (r *Reader) HouseProfile(ctx context.Context, roomID string) (*Profile, error) {
	return r.aggs.GetProfile(ctx, "h:"+roomID)
}

// KeyStats returns stats for the given keys; keys with no history are absent from the map.
func (r *Reader) KeyStats(ctx context.Context, roomID, subjectType string, keys []string) (map[string]KeyStat, error) {
	if len(keys) == 0 {
		return map[string]KeyStat{}, nil
	}
	return r.aggs.GetKeyStats(ctx, roomID, subjectType, keys)
}

// Due returns things predicted to be needed before `before`, soonest first. The caller
// should drop what is already on the list (it has the live list loaded) before suggesting.
func (r *Reader) Due(ctx context.Context, roomID, subjectType string, before time.Time, limit int) ([]KeyStat, error) {
	return r.aggs.DueKeys(ctx, roomID, subjectType, before, limit)
}

// Upcoming returns things whose suggestion window has opened by opensBefore (pass now for "open
// right now") and has not closed, and whose forecast clears the confidence bar, most confident
// first. Like Due, the caller drops what is already on the list.
func (r *Reader) Upcoming(ctx context.Context, roomID, subjectType string, now, opensBefore time.Time, limit int) ([]KeyStat, error) {
	p := predict.DefaultParams
	return r.aggs.UpcomingKeys(ctx, roomID, subjectType, now.UTC(), opensBefore.UTC(), p.MinScore, p.MaxCV, limit)
}

// Period returns the raw rolled-up document for "u" or "h" and a valid period, or nil.
func (r *Reader) Period(ctx context.Context, scope, id, period string) (map[string]any, error) {
	if (scope != "u" && scope != "h") || !ValidPeriod(period) {
		return nil, ErrInvalidEvent
	}
	return r.aggs.GetPeriod(ctx, scope+":"+id+":"+period)
}
