package analytics

import (
	"context"
	"regexp"
	"time"
)

var rePeriod = regexp.MustCompile(`^\d{4}(-\d{2}(-\d{2})?)?$`)

// ValidPeriod accepts a year (2026), a month (2026-10) or a day (2026-10-16).
func ValidPeriod(p string) bool { return rePeriod.MatchString(p) }

// Reader is the fast-read side: every call is a point lookup or a small indexed range,
// never a scan of raw events. Callers treat a nil result as "nothing learned yet" and
// fall back to non-personalized behavior.
type Reader struct{ aggs AggregateRepository }

func NewReader(aggs AggregateRepository) *Reader { return &Reader{aggs: aggs} }

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

// Period returns the raw rolled-up document for "u" or "h" and a valid period, or nil.
func (r *Reader) Period(ctx context.Context, scope, id, period string) (map[string]any, error) {
	if (scope != "u" && scope != "h") || !ValidPeriod(period) {
		return nil, ErrInvalidEvent
	}
	return r.aggs.GetPeriod(ctx, scope+":"+id+":"+period)
}
