package autopilot

import (
	"context"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
)

// Window is a predicted time range.
type Window struct {
	Start, End time.Time
}

// RunPlan is a house's next two runs on a list (shopping trips), stepped in home time.
type RunPlan struct {
	Next, After Window
	Confidence  float64
}

// Candidate is one thing that may be proposed: its add forecast and where it lives.
type Candidate struct {
	Key      string
	Category string
	// Containers counts the thing's events per container ("list:<id>"): where it lives.
	Containers map[string]int64
	Series     string
	Score      float64
	CV         float64
	Trials     int
	EveryDays  float64 // the rhythm (median gap, days)
	LastAt     time.Time
	OpensAt    time.Time
	ClosesAt   time.Time
	Windows    []predict.Span
	// NeedBy is the probability it is needed before the horizon (predict.NeedBy); only the
	// assist horizon asks, so it is 0 for the others.
	NeedBy float64
}

// KeyEvent is a raw event about a thing or a list, as the cycle and pause rules read it.
type KeyEvent struct {
	Name   string
	At     time.Time
	During string // "run" for a run-mode ignore
}

// Usual is how the house usually writes and buys a thing: its latest wording and usual quantity.
type Usual struct {
	Display, Quantity, Unit, Category string
}

// Signals is everything the planner reads. Services implement it over analytics and the lists;
// tests use autopilottest.Signals.
type Signals interface {
	// RunRhythm is the house's learned run rhythm on the list (runs seen, days between them).
	RunRhythm(ctx context.Context, roomID, listID string) (runs int, intervalDays float64, err error)
	// RunPlan is the next two runs on the list, or nil while none is learned.
	RunPlan(ctx context.Context, roomID, listID string, now time.Time) (*RunPlan, error)
	// Away is when the whole house is away (trips), sorted.
	Away(ctx context.Context, roomID string) (predict.Away, error)
	// Candidates are the things whose forecast window opens by `until`: for the "now" and
	// "next_run" horizons the confident forecasts still open at now (most confident first); for
	// "run_after_next" the list's things with the chance each is needed before `until`.
	Candidates(ctx context.Context, roomID, listID string, h Horizon, now, until time.Time, away predict.Away) ([]Candidate, error)
	// Reactions are the latest suggestion ignores and accepts on the list since `since`, newest
	// first, at most limit.
	Reactions(ctx context.Context, roomID, listID string, since time.Time, limit int) ([]KeyEvent, error)
	// OnList are the normalized keys still to get on the list (unchecked, not archived).
	OnList(ctx context.Context, listID string) ([]string, error)
	// KeyEvents are a thing's newest raw events (fresher than the rollup).
	KeyEvents(ctx context.Context, roomID, key string) ([]KeyEvent, error)
	// Usual is how the house usually writes each key (or a look-alike of it); missing keys have none.
	Usual(ctx context.Context, roomID string, keys []string) (map[string]Usual, error)
}

// Query is one planning request.
type Query struct {
	RoomID, ListID string
	Horizon        Horizon
	Now            time.Time
	// Limit is how many open candidates to keep (the slip asks for 1; assist for MaxPerRun).
	Limit int
	// Lead, for the assist horizon, is how close the next run must be before anything is planned
	// for it (the ticker's AUTOPILOT_LEAD); zero plans for it however far off it is.
	Lead time.Duration
}

// Snapshot is what the planner knows about one list at one moment. Gather builds it.
type Snapshot struct {
	Query
	Paused bool      // two ignores in a row: the house is not interested right now
	Run    *RunPlan  // the run assist plans for (nil for the other horizons, or none learned)
	NoRun  bool      // a run-based horizon with no usable run rhythm
	Away   bool      // the next run starts while the whole house is away
	NotYet bool      // the next run is further off than Query.Lead, or already under way
	Until  time.Time // the horizon's end
	Open   []Ranked  // candidates that passed every filter, in order
	Usual  map[string]Usual
	Spans  predict.Away
}

// Ranked is a candidate that passed the filters, with how soon its window opens.
type Ranked struct {
	Candidate
	DueInDays int
}

// pauseWindow is how far back the pause rule looks for ignores in a row.
const pauseWindow = 14 * 24 * time.Hour

// Gather reads the signals for one list and runs the filters. The filters themselves are pure
// (Rank, CycleOpen, Paused, RunLookahead); Gather only decides what to read, and reads each
// thing's raw events lazily, until Limit candidates are open.
func Gather(ctx context.Context, sig Signals, q Query, p Policy) (Snapshot, error) {
	s := Snapshot{Query: q, Until: q.Now}
	reactions, err := sig.Reactions(ctx, q.RoomID, q.ListID, q.Now.Add(-pauseWindow), pauseAfterIgnores)
	if err != nil {
		return s, err
	}
	if Paused(reactions) {
		s.Paused = true
		return s, nil
	}
	switch q.Horizon {
	case HorizonNextRun:
		runs, days, err := sig.RunRhythm(ctx, q.RoomID, q.ListID)
		if err != nil {
			return s, err
		}
		ahead := RunLookahead(runs, days)
		if ahead == 0 {
			s.NoRun = true
			return s, nil
		}
		s.Until = q.Now.Add(ahead)
	case HorizonRunAfterNext:
		rp, err := sig.RunPlan(ctx, q.RoomID, q.ListID, q.Now)
		if err != nil {
			return s, err
		}
		if rp == nil || rp.Confidence < p.MinRunConfidence {
			s.NoRun = true
			return s, nil
		}
		s.Run = rp
		if q.Lead > 0 && (rp.Next.Start.Sub(q.Now) > q.Lead || !rp.Next.Start.After(q.Now)) {
			s.NotYet = true
			return s, nil
		}
		if s.Spans, err = sig.Away(ctx, q.RoomID); err != nil {
			return s, err
		}
		if s.Spans.Contains(rp.Next.Start) {
			s.Away = true
			return s, nil
		}
		s.Until = rp.After.Start
	}
	cands, err := sig.Candidates(ctx, q.RoomID, q.ListID, q.Horizon, q.Now, s.Until, s.Spans)
	if err != nil {
		return s, err
	}
	onList, err := sig.OnList(ctx, q.ListID)
	if err != nil {
		return s, err
	}
	assist := q.Horizon == HorizonRunAfterNext
	for _, r := range Rank(cands, q.ListID, q.Horizon, onList, q.Now, p) {
		// The slip stops reading once it has enough; assist judges every candidate by its run fit,
		// then Plan keeps the most needed.
		if !assist && q.Limit > 0 && len(s.Open) >= q.Limit {
			break
		}
		evs, err := sig.KeyEvents(ctx, q.RoomID, r.Key)
		if err != nil {
			return s, err
		}
		if !CycleOpen(r, evs, q.Horizon) {
			continue
		}
		if assist {
			var ok bool
			if r, ok = Assess(r, evs, *s.Run, s.Spans); !ok {
				continue
			}
		}
		s.Open = append(s.Open, r)
	}
	if assist {
		s.Open = BestOfLookAlikes(s.Open)
	}
	if len(s.Open) == 0 {
		return s, nil
	}
	keys := make([]string, len(s.Open))
	for i, r := range s.Open {
		keys[i] = r.Key
	}
	s.Usual, err = sig.Usual(ctx, q.RoomID, keys)
	return s, err
}
