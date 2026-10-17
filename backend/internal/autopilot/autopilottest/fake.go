// Package autopilottest is an in-memory autopilot.Signals for tests.
package autopilottest

import (
	"context"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/autopilot"
)

// Signals answers every read from its fields. KeyReads counts KeyEvents calls, so tests can
// check that the cycle check stays lazy.
type Signals struct {
	Runs         int
	IntervalDays float64
	Plan         *autopilot.RunPlan
	AwaySpans    predict.Away
	Cands        []autopilot.Candidate
	ReactionList []autopilot.KeyEvent
	Listed       []string
	Events       map[string][]autopilot.KeyEvent
	Usuals       map[string]autopilot.Usual
	KeyReads     int
	// LastUntil is the horizon end Candidates was last asked for.
	LastUntil time.Time
}

func (f *Signals) RunRhythm(context.Context, string, string) (int, float64, error) {
	return f.Runs, f.IntervalDays, nil
}

func (f *Signals) RunPlan(context.Context, string, string, time.Time) (*autopilot.RunPlan, error) {
	return f.Plan, nil
}

func (f *Signals) Away(context.Context, string) (predict.Away, error) { return f.AwaySpans, nil }

func (f *Signals) Candidates(_ context.Context, _, _ string, _ autopilot.Horizon, _, until time.Time, _ predict.Away) ([]autopilot.Candidate, error) {
	f.LastUntil = until
	return f.Cands, nil
}

func (f *Signals) Reactions(context.Context, string, string, time.Time, int) ([]autopilot.KeyEvent, error) {
	return f.ReactionList, nil
}

func (f *Signals) OnList(context.Context, string) ([]string, error) { return f.Listed, nil }

func (f *Signals) KeyEvents(_ context.Context, _, key string) ([]autopilot.KeyEvent, error) {
	f.KeyReads++
	return f.Events[key], nil
}

func (f *Signals) Usual(_ context.Context, _ string, keys []string) (map[string]autopilot.Usual, error) {
	out := map[string]autopilot.Usual{}
	for _, k := range keys {
		if u, ok := f.Usuals[k]; ok {
			out[k] = u
		}
	}
	return out, nil
}

// Weekly is a confident weekly candidate living on listID whose window is open at now.
func Weekly(key, listID string, now time.Time) autopilot.Candidate {
	last := now.Add(-7 * 24 * time.Hour)
	return autopilot.Candidate{
		Key: key, Containers: map[string]int64{"list:" + listID: 10}, Series: predict.SeriesAdded,
		Score: 0.9, CV: 0.1, Trials: 8, EveryDays: 7, LastAt: last,
		OpensAt: now.Add(-12 * time.Hour), ClosesAt: now.Add(24 * time.Hour),
	}
}

// Buys is n check-offs, `every` apart, the last at `last` (newest first, as KeyEvents returns).
func Buys(every time.Duration, n int, last time.Time) []autopilot.KeyEvent {
	out := make([]autopilot.KeyEvent, n)
	for i := 0; i < n; i++ {
		out[i] = autopilot.KeyEvent{Name: "item.checked", At: last.Add(-time.Duration(i) * every)}
	}
	return out
}
