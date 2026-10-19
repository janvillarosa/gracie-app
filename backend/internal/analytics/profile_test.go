package analytics_test

import (
	"context"
	"fmt"
	"math"
	"reflect"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
)

var ny = mustLoc("America/New_York")

func mustLoc(name string) *time.Location {
	l, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return l
}

func fullRegistry() *analytics.Registry {
	reg := analytics.NewRegistry()
	services.RegisterAnalyticsEvents(reg)
	trips.RegisterAnalyticsEvents(reg)
	reg.MustRegister(analytics.EventDef{Name: "chore.assigned"}, analytics.EventDef{Name: "chore.done", Role: analytics.RoleComplete})
	return reg
}

// localEv stamps an event as if it happened at `at` for someone living in New York.
func localEv(id, name, actor string, at time.Time, mut func(*analytics.Event)) analytics.Event {
	src := analytics.SourceServer
	if analytics.IsAttention(name[len(analytics.SubjectType(name))+1:]) {
		src = analytics.SourceClient
	}
	e := analytics.Event{
		EventID: id, Name: name, Source: src, ActorID: actor, RoomID: "room_1", OccurredAt: at,
		Subject: analytics.Ref{Type: analytics.SubjectType(name), ID: id},
	}
	if mut != nil {
		mut(&e)
	}
	analytics.Stamp(&e, at, "America/New_York", 400*24*time.Hour)
	e.EventID = id
	return e
}

func inList(e *analytics.Event) { e.Container = &analytics.Ref{Type: "list", ID: "list_1"} }

// A household that shops on Saturday mornings and looks at the list on Friday evenings.
func weeklyShopper(weeks int, lastSaturday time.Time) []analytics.Event {
	var evs []analytics.Event
	for w := 0; w < weeks; w++ {
		sat := lastSaturday.AddDate(0, 0, -7*(weeks-1-w))
		for i := 0; i < 4; i++ {
			at := sat.Add(time.Duration(i*6) * time.Minute)
			evs = append(evs, localEv("chk"+sat.Format("0102")+string(rune('a'+i)), "item.checked", "mia", at, inList))
		}
		fri := sat.AddDate(0, 0, -1).Add(8 * time.Hour) // 18:00
		evs = append(evs, localEv("view"+sat.Format("0102"), "list.view", "mia", fri, inList))
	}
	return evs
}

func TestProfilePredictsTheNextShoppingRun(t *testing.T) {
	// 10:00 New York on the last Saturday of the window (2026-09-19).
	lastSat := time.Date(2026, 9, 19, 10, 0, 0, 0, ny)
	now := time.Date(2026, 9, 21, 9, 0, 0, 0, ny) // Monday
	p := analytics.BuildProfile(fullRegistry(), "u:mia", weeklyShopper(8, lastSat), now)

	if p.TZ != "America/New_York" || p.Events != 40 {
		t.Fatalf("tz/events: %q %d", p.TZ, p.Events)
	}
	c, ok := p.Containers["list:list_1"]
	if !ok || c.Runs != 8 || math.Abs(c.IntervalDay-7) > 0.01 || c.CV > 0.01 {
		t.Fatalf("container rhythm: %+v", c)
	}
	if c.NextRun == nil || c.NextRun.Confidence < 0.9 {
		t.Fatalf("next run: %+v", c.NextRun)
	}
	wantStart := time.Date(2026, 9, 26, 9, 0, 0, 0, ny) // next Saturday, around 10:00 their time
	if !c.NextRun.Start.Equal(wantStart.UTC()) || !c.NextRun.End.Equal(wantStart.Add(3*time.Hour).UTC()) {
		t.Fatalf("window %v - %v, want start %v", c.NextRun.Start, c.NextRun.End, wantStart.UTC())
	}
	// Looks on Friday at 18:00, acts on Saturday at 10:00.
	if peak := argmax(p.OpenHOW); peak != 5*24+18 {
		t.Fatalf("open peak %d", peak)
	}
	if peak := argmax(p.ActHOW); peak != 6*24+10 {
		t.Fatalf("act peak %d", peak)
	}
	if p.Engagement.LastOpenAt == nil || p.Engagement.ActiveDays28 < 4 {
		t.Fatalf("engagement: %+v", p.Engagement)
	}
}

func argmax(h []float64) int {
	best, at := -1.0, 0
	for i, v := range h {
		if v > best {
			best, at = v, i
		}
	}
	return at
}

func TestProfileWithThinHistoryMakesNoPrediction(t *testing.T) {
	sat := time.Date(2026, 9, 19, 10, 0, 0, 0, ny)
	p := analytics.BuildProfile(fullRegistry(), "u:mia", weeklyShopper(2, sat), sat.AddDate(0, 0, 2))
	if c := p.Containers["list:list_1"]; c.NextRun != nil {
		t.Fatalf("two runs must not produce a prediction: %+v", c.NextRun)
	}
}

func TestProfileEmptyHistory(t *testing.T) {
	p := analytics.BuildProfile(fullRegistry(), "h:room_1", nil, time.Now())
	if p.Events != 0 || p.Containers != nil || p.Trips != nil || len(p.OpenHOW) != 168 {
		t.Fatalf("%+v", p)
	}
}

func TestProfileTripLeadTimes(t *testing.T) {
	now := time.Date(2026, 10, 1, 12, 0, 0, 0, ny)
	var evs []analytics.Event
	for i, lead := range []int64{40, 30, 50} { // three trips, each planned a few weeks out
		trip := "trip_" + string(rune('a'+i))
		at := now.AddDate(0, 0, -100+i*10)
		tripEv := func(id, name string, days int64, container bool) analytics.Event {
			return localEv(id, name, "mia", at, func(e *analytics.Event) {
				e.Props = map[string]any{"days_to_start": days}
				if container {
					e.Container = &analytics.Ref{Type: "trip", ID: trip}
				} else {
					e.Subject.ID = trip
				}
			})
		}
		evs = append(evs,
			tripEv(trip+"c", "trip.created", lead, false),
			tripEv(trip+"b", "booking.created", lead-10, true),
			tripEv(trip+"p", "trip.packing_list_created", 3, false),
			tripEv(trip+"p2", "todo.checked", 2, true),
			tripEv(trip+"p3", "todo.checked", 1, true), // later check of the same trip: the earliest (largest lead) wins
		)
	}
	h := analytics.BuildProfile(fullRegistry(), "u:mia", evs, now).Trips
	if h == nil || h.Trips != 3 {
		t.Fatalf("habits: %+v", h)
	}
	if *h.Created != 40 || *h.FirstBooking != 30 || *h.PackingListMade != 3 || *h.FirstTodoChecked != 2 {
		t.Fatalf("medians: created=%v booking=%v packing=%v checked=%v", *h.Created, *h.FirstBooking, *h.PackingListMade, *h.FirstTodoChecked)
	}
	if h.FirstScheduled != nil {
		t.Fatal("a step that never happened has no median")
	}
}

func TestProfileAssignedStatsWorkForAnyFeature(t *testing.T) {
	now := time.Date(2026, 10, 10, 12, 0, 0, 0, ny)
	assign := func(id, subject string, at time.Time) analytics.Event {
		return localEv(id, "chore.assigned", "sam", at, func(e *analytics.Event) {
			e.Subject.ID = subject
			e.Targets = []string{"mia"}
		})
	}
	done := func(id, subject string, at time.Time) analytics.Event {
		return localEv(id, "chore.done", "mia", at, func(e *analytics.Event) { e.Subject.ID = subject })
	}
	evs := []analytics.Event{
		assign("a1", "bins", now.AddDate(0, 0, -6)), done("d1", "bins", now.AddDate(0, 0, -4)), // 2 days
		assign("a2", "dishes", now.AddDate(0, 0, -5)), done("d2", "dishes", now.AddDate(0, 0, -4)), // 1 day
		assign("a3", "laundry", now.AddDate(0, 0, -1)), // still open
	}
	// Mia's own profile reads it from events where she is a target, so her events slice must include them.
	s := analytics.BuildProfile(fullRegistry(), "u:mia", evs, now).Assigned
	if s == nil || s.Assigned != 3 || s.Completed != 2 || s.Open != 1 || s.MedianDaysDone == nil || math.Abs(*s.MedianDaysDone-1.5) > 1e-9 {
		t.Fatalf("assigned: %+v", s)
	}
	if h := analytics.BuildProfile(fullRegistry(), "h:room_1", evs, now); h.Assigned != nil {
		t.Fatal("house profiles carry no per-person assignment stats")
	}
}

func TestEngagementStreakAndSessions(t *testing.T) {
	now := time.Date(2026, 10, 10, 20, 0, 0, 0, ny)
	var evs []analytics.Event
	for d := 0; d < 3; d++ { // today, yesterday, the day before
		at := now.AddDate(0, 0, -d)
		evs = append(evs, localEv("o"+string(rune('a'+d)), "app.open", "mia", at, func(e *analytics.Event) { e.SessionID = "s" + string(rune('a'+d)) }))
		evs = append(evs, localEv("v"+string(rune('a'+d)), "list.view", "mia", at.Add(10*time.Minute), func(e *analytics.Event) { e.SessionID = "s" + string(rune('a'+d)) }))
	}
	evs = append(evs, localEv("old", "app.open", "mia", now.AddDate(0, 0, -6), nil)) // a gap, so the streak stops at 3
	en := analytics.BuildProfile(fullRegistry(), "u:mia", evs, now).Engagement
	if en.StreakDays != 3 || en.ActiveDays28 != 4 || en.SessionMedianMi == nil || math.Abs(*en.SessionMedianMi-10) > 1e-9 {
		t.Fatalf("engagement: %+v", en)
	}
}

func TestProfilePassRecomputesDirtySubjectsOnly(t *testing.T) {
	r := newRig(time.Date(2026, 9, 21, 9, 0, 0, 0, ny))
	r.worker = analytics.NewWorker(r.events, r.aggs, fullRegistry())
	r.worker = r.worker.WithClock(func() time.Time { return r.now })
	lastSat := time.Date(2026, 9, 19, 10, 0, 0, 0, ny)
	r.add(weeklyShopper(6, lastSat)...)
	r.add(localEv("other", "item.checked", "zed", lastSat, func(e *analytics.Event) { e.RoomID = "room_9" }))
	ctx := context.Background()

	if _, err := r.worker.FoldOnce(ctx); err != nil {
		t.Fatal(err)
	}
	n, err := r.worker.ProfilePass(ctx)
	if err != nil || n != 4 { // u:mia, h:room_1, u:zed, h:room_9
		t.Fatalf("pass: %d %v", n, err)
	}
	reader := analytics.NewReader(r.aggs)
	mia, err := reader.Profile(ctx, "mia")
	if err != nil || mia == nil || mia.Containers["list:list_1"].Runs != 6 {
		t.Fatalf("mia: %+v %v", mia, err)
	}
	house, _ := reader.HouseProfile(ctx, "room_1")
	if house == nil || house.Scope != "h" {
		t.Fatalf("house: %+v", house)
	}
	if none, _ := reader.Profile(ctx, "nobody"); none != nil {
		t.Fatal("unknown users have no profile")
	}
	// Nothing new: a second pass has nothing to do.
	if n, _ := r.worker.ProfilePass(ctx); n != 0 {
		t.Fatalf("second pass recomputed %d", n)
	}
	// An idle profile goes stale after a day and is refreshed without any new event.
	r.now = r.now.Add(25 * time.Hour)
	if n, _ := r.worker.ProfilePass(ctx); n != 4 {
		t.Fatalf("stale refresh recomputed %d, want 4", n)
	}
}

func TestReaderDueAndPeriods(t *testing.T) {
	r := newRig(time.Date(2026, 12, 1, 9, 0, 0, 0, time.UTC))
	for i := 0; i < 4; i++ {
		at := time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC).AddDate(0, 0, 7*i)
		r.add(ev("item.added", "mia", "room_1", "milk", at), ev("item.checked", "mia", "room_1", "milk", at.Add(time.Hour)))
	}
	r.add(ev("item.checked", "mia", "room_1", "salt", time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC))) // one check: no due date
	ctx := context.Background()
	if _, err := r.worker.FoldOnce(ctx); err != nil {
		t.Fatal(err)
	}
	reader := analytics.NewReader(r.aggs)

	stats, _ := reader.KeyStats(ctx, "room_1", "item", []string{"milk", "salt", "ghost"})
	if len(stats) != 2 || stats["milk"].Counts["checked"] != 4 || stats["milk"].Intervals == nil || stats["milk"].Intervals.DueAt == nil {
		t.Fatalf("stats: %+v", stats)
	}
	if _, ok := stats["ghost"]; ok {
		t.Fatal("unknown keys are absent")
	}
	due, _ := reader.Due(ctx, "room_1", "item", time.Date(2026, 12, 31, 0, 0, 0, 0, time.UTC), 10)
	if len(due) != 1 || due[0].Key != "milk" {
		t.Fatalf("due: %+v", due)
	}
	if none, _ := reader.Due(ctx, "room_1", "item", time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), 10); len(none) != 0 {
		t.Fatalf("nothing is due before the history starts: %+v", none)
	}

	p, err := reader.Period(ctx, "h", "room_1", "2026-10")
	if err != nil || p == nil || num(p, "counts.item.checked") != 5 {
		t.Fatalf("period: %+v %v", p, err)
	}
	if none, _ := reader.Period(ctx, "h", "room_1", "2020"); none != nil {
		t.Fatal("a quiet period has no document")
	}
	for _, bad := range []string{"", "2026-1", "latest", "2026-10-16-1"} {
		if _, err := reader.Period(ctx, "h", "room_1", bad); err == nil {
			t.Fatalf("period %q should be rejected", bad)
		}
	}
	if _, err := reader.Period(ctx, "x", "room_1", "2026"); err == nil {
		t.Fatal("unknown scope should be rejected")
	}
}

func TestProfileActHourCountsBackfilledActionsButNotClientOnes(t *testing.T) {
	sat := time.Date(2026, 9, 19, 10, 0, 0, 0, ny)
	now := sat.AddDate(0, 0, 2)
	backfilled := localEv("bf", "item.checked", "mia", sat, func(e *analytics.Event) { e.Source = analytics.SourceBackfill })
	client := localEv("cl", "item.delete_undone", "mia", sat.Add(-6*time.Hour), func(e *analytics.Event) { e.Source = analytics.SourceClient })
	p := analytics.BuildProfile(fullRegistry(), "u:mia", []analytics.Event{backfilled, client}, now)
	if p.ActHOW[6*24+10] == 0 {
		t.Fatal("a backfilled check must count toward act_how")
	}
	if p.ActHOW[6*24+4] != 0 {
		t.Fatal("client events must not count toward act_how")
	}
}

func TestProfileLearnsWhatARunLooksLike(t *testing.T) {
	sat := time.Date(2026, 9, 5, 10, 0, 0, 0, ny)
	runs := []struct{ checks, gapMin int }{{4, 2}, {3, 4}, {5, 3}}
	var evs []analytics.Event
	for w, r := range runs {
		start := sat.AddDate(0, 0, 7*w)
		for i := 0; i < r.checks; i++ {
			at := start.Add(time.Duration(i*r.gapMin) * time.Minute)
			evs = append(evs, localEv(fmt.Sprintf("c%d_%d", w, i), "item.checked", "mia", at, inList))
		}
	}
	p := analytics.BuildProfile(fullRegistry(), "u:mia", evs, sat.AddDate(0, 0, 16))
	c := p.Containers["list:list_1"]
	// Runs last 6, 8 and 12 minutes; hold 4, 3 and 5 checks; gaps are 2,2,2, 4,4, 3,3,3,3 minutes.
	if c.RunMinutes != 8 || c.RunItems != 4 || c.RunGapSec != 180 {
		t.Fatalf("run shape: minutes %v items %v gap %v", c.RunMinutes, c.RunItems, c.RunGapSec)
	}
}

// routeRuns builds one shopping run per day on list_1: every wording list is checked a minute
// apart, in order. words[run] is that run's order.
func routeRuns(words [][]string) []analytics.Event {
	var evs []analytics.Event
	start := time.Date(2026, 9, 1, 10, 0, 0, 0, ny)
	for r, order := range words {
		day := start.AddDate(0, 0, 7*r)
		for i, w := range order {
			id := fmt.Sprintf("rt%d_%d", r, i)
			key := w
			evs = append(evs, localEv(id, "item.checked", "mia", day.Add(time.Duration(i)*time.Minute), func(e *analytics.Event) {
				inList(e)
				e.Key = key
			}))
		}
	}
	return evs
}

func sameOrder(n int, order ...string) [][]string {
	out := make([][]string, n)
	for i := range out {
		out[i] = order
	}
	return out
}

func TestHouseProfileLearnsRoute(t *testing.T) {
	evs := routeRuns(sameOrder(6, "milk", "eggs", "bread", "apples", "rice"))
	now := time.Date(2026, 11, 1, 9, 0, 0, 0, ny)
	p := analytics.BuildProfile(fullRegistry(), "h:room_1", evs, now)
	r := p.Containers["list:list_1"].Route
	if r == nil || r.Runs != 6 {
		t.Fatalf("route: %+v", r)
	}
	if got := r.Spots["bread"]; math.Abs(got-0.5) > 0.01 {
		t.Fatalf("bread spot %v, want the middle (0.5): %+v", got, r.Spots)
	}
	if got := r.Spots["eggs"]; got <= r.Spots["milk"] || got >= r.Spots["bread"] {
		t.Fatalf("eggs should sit between milk and bread: %+v", r.Spots)
	}
}

// A run still going when the profile is recomputed (the next check could be a minute away) has not
// told us its order yet: four items checked early in a shop would read as the whole walk.
func TestRouteIgnoresTheRunInProgress(t *testing.T) {
	walk := []string{"bananas", "milk", "eggs", "bread", "cheese", "rice", "soap", "tea"}
	done := routeRuns(sameOrder(6, walk...))
	now := time.Date(2026, 11, 1, 9, 0, 0, 0, ny)
	want := analytics.BuildProfile(fullRegistry(), "h:room_1", done, now).Containers["list:list_1"].Route

	words := sameOrder(6, walk...)
	words = append(words, walk[:4]) // the seventh shop, four items in
	lastStart := time.Date(2026, 9, 1, 10, 0, 0, 0, ny).AddDate(0, 0, 7*6)
	mid := analytics.BuildProfile(fullRegistry(), "h:room_1", routeRuns(words), lastStart.Add(10*time.Minute)).Containers["list:list_1"].Route
	if want == nil || mid == nil || mid.Runs != want.Runs || !reflect.DeepEqual(mid.Spots, want.Spots) {
		t.Fatalf("a run in progress changed the route:\n done: %+v\n mid:  %+v", want, mid)
	}
	// Once it has been quiet for a while it is a finished (short) run and counts.
	later := analytics.BuildProfile(fullRegistry(), "h:room_1", routeRuns(words), lastStart.Add(3*time.Hour)).Containers["list:list_1"].Route
	if later == nil || later.Runs != want.Runs+1 {
		t.Fatalf("a finished run should count: %+v", later)
	}
}

func TestPersonProfileHasNoRoute(t *testing.T) {
	evs := routeRuns(sameOrder(6, "milk", "eggs", "bread", "apples", "rice"))
	now := time.Date(2026, 11, 1, 9, 0, 0, 0, ny)
	p := analytics.BuildProfile(fullRegistry(), "u:mia", evs, now)
	if c := p.Containers["list:list_1"]; c.Runs == 0 || c.Route != nil {
		t.Fatalf("person route: %+v", c)
	}
}

func TestRouteMergesLookAlikes(t *testing.T) {
	var words [][]string
	for i := 0; i < 6; i++ {
		egg := "egg"
		if i >= 3 {
			egg = "eggs" // the newest wording
		}
		words = append(words, []string{"milk", egg, "bread", "apples", "rice"})
	}
	now := time.Date(2026, 11, 1, 9, 0, 0, 0, ny)
	p := analytics.BuildProfile(fullRegistry(), "h:room_1", routeRuns(words), now)
	r := p.Containers["list:list_1"].Route
	if r == nil {
		t.Fatal("no route")
	}
	if _, ok := r.Spots["eggs"]; !ok {
		t.Fatalf("want one spot under the newest wording: %+v", r.Spots)
	}
	if _, ok := r.Spots["egg"]; ok {
		t.Fatalf("old wording should be merged: %+v", r.Spots)
	}
}

func TestRouteDedupesRepeatedChecks(t *testing.T) {
	// "milk" checked twice in a run must not break the order: the first check wins.
	words := sameOrder(6, "milk", "eggs", "milk", "bread", "apples")
	now := time.Date(2026, 11, 1, 9, 0, 0, 0, ny)
	p := analytics.BuildProfile(fullRegistry(), "h:room_1", routeRuns(words), now)
	r := p.Containers["list:list_1"].Route
	if r == nil || r.Spots["milk"] >= r.Spots["eggs"] {
		t.Fatalf("route: %+v", r)
	}
}
