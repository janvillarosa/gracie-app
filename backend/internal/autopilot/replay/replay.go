// Package replay benchmarks assist mode on history: at each past shopping run, minus the ticker's
// lead, it plans from only the events before that moment, with the same forecasts, need odds,
// filters and bars the server uses, and scores what assist would have added against what the house
// actually bought in that run. cmd/suggest-eval autopilot is a thin shell around it.
package replay

import (
	"math"
	"sort"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/autopilot"
	"github.com/janvillarosa/gracie-app/backend/internal/parse"
)

// Options tune a replay.
type Options struct {
	Policy autopilot.Policy
	// Lead is how long before a run the ticker plans (AUTOPILOT_LEAD).
	Lead time.Duration
	// Away holds each house's away spans by room id (nil: nobody is ever away).
	Away map[string]predict.Away
	// Slack widens a run's span when matching purchases (a check a little after the run ends).
	Slack time.Duration
}

// DefaultOptions match the server's defaults.
func DefaultOptions() Options {
	return Options{Policy: autopilot.DefaultPolicy, Lead: 18 * time.Hour, Slack: 2 * time.Hour}
}

// Report is what assist would have done over the replayed runs.
type Report struct {
	Policy autopilot.Policy // the bars this replay ran with
	Houses int
	Runs   int // runs replayed (enough run history to plan for them)
	Added  int // items assist would have put on the list
	Hits   int // of those, bought in that run
	Later  int // not bought in that run, but before the next one
	// Bought is every distinct thing bought in the replayed runs; Staples those of them that had a
	// confident forecast at planning time (what assist could possibly have known about).
	Bought, Staples int
	// Open is what was bought in the run but was not on the list when assist planned: the only
	// things assist could have saved someone from writing down.
	Open  int
	Weeks float64 // house-weeks spanned by the replayed runs
}

// Precision is hits over adds (0 with no adds).
func (r Report) Precision() float64 { return ratio(r.Hits, r.Added) }

// Recall is hits over everything bought in those runs.
func (r Report) Recall() float64 { return ratio(r.Hits, r.Bought) }

// StapleRecall is hits over the things that had a confident forecast when assist planned.
func (r Report) StapleRecall() float64 { return ratio(r.Hits, r.Staples) }

// OpenRecall is hits over what was bought but not yet on the list when assist planned.
func (r Report) OpenRecall() float64 { return ratio(r.Hits, r.Open) }

// F1Goal is where assist should get to: the harmonic mean of precision and open recall at 70%.
// It is a target, not a gate (the gate is precision >= 85% and <= 1 removal per house-week);
// TestGoldenAssistF1Floor ratchets the floor up toward it.
const F1Goal = 0.70

// F1 is the harmonic mean of precision and open recall (what assist could have saved someone from
// writing down): high only when assist is both right and actually useful.
func (r Report) F1() float64 {
	p, rc := r.Precision(), r.OpenRecall()
	if p+rc == 0 {
		return 0
	}
	return 2 * p * rc / (p + rc)
}

// Removals counts adds not bought in their run: a person would delete them or they expire.
func (r Report) Removals() int { return r.Added - r.Hits }

// RemovalsPerWeek is removals per house-week (the cost a house feels).
func (r Report) RemovalsPerWeek() float64 {
	if r.Weeks == 0 {
		return 0
	}
	return float64(r.Removals()) / r.Weeks
}

// AddsPerRun is how many things assist adds per replayed run.
func (r Report) AddsPerRun() float64 {
	if r.Runs == 0 {
		return 0
	}
	return float64(r.Added) / float64(r.Runs)
}

func ratio(a, b int) float64 {
	if b == 0 {
		return 0
	}
	return float64(a) / float64(b)
}

func (r *Report) add(o Report) {
	r.Houses += o.Houses
	r.Runs += o.Runs
	r.Added += o.Added
	r.Hits += o.Hits
	r.Later += o.Later
	r.Bought += o.Bought
	r.Staples += o.Staples
	r.Open += o.Open
	r.Weeks += o.Weeks
}

// Replay benchmarks every house in events (any order), and returns the total and one report per
// room id.
func Replay(events []analytics.Event, o Options) (Report, map[string]Report) {
	byRoom := map[string][]analytics.Event{}
	for _, e := range events {
		if e.RoomID != "" && e.Subject.Type == "item" {
			byRoom[e.RoomID] = append(byRoom[e.RoomID], e)
		}
	}
	total := Report{Policy: o.Policy}
	per := map[string]Report{}
	for room, evs := range byRoom {
		sort.SliceStable(evs, func(i, j int) bool { return evs[i].OccurredAt.Before(evs[j].OccurredAt) })
		rep := replayHouse(evs, o.Away[room], o)
		if rep.Runs > 0 {
			rep.Houses = 1
		}
		per[room] = rep
		total.add(rep)
	}
	return total, per
}

// itemEvent is one item event, reduced to what the replay reads.
type itemEvent struct {
	name, key, list string
	at              time.Time
	during          string
}

func reduce(evs []analytics.Event) []itemEvent {
	out := make([]itemEvent, 0, len(evs))
	for _, e := range evs {
		ie := itemEvent{name: e.Name, key: e.Key, at: e.OccurredAt}
		if e.Container != nil && e.Container.Type == "list" {
			ie.list = e.Container.ID
		}
		ie.during, _ = e.Props["during"].(string)
		out = append(out, ie)
	}
	return out
}

func replayHouse(raw []analytics.Event, away predict.Away, o Options) Report {
	evs := reduce(raw)
	// Runs are found per list from the check-offs, as the profile worker finds them.
	checksByList := map[string][]time.Time{}
	for _, e := range evs {
		if e.name == "item.checked" && e.list != "" {
			checksByList[e.list] = append(checksByList[e.list], e.at)
		}
	}
	var rep Report
	for list, checks := range checksByList {
		runs := predict.RunSpans(checks)
		var first, last time.Time
		for k := range runs {
			if k < predict.MinOccurrences+1 {
				continue // too little run history to have a run rhythm yet
			}
			run := runs[k]
			r := planRun(evs, list, runs[:k], run, nextStart(runs, k), away, o)
			if r.Runs == 0 {
				continue
			}
			if first.IsZero() {
				first = run.Start
			}
			last = run.End
			rep.add(r)
		}
		if !first.IsZero() {
			rep.Weeks += math.Max(1, last.Sub(first).Hours()/(24*7))
		}
	}
	return rep
}

func nextStart(runs []predict.RunSpan, k int) time.Time {
	if k+1 < len(runs) {
		return runs[k+1].Start
	}
	return time.Time{}
}

// planRun is one ticker decision: at run.Start - Lead, with only what was known then.
func planRun(evs []itemEvent, list string, past []predict.RunSpan, run predict.RunSpan, next time.Time, away predict.Away, o Options) Report {
	if away.Contains(run.Start) {
		return Report{}
	}
	at := run.Start.Add(-o.Lead)
	// The run after next is a run interval of home time after this one (Reader.RunPlan).
	gaps := make([]float64, 0, len(past))
	for i := 1; i < len(past); i++ {
		gaps = append(gaps, away.HomeBetween(past[i-1].Start, past[i].Start).Hours()/24)
	}
	interval := median(gaps)
	if interval <= 0 {
		return Report{}
	}
	by := away.AddHome(run.Start, time.Duration(interval*24*float64(time.Hour)))

	type hist struct {
		added, checked, ignored []time.Time
		containers              map[string]int64
		openAdd                 bool // added and not yet bought or deleted
		lastAdd                 time.Time
	}
	keys := map[string]*hist{}
	var order []string
	for _, e := range evs {
		if !e.at.Before(at) {
			break
		}
		if e.key == "" {
			continue
		}
		h := keys[e.key]
		if h == nil {
			h = &hist{containers: map[string]int64{}}
			keys[e.key] = h
			order = append(order, e.key)
		}
		if e.list != "" {
			h.containers["list:"+e.list]++
		}
		switch e.name {
		case "item.added":
			h.added = append(h.added, e.at)
			h.openAdd, h.lastAdd = true, e.at
		case "item.checked":
			h.checked = append(h.checked, e.at)
			h.openAdd = false
		case "item.deleted":
			h.openAdd = false
		case "item.suggestion_ignored", "item.autopilot_removed":
			if e.during != autopilot.DuringRun {
				h.ignored = append(h.ignored, e.at)
			}
		}
	}
	var onList []string
	for _, k := range order {
		if keys[k].openAdd {
			onList = append(onList, k)
		}
	}
	// Candidates: what NeedsBefore returns (forecasts whose window opens by the horizon), with
	// the need odds.
	var cands []autopilot.Candidate
	confident := map[string]bool{}
	for _, k := range order {
		h := keys[k]
		f, ok := predict.DefaultParams.PredictAway(h.added, h.checked, h.ignored, away)
		if !ok || f.OpensAt.After(by) {
			continue
		}
		if f.Confident(predict.DefaultParams) {
			confident[k] = true
		}
		c := autopilot.Candidate{
			Key: k, Containers: h.containers, Series: f.Series, Score: f.Score, CV: f.CV, Trials: f.Trials,
			EveryDays: f.EWMADays, LastAt: f.LastAt, OpensAt: f.OpensAt, ClosesAt: f.ClosesAt, Windows: f.Windows,
			NeedBy: predict.NeedBy(f, by, away),
		}
		if c.NeedBy > 0 {
			cands = append(cands, c)
		}
	}
	sort.SliceStable(cands, func(i, j int) bool { return cands[i].NeedBy > cands[j].NeedBy })
	ranked := autopilot.Rank(cands, list, autopilot.HorizonRunAfterNext, onList, at, o.Policy)
	snap := autopilot.Snapshot{
		Query: autopilot.Query{ListID: list, Horizon: autopilot.HorizonRunAfterNext, Now: at},
		Run:   &autopilot.RunPlan{Next: autopilot.Window{Start: run.Start, End: run.End}, After: autopilot.Window{Start: by, End: by}, Confidence: 1},
		Until: by,
	}
	for _, r := range ranked {
		if keyCycleOpen(evs, r, at) {
			snap.Open = append(snap.Open, r)
		}
	}

	// What was actually bought in this run (and before the next one).
	end := run.End.Add(o.Slack)
	bought := map[string]bool{}
	boughtLater := map[string]bool{}
	for _, e := range evs {
		if e.name != "item.checked" || e.list != list || e.key == "" {
			continue
		}
		if !e.at.Before(run.Start) && !e.at.After(end) {
			bought[e.key] = true
		} else if e.at.After(end) && (next.IsZero() || e.at.Before(next)) {
			boughtLater[e.key] = true
		}
	}
	rep := Report{Runs: 1, Bought: len(bought)}
	for k := range bought {
		if confident[k] {
			rep.Staples++
		}
		if !likeIn(k, setOf(onList)) {
			rep.Open++
		}
	}
	for _, pr := range autopilot.Plan(snap, o.Policy) {
		if autopilot.Decide(autopilot.ModeAssist, pr, o.Policy) != autopilot.Apply {
			continue
		}
		rep.Added++
		switch {
		case likeIn(pr.Key, bought):
			rep.Hits++
		case likeIn(pr.Key, boughtLater):
			rep.Later++
		}
	}
	return rep
}

// keyCycleOpen applies the server's cycle rule to the key's events before `at`.
func keyCycleOpen(evs []itemEvent, r autopilot.Ranked, at time.Time) bool {
	var kev []autopilot.KeyEvent
	for _, e := range evs {
		if !e.at.Before(at) {
			break
		}
		if e.key == r.Key {
			kev = append(kev, autopilot.KeyEvent{Name: e.name, At: e.at, During: e.during})
		}
	}
	return autopilot.CycleOpen(r, kev, autopilot.HorizonRunAfterNext)
}

func setOf(keys []string) map[string]bool {
	out := make(map[string]bool, len(keys))
	for _, k := range keys {
		out[k] = true
	}
	return out
}

func likeIn(key string, set map[string]bool) bool {
	if set[key] {
		return true
	}
	for k := range set {
		if parse.Similar(key, k) {
			return true
		}
	}
	return false
}

func median(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	s := append([]float64(nil), xs...)
	sort.Float64s(s)
	if len(s)%2 == 1 {
		return s[len(s)/2]
	}
	return (s[len(s)/2-1] + s[len(s)/2]) / 2
}

// Sweep replays every combination of assist bars.
func Sweep(events []analytics.Event, o Options, minScores, minNeeds []float64) []Report {
	var out []Report
	for _, s := range minScores {
		for _, n := range minNeeds {
			oo := o
			oo.Policy.AssistMinScore, oo.Policy.AssistMinNeed = s, n
			r, _ := Replay(events, oo)
			out = append(out, r)
		}
	}
	return out
}
