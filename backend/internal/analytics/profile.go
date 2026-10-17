package analytics

import (
	"sort"
	"strings"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
)

// ProfileWindow is how much raw history a profile is computed from.
const ProfileWindow = 180 * 24 * time.Hour

// Profile is one person's (or one house's) learned behavior: when they show up, when they
// act, how regularly they finish things, and how far ahead of a trip they get ready.
// It is replaced whole on every recompute and read by point lookup.
type Profile struct {
	ID         string    `bson:"_id" json:"id"`      // "u:<user>" or "h:<room>"
	Scope      string    `bson:"scope" json:"scope"` // "u" or "h"
	Owner      string    `bson:"owner" json:"owner"`
	ComputedAt time.Time `bson:"computed_at" json:"computed_at"`
	Events     int       `bson:"events" json:"events"`
	TZ         string    `bson:"tz,omitempty" json:"tz,omitempty"`
	// Hour-of-week (Sunday 00:00 = 0) weights with a 28-day half-life, in the person's local time.
	OpenHOW []float64 `bson:"open_how" json:"open_how"` // when they look
	ActHOW  []float64 `bson:"act_how" json:"act_how"`   // when they act
	// Containers holds the rhythm of each thing completions happen in ("list:list_1").
	Containers map[string]ContainerRhythm `bson:"containers,omitempty" json:"containers,omitempty"`
	Trips      *TripHabits                `bson:"trips,omitempty" json:"trips,omitempty"`
	Assigned   *AssignedStats             `bson:"assigned,omitempty" json:"assigned,omitempty"`
	Engagement Engagement                 `bson:"engagement" json:"engagement"`
}

// ContainerRhythm is how often, and when, a container is worked through in one go.
type ContainerRhythm struct {
	Runs        int         `bson:"runs" json:"runs"`
	LastRunAt   time.Time   `bson:"last_run_at" json:"last_run_at"`
	IntervalDay float64     `bson:"run_interval_days" json:"run_interval_days"`
	CV          float64     `bson:"run_interval_cv" json:"run_interval_cv"`
	RunHOW      []float64   `bson:"run_how" json:"run_how"`
	NextRun     *NextWindow `bson:"next_run,omitempty" json:"next_run,omitempty"`
	// What a run usually looks like: medians of its length, its completions, and the gap
	// between completions inside it. A shopping-run detector scales its thresholds by these.
	RunMinutes float64 `bson:"run_minutes,omitempty" json:"run_minutes,omitempty"`
	RunItems   float64 `bson:"run_items,omitempty" json:"run_items,omitempty"`
	RunGapSec  float64 `bson:"run_gap_sec,omitempty" json:"run_gap_sec,omitempty"`
}

// NextWindow is a predicted time range with a confidence between 0 and 1.
type NextWindow struct {
	Start      time.Time `bson:"start" json:"start"`
	End        time.Time `bson:"end" json:"end"`
	Confidence float64   `bson:"confidence" json:"confidence"`
}

// TripHabits are median lead times, in days before a trip starts, for the steps of getting ready.
type TripHabits struct {
	Trips            int      `bson:"trips" json:"trips"`
	Created          *float64 `bson:"created,omitempty" json:"created,omitempty"`
	FirstBooking     *float64 `bson:"first_booking,omitempty" json:"first_booking,omitempty"`
	PackingListMade  *float64 `bson:"packing_list_created,omitempty" json:"packing_list_created,omitempty"`
	FirstTodoChecked *float64 `bson:"first_todo_checked,omitempty" json:"first_todo_checked,omitempty"`
	FirstScheduled   *float64 `bson:"first_scheduled,omitempty" json:"first_scheduled,omitempty"`
}

// AssignedStats describes things handed to this person (events that name them in Targets).
type AssignedStats struct {
	Assigned       int      `bson:"assigned" json:"assigned"`
	Completed      int      `bson:"completed" json:"completed"`
	Open           int      `bson:"open" json:"open"`
	MedianDaysDone *float64 `bson:"median_days_to_complete,omitempty" json:"median_days_to_complete,omitempty"`
}

// Engagement summarizes how present someone is.
type Engagement struct {
	LastOpenAt      *time.Time `bson:"last_open_at,omitempty" json:"last_open_at,omitempty"`
	ActiveDays28    int        `bson:"active_days_28" json:"active_days_28"`
	StreakDays      int        `bson:"streak_days" json:"streak_days"`
	SessionMedianMi *float64   `bson:"typical_session_min,omitempty" json:"typical_session_min,omitempty"`
}

// IsAttention reports whether a verb is someone looking rather than doing.
func IsAttention(verb string) bool { return verb == "open" || verb == "resume" || verb == "view" }

func verbOf(name string) string { return strings.TrimPrefix(name, SubjectType(name)+".") }

func hist(h predict.Histogram) []float64 { return append([]float64(nil), h[:]...) }

func asFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case int:
		return float64(n), true
	case int32:
		return float64(n), true
	case int64:
		return float64(n), true
	case float64:
		return n, true
	}
	return 0, false
}

// BuildProfile computes a profile from the subject's raw events (any order). It is pure.
// For "u:" profiles pass the events that user performed; for "h:" the house's events.
func BuildProfile(reg *Registry, id string, events []Event, now time.Time) *Profile {
	scope, owner, _ := strings.Cut(id, ":")
	p := &Profile{ID: id, Scope: scope, Owner: owner, ComputedAt: now.UTC(), Events: len(events)}
	evs := append([]Event(nil), events...)
	sort.SliceStable(evs, func(i, j int) bool { return evs[i].OccurredAt.Before(evs[j].OccurredAt) })
	if len(evs) > 0 {
		p.TZ = evs[len(evs)-1].Local.TZ // where they are now decides what "Saturday morning" means
	}
	loc := time.UTC
	if l, err := time.LoadLocation(p.TZ); err == nil && p.TZ != "" {
		loc = l
	}

	var open, act []predict.Occurrence
	byContainer := map[string][]Event{}
	for _, e := range evs {
		def, ok := reg.Resolve(e.Name)
		if !ok {
			continue
		}
		occ := predict.Occurrence{At: e.OccurredAt, HOW: e.Local.HOW}
		if IsAttention(verbOf(def.Name)) {
			open = append(open, occ)
		} else if e.Source != SourceClient && !def.Skip { // server and backfilled actions
			act = append(act, occ)
		}
		if def.Role == RoleComplete && e.Container != nil {
			k := e.Container.Type + ":" + e.Container.ID
			byContainer[k] = append(byContainer[k], e)
		}
	}
	p.OpenHOW = hist(predict.HOWHistogram(open, now))
	p.ActHOW = hist(predict.HOWHistogram(act, now))

	p.Containers = map[string]ContainerRhythm{}
	for k, es := range byContainer {
		times := make([]time.Time, len(es))
		for i, e := range es {
			times[i] = e.OccurredAt
		}
		spans := predict.RunSpans(times)
		if len(spans) == 0 {
			continue
		}
		runs := make([]time.Time, len(spans))
		var mins, items, gaps []float64
		for i, sp := range spans {
			runs[i] = sp.Start
			mins = append(mins, sp.End.Sub(sp.Start).Minutes())
			items = append(items, float64(sp.Count))
			for _, g := range sp.Gaps {
				gaps = append(gaps, g.Seconds())
			}
		}
		rhythm := predict.Intervals(runs)
		var occ []predict.Occurrence
		for _, r := range runs {
			l := r.In(loc)
			occ = append(occ, predict.Occurrence{At: r, HOW: int(l.Weekday())*24 + l.Hour()})
		}
		runHOW := predict.HOWHistogram(occ, now)
		cr := ContainerRhythm{Runs: len(runs), LastRunAt: rhythm.Last, IntervalDay: rhythm.EWMADays, CV: rhythm.CV, RunHOW: hist(runHOW)}
		cr.RunMinutes, _ = predict.Median(mins)
		cr.RunItems, _ = predict.Median(items)
		cr.RunGapSec, _ = predict.Median(gaps)
		if w, ok := predict.NextWindow(rhythm, runHOW, loc, now); ok {
			cr.NextRun = &NextWindow{Start: w.Start, End: w.End, Confidence: w.Confidence}
		}
		p.Containers[k] = cr
	}
	if len(p.Containers) == 0 {
		p.Containers = nil
	}

	p.Trips = tripHabits(evs)
	p.Assigned = assignedStats(reg, owner, scope, evs)
	p.Engagement = engagement(reg, evs, loc, now)
	return p
}

// tripHabits reads days_to_start off trip events: per trip the earliest (largest) lead for
// each step, then the median across trips.
func tripHabits(evs []Event) *TripHabits {
	type lead map[string]float64 // step -> earliest days before start
	per := map[string]lead{}
	step := func(e Event) string {
		switch e.Name {
		case "trip.created":
			return "created"
		case "booking.created":
			return "first_booking"
		case "trip.packing_list_created":
			return "packing"
		case "todo.checked":
			return "first_checked"
		case "todo.scheduled":
			return "first_scheduled"
		}
		return ""
	}
	for _, e := range evs {
		s := step(e)
		if s == "" {
			continue
		}
		d, ok := asFloat(e.Props["days_to_start"])
		if !ok {
			continue
		}
		tripID := e.Subject.ID
		if e.Container != nil && e.Container.Type == "trip" {
			tripID = e.Container.ID
		}
		l := per[tripID]
		if l == nil {
			l = lead{}
			per[tripID] = l
		}
		if cur, seen := l[s]; !seen || d > cur {
			l[s] = d
		}
	}
	if len(per) == 0 {
		return nil
	}
	med := func(s string) *float64 {
		var xs []float64
		for _, l := range per {
			if v, ok := l[s]; ok {
				xs = append(xs, v)
			}
		}
		if m, ok := predict.Median(xs); ok {
			return &m
		}
		return nil
	}
	return &TripHabits{
		Trips: len(per), Created: med("created"), FirstBooking: med("first_booking"),
		PackingListMade: med("packing"), FirstTodoChecked: med("first_checked"), FirstScheduled: med("first_scheduled"),
	}
}

// assignedStats counts what was handed to this user and how quickly it got done. It works for
// any feature whose events name people in Targets with the verb "assigned".
func assignedStats(reg *Registry, user, scope string, evs []Event) *AssignedStats {
	if scope != "u" {
		return nil
	}
	assigned := map[string]time.Time{} // subject id -> when it was handed over
	for _, e := range evs {
		if verbOf(e.Name) != "assigned" {
			continue
		}
		for _, t := range e.Targets {
			if t == user {
				assigned[e.Subject.ID] = e.OccurredAt
			}
		}
	}
	if len(assigned) == 0 {
		return nil
	}
	s := &AssignedStats{Assigned: len(assigned)}
	var days []float64
	done := map[string]bool{}
	for _, e := range evs {
		at, ok := assigned[e.Subject.ID]
		if !ok || done[e.Subject.ID] || !e.OccurredAt.After(at) {
			continue
		}
		if def, ok := reg.Resolve(e.Name); ok && def.Role == RoleComplete {
			done[e.Subject.ID] = true
			days = append(days, e.OccurredAt.Sub(at).Hours()/24)
		}
	}
	s.Completed, s.Open = len(done), len(assigned)-len(done)
	if m, ok := predict.Median(days); ok {
		s.MedianDaysDone = &m
	}
	return s
}

func engagement(reg *Registry, evs []Event, loc *time.Location, now time.Time) Engagement {
	var en Engagement
	var lastOpen time.Time
	days := map[string]bool{}
	sessions := map[string][2]time.Time{}
	for _, e := range evs {
		def, ok := reg.Resolve(e.Name)
		if !ok {
			continue
		}
		if IsAttention(verbOf(def.Name)) && e.OccurredAt.After(lastOpen) {
			lastOpen = e.OccurredAt
		}
		if e.Local.Date != "" {
			days[e.Local.Date] = true
		}
		if e.SessionID != "" {
			s := sessions[e.SessionID]
			if s[0].IsZero() || e.OccurredAt.Before(s[0]) {
				s[0] = e.OccurredAt
			}
			if e.OccurredAt.After(s[1]) {
				s[1] = e.OccurredAt
			}
			sessions[e.SessionID] = s
		}
	}
	if !lastOpen.IsZero() {
		en.LastOpenAt = &lastOpen
	}
	today := now.In(loc)
	for i := 0; i < 28; i++ {
		if days[today.AddDate(0, 0, -i).Format("2006-01-02")] {
			en.ActiveDays28++
		}
	}
	// The streak counts back from today, or from yesterday while today has not started yet.
	d := today
	if !days[d.Format("2006-01-02")] {
		d = d.AddDate(0, 0, -1)
	}
	for days[d.Format("2006-01-02")] {
		en.StreakDays++
		d = d.AddDate(0, 0, -1)
	}
	var mins []float64
	for _, s := range sessions {
		if m := s[1].Sub(s[0]).Minutes(); m > 0 {
			mins = append(mins, m)
		}
	}
	if m, ok := predict.Median(mins); ok {
		en.SessionMedianMi = &m
	}
	return en
}
