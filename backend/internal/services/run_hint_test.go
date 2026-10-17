package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
)

// Saturday 2026-10-17, 10:00 UTC: hour of week 6*24+10.
var hintNow = time.Date(2026, 10, 17, 10, 0, 0, 0, time.UTC)

const hintHOW = 6*24 + 10

// rhythmProfile is a UTC profile whose list_1 rhythm has `runs` runs and the given run_how weights.
func rhythmProfile(runs int, how map[int]float64, mut func(*analytics.ContainerRhythm)) *analytics.Profile {
	h := make([]float64, 168)
	for k, v := range how {
		h[k] = v
	}
	c := analytics.ContainerRhythm{Runs: runs, RunHOW: h}
	if mut != nil {
		mut(&c)
	}
	return &analytics.Profile{TZ: "UTC", Containers: map[string]analytics.ContainerRhythm{"list:list_1": c}}
}

func TestComputeRunHint(t *testing.T) {
	peakElsewhere := map[int]float64{2*24 + 20: 10} // Tuesday 20:00
	cases := []struct {
		name        string
		own, house  *analytics.Profile
		likely      string
		checks      int
		idle, burst int
		typical     *RunTypical
	}{
		{name: "nothing learned", likely: "unknown", checks: 3, idle: 45, burst: 15},
		{name: "own thin, house used", own: rhythmProfile(2, map[int]float64{hintHOW: 10}, nil),
			house: rhythmProfile(6, peakElsewhere, nil), likely: "unlikely", checks: 4, idle: 45, burst: 15},
		{name: "inside the predicted window", own: rhythmProfile(4, peakElsewhere, func(c *analytics.ContainerRhythm) {
			c.NextRun = &analytics.NextWindow{Start: hintNow.Add(-30 * time.Minute), End: hintNow.Add(2 * time.Hour), Confidence: 0.6}
		}), likely: "expected", checks: 2, idle: 45, burst: 15},
		{name: "window within an hour counts", own: rhythmProfile(4, peakElsewhere, func(c *analytics.ContainerRhythm) {
			c.NextRun = &analytics.NextWindow{Start: hintNow.Add(50 * time.Minute), End: hintNow.Add(3 * time.Hour), Confidence: 0.6}
		}), likely: "expected", checks: 2, idle: 45, burst: 15},
		{name: "a low-confidence window does not", own: rhythmProfile(4, peakElsewhere, func(c *analytics.ContainerRhythm) {
			c.NextRun = &analytics.NextWindow{Start: hintNow.Add(-30 * time.Minute), End: hintNow.Add(2 * time.Hour), Confidence: 0.4}
		}), likely: "unlikely", checks: 4, idle: 45, burst: 15},
		{name: "habit hour", own: rhythmProfile(3, map[int]float64{hintHOW: 5, 20: 10}, nil), likely: "expected", checks: 2, idle: 45, burst: 15},
		{name: "neighbouring habit hour", own: rhythmProfile(3, map[int]float64{hintHOW + 1: 10}, nil), likely: "expected", checks: 2, idle: 45, burst: 15},
		{name: "an odd hour", own: rhythmProfile(3, map[int]float64{hintHOW: 0.5, 20: 10}, nil), likely: "unlikely", checks: 4, idle: 45, burst: 15},
		{name: "a middling hour", own: rhythmProfile(3, map[int]float64{hintHOW: 3, 20: 10}, nil), likely: "unknown", checks: 3, idle: 45, burst: 15},
		{name: "quick shopper clamps", own: rhythmProfile(3, map[int]float64{hintHOW: 3, 20: 10}, func(c *analytics.ContainerRhythm) { c.RunGapSec = 60 }),
			likely: "unknown", checks: 3, idle: 15, burst: 12},
		{name: "slow shopper clamps", own: rhythmProfile(3, map[int]float64{hintHOW: 3, 20: 10}, func(c *analytics.ContainerRhythm) { c.RunGapSec = 1200 }),
			likely: "unknown", checks: 3, idle: 45, burst: 30},
		{name: "four runs: no typical", own: rhythmProfile(4, map[int]float64{hintHOW: 3, 20: 10}, func(c *analytics.ContainerRhythm) { c.RunMinutes, c.RunItems = 22.4, 11.6 }),
			likely: "unknown", checks: 3, idle: 45, burst: 15},
		{name: "five runs: typical", own: rhythmProfile(5, map[int]float64{hintHOW: 3, 20: 10}, func(c *analytics.ContainerRhythm) { c.RunMinutes, c.RunItems = 22.4, 11.6 }),
			likely: "unknown", checks: 3, idle: 45, burst: 15, typical: &RunTypical{Minutes: 22, Items: 12}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := ComputeRunHint(c.own, c.house, "list_1", hintNow)
			if h.Likely != c.likely || h.ChecksToStart != c.checks || h.IdleEndMin != c.idle || h.BurstSec != c.burst {
				t.Fatalf("got %+v", h)
			}
			if (h.Typical == nil) != (c.typical == nil) || (h.Typical != nil && *h.Typical != *c.typical) {
				t.Fatalf("typical %+v want %+v", h.Typical, c.typical)
			}
		})
	}
	if ComputeRunHint(nil, nil, "list_1", hintNow) != DefaultRunHint() {
		t.Fatal("default")
	}
}

func TestComputeRunHintUsesTheProfileTimezone(t *testing.T) {
	// 10:00 UTC is 06:00 in New York (EDT): the habit at New York 06:00 is what counts.
	p := rhythmProfile(3, map[int]float64{6*24 + 6: 10}, nil)
	p.TZ = "America/New_York"
	if h := ComputeRunHint(p, nil, "list_1", hintNow); h.Likely != "expected" {
		t.Fatalf("got %+v", h)
	}
}

func TestRunHintFor(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	ctx := context.Background()
	_ = r.m.Aggs.PutProfile(ctx, &analytics.Profile{ID: "u:" + r.user.UserID, TZ: "UTC", Containers: map[string]analytics.ContainerRhythm{
		"list:" + r.list: {Runs: 3, RunHOW: func() []float64 {
			h := make([]float64, 168)
			h[(int(r.now.Weekday())*24+r.now.Hour())%168] = 9
			return h
		}()},
	}})
	h, err := r.svc.RunHintFor(ctx, r.user, r.roomID, r.list)
	if err != nil || h.Likely != "expected" {
		t.Fatalf("own habit: %+v %v", h, err)
	}
	stranger := &models.User{UserID: "zed"}
	if _, err := r.svc.RunHintFor(ctx, stranger, r.roomID, r.list); !errors.Is(err, derr.ErrForbidden) {
		t.Fatalf("not a member: %v", err)
	}
	bare := NewSuggestionService(r.m.Rooms, r.m.Lists, r.m.Items, nil, nil, SuggestionsOn)
	if h, err := bare.RunHintFor(ctx, r.user, r.roomID, r.list); err != nil || h != DefaultRunHint() {
		t.Fatalf("analytics off: %+v %v", h, err)
	}
}
