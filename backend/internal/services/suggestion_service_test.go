package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
)

// storeRecorder writes straight into the event store, so what a service emits is what the
// next read sees (the buffered recorder does the same a moment later).
type storeRecorder struct{ repo *memstore.EventRepo }

func (r storeRecorder) Record(ctx context.Context, ev analytics.Event) {
	analytics.Stamp(&ev, time.Now(), analytics.TZFrom(ctx), 400*24*time.Hour)
	_ = r.repo.InsertMany(ctx, []analytics.Event{ev})
}

type suggestRig struct {
	t      *testing.T
	m      memstore.Repos
	reg    *analytics.Registry
	lists  *ListService
	svc    *SuggestionService
	user   *models.User
	roomID string
	list   string // groceries
	other  string // a party list
	now    time.Time
	n      int
}

func newSuggestRig(t *testing.T, mode SuggestionMode) *suggestRig {
	t.Helper()
	m := memstore.Compose()
	reg := analytics.NewRegistry()
	RegisterAnalyticsEvents(reg)
	us := NewUserService(m.Users, m.Rooms, m.Tx)
	ls := NewListService(m.Users, m.Rooms, m.Lists, m.Items, categorization.NewKeywordCategorizer(categorization.GroceryAnchors))
	ctx := context.Background()
	cu, err := us.CreateUserWithSoloRoom(ctx, "A")
	if err != nil {
		t.Fatal(err)
	}
	roomID := *cu.User.RoomID
	groceries, _ := ls.CreateList(ctx, cu.User, roomID, "Groceries", "", "")
	party, _ := ls.CreateList(ctx, cu.User, roomID, "Party", "", "")
	r := &suggestRig{t: t, m: m, reg: reg, lists: ls, user: cu.User, roomID: roomID, list: groceries.ListID, other: party.ListID, now: time.Now().UTC()}
	r.svc = NewSuggestionService(m.Rooms, m.Lists, m.Items, analytics.NewReader(m.Aggs), m.Events, mode).WithClock(func() time.Time { return r.now })
	rec := storeRecorder{m.Events}
	r.svc.UseRecorder(rec)
	ls.UseRecorder(rec)
	return r
}

// history inserts backdated events: name for key on list, `ago` days before now.
func (r *suggestRig) history(name, key, listID string, ago ...float64) {
	var evs []analytics.Event
	for _, d := range ago {
		at := r.now.Add(-time.Duration(d * 24 * float64(time.Hour)))
		r.n++
		e := analytics.Event{
			EventID: "h" + string(rune('a'+r.n%26)) + at.Format(time.RFC3339Nano) + key + name,
			Name:    name, Source: analytics.SourceServer, ActorID: r.user.UserID, RoomID: r.roomID, Key: key,
			Subject: analytics.Ref{Type: "item", ID: "i"}, Container: &analytics.Ref{Type: "list", ID: listID}, Category: "Dairy",
			OccurredAt: at,
		}
		analytics.Stamp(&e, at, "UTC", 400*24*time.Hour)
		evs = append(evs, e)
	}
	_ = r.m.Events.InsertMany(context.Background(), evs)
}

// weekly is eight weekly adds ending a week ago, so the next one is due right now.
func (r *suggestRig) weekly(key, listID string) {
	r.history("item.added", key, listID, 56, 49, 42, 35, 28, 21, 14, 7)
}

func (r *suggestRig) fold() {
	r.t.Helper()
	w := analytics.NewWorker(r.m.Events, r.m.Aggs, r.reg).WithClock(func() time.Time { return time.Now().Add(time.Hour) })
	if _, err := w.FoldOnce(context.Background()); err != nil {
		r.t.Fatal(err)
	}
}

func (r *suggestRig) suggest() []Suggestion {
	r.t.Helper()
	out, err := r.svc.ForList(context.Background(), r.user, r.roomID, r.list, 3)
	if err != nil {
		r.t.Fatal(err)
	}
	return out
}

func keysOf(sg []Suggestion) []string {
	out := make([]string, len(sg))
	for i, s := range sg {
		out[i] = s.Key
	}
	return out
}

func TestSuggestsAWeeklyItemWhenItIsDue(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.weekly("whole milk", r.list)
	_ = r.m.Items.Put(context.Background(), &models.ListItem{ItemID: "old", ListID: r.list, RoomID: r.roomID,
		Description: "Whole Milk", Quantity: "2", Unit: "l", Category: "Dairy", IsArchived: true, Completed: true, CreatedAt: r.now.AddDate(0, 0, -7)})
	r.fold()

	got := r.suggest()
	if len(got) != 1 {
		t.Fatalf("want one suggestion, got %+v", got)
	}
	if s := got[0]; s.Key != "whole milk" || s.Description != "Whole Milk" || s.Quantity != "2" || s.Unit != "l" || s.EveryDays != 7 || s.Score < 0.7 {
		t.Fatalf("suggestion: %+v", s)
	}
}

func TestNothingBeforeTheWindowOpensOrAfterItCloses(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.weekly("whole milk", r.list)
	r.fold()
	base := r.now // due now: the last add was a week ago
	r.now = base.Add(-4 * 24 * time.Hour)
	if got := r.suggest(); len(got) != 0 {
		t.Fatalf("too early: %+v", got)
	}
	r.now = base.Add(-30 * time.Hour) // the window opens three days before
	if got := r.suggest(); len(got) != 1 {
		t.Fatalf("shortly before it is due: %+v", got)
	}
	r.now = base.Add(3 * 24 * time.Hour) // between this week's window and next week's
	if got := r.suggest(); len(got) != 0 {
		t.Fatalf("stepped aside after the window: %+v", got)
	}
	r.now = base.Add(6 * 24 * time.Hour) // skipped a week: it comes back for the next one
	if got := r.suggest(); len(got) != 1 {
		t.Fatalf("back the week after a skip: %+v", got)
	}
	r.now = base.Add(40 * 24 * time.Hour) // past every tolerated skip: the habit has lapsed
	if got := r.suggest(); len(got) != 0 {
		t.Fatalf("lapsed: %+v", got)
	}
}

func TestThinOrIrregularHistoryIsNotSuggested(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.history("item.added", "eggs", r.list, 21, 14, 7)             // too little evidence
	r.history("item.added", "bread", r.list, 40, 38, 25, 24, 9, 7) // irregular
	r.fold()
	if got := r.suggest(); len(got) != 0 {
		t.Fatalf("got %v", keysOf(got))
	}
}

func TestOnlySuggestedOnItsHomeList(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.weekly("chips", r.other)
	r.history("item.added", "chips", r.list, 28.05) // once, the same evening, on groceries
	r.fold()
	if got := r.suggest(); len(got) != 0 {
		t.Fatalf("chips live on the party list: %v", keysOf(got))
	}
	out, _ := r.svc.ForList(context.Background(), r.user, r.roomID, r.other, 3)
	if len(out) != 1 {
		t.Fatalf("party list: %+v", out)
	}
}

func TestNotSuggestedWhenAlreadyOnTheList(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.weekly("whole milk", r.list)
	r.fold()
	_ = r.m.Items.Put(context.Background(), &models.ListItem{ItemID: "x", ListID: r.list, RoomID: r.roomID, Description: "whole  MILK"})
	if got := r.suggest(); len(got) != 0 {
		t.Fatalf("still to get: already on the list: %+v", got)
	}
}

// Houses that never clear their list keep every checked row. A row checked in an earlier cycle
// was bought then; it must not block this cycle's suggestion.
func TestACheckedRowFromAnEarlierCycleDoesNotBlock(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.weekly("whole milk", r.list)
	r.fold()
	done := r.now.AddDate(0, 0, -7)
	_ = r.m.Items.Put(context.Background(), &models.ListItem{ItemID: "old", ListID: r.list, RoomID: r.roomID, Description: "Whole milk",
		Completed: true, CompletedAt: &done, CreatedAt: done})
	if got := r.suggest(); len(got) != 1 {
		t.Fatalf("a checked row from last week should not block this week: %+v", got)
	}
}

func TestRawEventsNewerThanTheRollupWin(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.weekly("whole milk", r.list)
	r.fold()
	r.history("item.added", "whole milk", r.other, 0.1) // added and cleared elsewhere, not folded yet
	if got := r.suggest(); len(got) != 0 {
		t.Fatalf("the cycle already happened: %+v", got)
	}
}

func TestIgnoreHidesForThisCycleAndCountsAsAMiss(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.weekly("whole milk", r.list)
	r.fold()
	ctx := context.Background()
	if err := r.svc.Ignore(ctx, r.user, r.roomID, r.list, "whole milk"); err != nil {
		t.Fatal(err)
	}
	if got := r.suggest(); len(got) != 0 {
		t.Fatalf("ignored this cycle: %+v", got)
	}
	// The ignore is an ordinary item event, so the rollup counts it against the next cycle
	// (see TestIgnoredSuggestionsCountAgainstTheForecast).
	evs, _ := r.m.Events.ListForKey(ctx, r.roomID, "item", "whole milk", 100)
	last := evs[len(evs)-1]
	if last.Name != "item.suggestion_ignored" || last.Container == nil || last.Container.ID != r.list {
		t.Fatalf("ignore event: %+v", last)
	}
}

func TestIgnoreValidatesKeyAndMembership(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.weekly("whole milk", r.list)
	r.fold()
	ctx := context.Background()
	if err := r.svc.Ignore(ctx, r.user, r.roomID, r.list, "never seen"); !errors.Is(err, derr.ErrNotFound) {
		t.Fatalf("unknown key: %v", err)
	}
	if err := r.svc.Ignore(ctx, r.user, r.roomID, r.list, ""); !errors.Is(err, derr.ErrBadRequest) {
		t.Fatalf("empty key: %v", err)
	}
	stranger := &models.User{UserID: "u_x", RoomID: &r.roomID}
	if err := r.svc.Ignore(ctx, stranger, r.roomID, r.list, "whole milk"); !errors.Is(err, derr.ErrForbidden) {
		t.Fatalf("stranger: %v", err)
	}
	if _, err := r.svc.ForList(ctx, stranger, r.roomID, r.list, 3); !errors.Is(err, derr.ErrForbidden) {
		t.Fatalf("stranger read: %v", err)
	}
}

func TestRankedByConfidence(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.history("item.added", "eggs", r.list, 35, 28, 21, 14, 7) // 2 trials
	r.weekly("whole milk", r.list)                             // 5 trials
	r.history("item.added", "bananas", r.list, 70, 63, 56, 49, 42, 35, 28, 21, 14, 7)
	r.fold()
	got := keysOf(r.suggest())
	if len(got) != 2 || got[0] != "bananas" || got[1] != "whole milk" {
		t.Fatalf("got %v", got)
	}
}

func TestChecksOnlyHouseStillGetsSuggestions(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.history("item.added", "whole milk", r.list, 56)
	r.history("item.checked", "whole milk", r.list, 56, 49, 42, 35, 28, 21, 14, 7)
	r.fold()
	if got := r.suggest(); len(got) != 1 {
		t.Fatalf("got %+v", got)
	}
}

func TestOnModeShowsAndRecordsOncePerCycle(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.weekly("whole milk", r.list)
	r.fold()
	if got := r.suggest(); len(got) != 1 {
		t.Fatalf("a confident forecast shows: %+v", got)
	}
	_ = r.suggest() // a second view of the same cycle records nothing new
	evs, _ := r.m.Events.ListForKey(context.Background(), r.roomID, "item", "whole milk", 100)
	var predicted []analytics.Event
	for _, e := range evs {
		if e.Name == "item.suggestion_predicted" {
			predicted = append(predicted, e)
		}
	}
	if len(predicted) != 1 || predicted[0].Props["mode"] != "on" || predicted[0].Props["series"] != "added" {
		t.Fatalf("predictions: %+v", predicted)
	}
}

func TestOffModeAndHouseSettingAndNoAnalytics(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOff)
	r.weekly("whole milk", r.list)
	r.fold()
	if got := r.suggest(); len(got) != 0 {
		t.Fatalf("mode off: %+v", got)
	}

	r.svc.mode = SuggestionsOn
	rs := NewRoomService(r.m.Users, r.m.Rooms, r.m.Tx)
	off := true
	if err := rs.UpdateRoomSettings(context.Background(), r.user, nil, nil, &off); err != nil {
		t.Fatal(err)
	}
	if got := r.suggest(); len(got) != 0 {
		t.Fatalf("house turned it off: %+v", got)
	}
	off = false
	_ = rs.UpdateRoomSettings(context.Background(), r.user, nil, nil, &off)
	if got := r.suggest(); len(got) != 1 {
		t.Fatalf("back on: %+v", got)
	}

	bare := NewSuggestionService(r.m.Rooms, r.m.Lists, r.m.Items, nil, nil, SuggestionsOn)
	if got, err := bare.ForList(context.Background(), r.user, r.roomID, r.list, 3); err != nil || len(got) != 0 {
		t.Fatalf("analytics disabled: %+v %v", got, err)
	}
	if err := bare.Ignore(context.Background(), r.user, r.roomID, r.list, "whole milk"); err != nil {
		t.Fatalf("ignore without analytics is a no-op: %v", err)
	}
}

func TestParseSuggestionMode(t *testing.T) {
	type want struct {
		mode   SuggestionMode
		legacy bool
	}
	for in, w := range map[string]want{
		"off": {SuggestionsOff, false}, "on": {SuggestionsOn, false}, "": {SuggestionsOn, false},
		"shadow": {SuggestionsOn, true}, " ON ": {SuggestionsOn, false}, "junk": {SuggestionsOn, false},
	} {
		if got, legacy := ParseSuggestionMode(in); got != w.mode || legacy != w.legacy {
			t.Errorf("%q: (%s, %v) want (%s, %v)", in, got, legacy, w.mode, w.legacy)
		}
	}
}

func TestAddFromSuggestionIsTagged(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	ctx := WithAddSource(context.Background(), AddSourceSuggestion)
	if _, err := r.lists.CreateItem(ctx, r.user, r.roomID, r.list, "Whole milk", "", "", ""); err != nil {
		t.Fatal(err)
	}
	_, _ = r.lists.CreateItem(WithAddSource(context.Background(), "spoofed"), r.user, r.roomID, r.list, "Eggs", "", "", "")
	evs, _ := r.m.Events.ListForKey(context.Background(), r.roomID, "item", "whole milk", 10)
	if len(evs) != 2 || evs[0].Name != "item.added" || evs[0].Props["source"] != AddSourceSuggestion || evs[1].Name != "item.suggestion_accepted" {
		t.Fatalf("milk: %+v", evs)
	}
	evs, _ = r.m.Events.ListForKey(context.Background(), r.roomID, "item", "eggs", 10)
	if len(evs) != 1 || evs[0].Props != nil { // a plain add is not a reaction to a suggestion
		t.Fatalf("eggs: %+v", evs)
	}
}

// weeklyPair makes two items due now on the groceries list, so ignoring one still leaves another.
func (r *suggestRig) twoDue() {
	r.weekly("whole milk", r.list)
	r.history("item.added", "eggs", r.list, 56, 49, 42, 35, 28, 21, 14, 7)
	r.fold()
}

func (r *suggestRig) react(name string, ago time.Duration, listID string) {
	e := analytics.Event{EventID: "r" + name + ago.String() + listID, Name: name, Source: analytics.SourceServer, ActorID: r.user.UserID, RoomID: r.roomID,
		Key: "x", Subject: analytics.Ref{Type: "item", ID: "i"}, Container: &analytics.Ref{Type: "list", ID: listID}, OccurredAt: r.now.Add(-ago)}
	analytics.Stamp(&e, e.OccurredAt, "UTC", 400*24*time.Hour)
	_ = r.m.Events.InsertMany(context.Background(), []analytics.Event{e})
}

func TestTwoIgnoresInARowPauseSuggestions(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.twoDue()
	ctx := context.Background()
	if err := r.svc.Ignore(ctx, r.user, r.roomID, r.list, "whole milk"); err != nil {
		t.Fatal(err)
	}
	if got := r.suggest(); len(got) != 1 || got[0].Key != "eggs" {
		t.Fatalf("one ignore only skips that item: %+v", got)
	}
	time.Sleep(2 * time.Millisecond) // the second ignore is strictly newer than the first
	if err := r.svc.Ignore(ctx, r.user, r.roomID, r.list, "eggs"); err != nil {
		t.Fatal(err)
	}
	if got := r.suggest(); len(got) != 0 {
		t.Fatalf("two ignores in a row stop suggesting on the list: %+v", got)
	}
}

func TestAnAcceptedSuggestionEndsTheStreak(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.twoDue()
	r.react("item.suggestion_ignored", 3*time.Hour, r.list)
	r.react("item.suggestion_accepted", 2*time.Hour, r.list)
	r.react("item.suggestion_ignored", time.Hour, r.list)
	if got := r.suggest(); len(got) == 0 {
		t.Fatal("ignore, accept, ignore is not two in a row")
	}
}

func TestThePauseIsPerListAndLapses(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.twoDue()
	r.react("item.suggestion_ignored", 3*time.Hour, r.other)
	r.react("item.suggestion_ignored", 2*time.Hour, r.other)
	if got := r.suggest(); len(got) == 0 {
		t.Fatal("ignores on the party list must not pause the groceries list")
	}
	r.react("item.suggestion_ignored", 20*24*time.Hour, r.list)
	r.react("item.suggestion_ignored", 19*24*time.Hour, r.list)
	if got := r.suggest(); len(got) == 0 {
		t.Fatal("two old ignores (past the pause) no longer count")
	}
	// Just inside the 14 day pause both still count.
	r.react("item.suggestion_ignored", 13*24*time.Hour+22*time.Hour, r.list)
	r.react("item.suggestion_ignored", 13*24*time.Hour+20*time.Hour, r.list)
	if got := r.suggest(); len(got) != 0 {
		t.Fatalf("two recent ignores pause the list: %+v", got)
	}
}

// "orange" one week and "oranges" the next: one weekly habit under two names.
func (r *suggestRig) orangesBothWays() {
	r.history("item.added", "orange", r.list, 56, 42, 28, 14)
	r.history("item.added", "oranges", r.list, 49, 35, 21, 7)
	r.fold()
}

func TestLookAlikesAreOneSuggestion(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.orangesBothWays()
	got, err := r.svc.ForList(context.Background(), r.user, r.roomID, r.list, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || (got[0].Key != "orange" && got[0].Key != "oranges") {
		t.Fatalf("one slip for orange/oranges, got %v", keysOf(got))
	}
}

func TestALookAlikeOnTheListCounts(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.orangesBothWays()
	_ = r.m.Items.Put(context.Background(), &models.ListItem{ItemID: "x", ListID: r.list, RoomID: r.roomID, Description: "Oranges"})
	if got := r.suggest(); len(got) != 0 {
		t.Fatalf("Oranges on the list covers orange: %+v", got)
	}
}

func TestTheSlipUsesTheMostRecentWording(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.orangesBothWays()
	ctx := context.Background()
	_ = r.m.Items.Put(ctx, &models.ListItem{ItemID: "old", ListID: r.list, RoomID: r.roomID, Description: "Orange",
		IsArchived: true, Completed: true, CreatedAt: r.now.AddDate(0, 0, -14)})
	_ = r.m.Items.Put(ctx, &models.ListItem{ItemID: "new", ListID: r.list, RoomID: r.roomID, Description: "Oranges", Quantity: "6",
		IsArchived: true, Completed: true, CreatedAt: r.now.AddDate(0, 0, -7)})
	got := r.suggest()
	if len(got) != 1 || got[0].Description != "Oranges" || got[0].Quantity != "6" {
		t.Fatalf("show it the way the house last wrote it: %+v", got)
	}
}

// The usual purchase: added on Saturday evening, checked off on Sunday. The check belongs to the
// same cycle and must not hide next week's suggestion.
func TestCheckingOffTheLastAddDoesNotEndTheCycle(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.weekly("whole milk", r.list)
	r.history("item.checked", "whole milk", r.list, 6.25) // 18 hours after the last add
	r.fold()
	if got := r.suggest(); len(got) != 1 {
		t.Fatalf("checking off last week's milk must not hide this week's: %+v", got)
	}
}
