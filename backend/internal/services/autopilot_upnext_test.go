package services

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/autopilot"
	derr "github.com/janvillarosa/gracie-app/backend/internal/errors"
)

var shopSpots = map[string]float64{"bananas": 0, "milk": 0.25, "eggs": 0.5, "bread": 0.75, "cheese": 1}

// setRoute gives the house a learned route on the groceries list (score 0.8 over 8 runs) and a
// next run starting nextRunIn from now with the given confidence.
func (r *suggestRig) setRoute(spots map[string]float64, score float64, nextRunIn time.Duration, conf float64) {
	start := r.now.Add(nextRunIn)
	_ = r.m.Aggs.PutProfile(context.Background(), &analytics.Profile{ID: "h:" + r.roomID, Scope: "h", Owner: r.roomID,
		Containers: map[string]analytics.ContainerRhythm{"list:" + r.list: {Runs: 12, IntervalDay: 7,
			Route:   &predict.Route{Runs: 8, Score: score, Spots: spots},
			NextRun: &analytics.NextWindow{Start: start, End: start.Add(time.Hour), Confidence: conf}}}})
}

// item puts a thing on the groceries list, checked or not, and returns its id.
func (r *suggestRig) item(name string, done bool) string {
	r.t.Helper()
	ctx := context.Background()
	it, err := r.lists.CreateItem(ctx, r.user, r.roomID, r.list, name, "", "", "")
	if err != nil {
		r.t.Fatal(err)
	}
	if done {
		if err := r.m.Items.UpdateCompletion(ctx, it.ItemID, true, r.user.UserID, r.now); err != nil {
			r.t.Fatal(err)
		}
	}
	return it.ItemID
}

// checkedAgo records a check-off of key on the groceries list, minutes before now.
func (r *suggestRig) checkedAgo(key string, minutes float64) {
	r.history("item.checked", key, r.list, minutes/(24*60))
}

func (r *suggestRig) view(during string) *AutopilotView {
	r.t.Helper()
	v, err := r.svc.View(context.Background(), r.user, r.roomID, r.list, during)
	if err != nil {
		r.t.Fatal(err)
	}
	return v
}

func TestViewStackSuggestOrder(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.weekly("yogurt", r.list)
	r.fold()
	r.setRoute(shopSpots, 0.8, -10*time.Minute, 0.8)
	r.item("Bananas", true)
	r.item("Milk", false)
	v := r.view("")
	want := []autopilot.Feature{autopilot.FeatureUpNext, autopilot.FeatureSuggestions}
	if !slices.Equal(v.Stack, want) {
		t.Fatalf("stack = %v, want %v (suggestions %d)", v.Stack, want, len(v.Suggestions))
	}
	if v.UpNext == nil || !v.UpNext.Ready || len(v.UpNext.Route) != 2 {
		t.Fatalf("up_next = %+v", v.UpNext)
	}
}

func TestViewStackAssistOrder(t *testing.T) {
	r := assistHouse(t, 10*time.Hour)
	r.tick()
	r.setRoute(map[string]float64{"whole milk": 0.2, "eggs": 0.5, "bread": 0.8}, 0.8, -10*time.Minute, 0.8)
	v := r.view("")
	want := []autopilot.Feature{autopilot.FeatureUpNext, autopilot.FeatureAutoAdd}
	if !slices.Equal(v.Stack, want) {
		t.Fatalf("stack = %v, want %v (applied %d)", v.Stack, want, len(v.Applied))
	}
}

func TestViewOffHasNoStack(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.setRoute(shopSpots, 0.8, -10*time.Minute, 0.8)
	r.item("Milk", false)
	if err := r.m.Rooms.SetAutopilotMode(context.Background(), r.roomID, r.user.UserID, "off", r.now); err != nil {
		t.Fatal(err)
	}
	v := r.view("")
	if len(v.Stack) != 0 || v.UpNext != nil || len(v.Features) != 0 {
		t.Fatalf("off house got a stack: %+v", v)
	}
}

func TestViewNoRouteNoUpNext(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.setRoute(shopSpots, 0.4, -10*time.Minute, 0.8) // below the bar
	r.item("Milk", false)
	v := r.view("")
	if v.UpNext != nil || slices.Contains(v.Stack, autopilot.FeatureUpNext) {
		t.Fatalf("a route below the bar must stay silent: %+v", v)
	}
}

func TestUpNextRunAnchorAnyMember(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.setRoute(shopSpots, 0.8, 7*24*time.Hour, 0.8)
	r.item("Bananas", true)
	milk := r.item("Milk", true)
	r.item("Eggs", false)
	r.checkedAgo("bananas", 3)
	r.checkedAgo("milk", 1)
	u := r.view("").UpNext
	if u == nil || u.Run == nil || u.Run.AnchorItemID != milk || !u.Ready {
		t.Fatalf("up_next = %+v, want a run anchored on milk (%s)", u, milk)
	}
	if want := r.now.Add(-3 * time.Minute); !u.Run.StartedAt.Equal(want.Truncate(time.Nanosecond)) && u.Run.StartedAt.Sub(want).Abs() > time.Second {
		t.Errorf("run started %v, want about %v", u.Run.StartedAt, want)
	}
}

func TestUpNextRunIgnoresOldChecks(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.setRoute(shopSpots, 0.8, 7*24*time.Hour, 0.8)
	r.item("Bananas", true) // last week's, never cleared
	r.item("Milk", false)
	r.checkedAgo("bananas", 120)
	u := r.view("").UpNext
	if u == nil || u.Run != nil || u.Ready {
		t.Fatalf("old check-offs must not make a run: %+v", u)
	}
}

func TestUpNextReadyLatchesDuringRun(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.setRoute(shopSpots, 0.8, 7*24*time.Hour, 0.8) // the profile already moved on to next week
	r.item("Bananas", true)
	r.item("Milk", false)
	r.checkedAgo("bananas", 5)
	if u := r.view("").UpNext; u == nil || !u.Ready || u.Run == nil {
		t.Fatalf("a run in progress keeps it ready: %+v", u)
	}
}

func TestUpNextReadyInWindow(t *testing.T) {
	for _, c := range []struct {
		conf float64
		want bool
	}{{0.6, true}, {0.4, false}} {
		r := newSuggestRig(t, SuggestionsOn)
		r.setRoute(shopSpots, 0.8, -10*time.Minute, c.conf)
		r.item("Milk", false)
		if u := r.view("").UpNext; u == nil || u.Ready != c.want || u.Run != nil {
			t.Errorf("confidence %.1f: %+v, want ready=%v", c.conf, u, c.want)
		}
	}
}

func TestUpNextRouteMapsLookAlikes(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.setRoute(map[string]float64{"bananas": 0, "tomatoes": 0.5, "bread": 0.75}, 0.8, -10*time.Minute, 0.8)
	one := r.item("Tomato", false)
	many := r.item("Tomatoes", false)
	r.item("Paper plates", false) // no spot: never sent
	route := r.view("").UpNext.Route
	if len(route) != 2 {
		t.Fatalf("route = %+v, want the two tomato items only", route)
	}
	for _, it := range route {
		if it.Key != "tomatoes" || it.Spot != 0.5 || (it.ItemID != one && it.ItemID != many) {
			t.Errorf("item %+v should share the tomatoes spot", it)
		}
	}
}

func TestViewRejectsUnknownDuring(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	if _, err := r.svc.View(context.Background(), r.user, r.roomID, r.list, "bogus"); !errors.Is(err, derr.ErrBadRequest) {
		t.Fatalf("err = %v, want bad request", err)
	}
	if _, err := r.svc.View(context.Background(), r.user, r.roomID, r.list, DuringRun); err != nil {
		t.Fatalf("during=run: %v", err)
	}
}

// failChecked fails the run scan (item.checked) and nothing else.
type failChecked struct{ analytics.EventRepository }

func (f failChecked) ListByContainer(ctx context.Context, roomID, ct, id string, names []string, since time.Time, limit int) ([]analytics.Event, error) {
	if len(names) == 1 && names[0] == "item.checked" {
		return nil, errors.New("boom")
	}
	return f.EventRepository.ListByContainer(ctx, roomID, ct, id, names, since, limit)
}

// Up next is a nicety: when it cannot be built, the view still carries everything else.
func TestViewSurvivesUpNextFailing(t *testing.T) {
	r := newSuggestRig(t, SuggestionsOn)
	r.weekly("yogurt", r.list)
	r.fold()
	r.setRoute(shopSpots, 0.8, -10*time.Minute, 0.8)
	r.item("Milk", false)
	r.svc.events = failChecked{r.m.Events}
	v, err := r.svc.View(context.Background(), r.user, r.roomID, r.list, "")
	if err != nil {
		t.Fatalf("one failing slip must not fail the view: %v", err)
	}
	if v.UpNext != nil || !slices.Equal(v.Stack, []autopilot.Feature{autopilot.FeatureSuggestions}) {
		t.Fatalf("view = %+v", v)
	}
}
