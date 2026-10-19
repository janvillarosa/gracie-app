package services

import (
	"context"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/autopilot"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/parse"
)

// How far back to read check-offs when looking for the run in progress, and how many.
const (
	upNextRunLookback = 6 * time.Hour
	upNextRunScan     = 200
)

// UpNextView is what the List page needs to name the item the house usually grabs next: the
// house's learned route over the live list, and the run in progress. The page applies the pick
// rule itself (autopilot.PickUpNext's twin) so a check-off hands off at once.
type UpNextView struct {
	// Ready is true when the house is probably shopping now: a run is in progress, or the usual
	// run window is open with enough confidence.
	Ready bool `json:"ready"`
	// Run is the run in progress, from every member's check-offs, if any.
	Run *UpNextRun `json:"run,omitempty"`
	// Route is every live item that has a spot on the route, checked or not.
	Route []autopilot.RouteItem `json:"route"`
}

// UpNextRun is the current run: when it began and the last item checked in it that has a spot.
type UpNextRun struct {
	StartedAt    time.Time `json:"started_at"`
	AnchorItemID string    `json:"anchor_item_id,omitempty"`
}

// upNext builds the Up next view for a list, or nil when the house does not have the feature,
// its route is not good enough to trust, or nothing on the list has a spot yet to be named.
func (s *AutopilotService) upNext(ctx context.Context, room *models.Room, roomID, listID string) (*UpNextView, error) {
	if !s.enabled() || !autopilot.Has(houseMode(room), autopilot.FeatureUpNext) {
		return nil, nil
	}
	prof, err := s.reader.HouseProfile(ctx, roomID)
	if err != nil || prof == nil {
		return nil, err
	}
	rhythm := prof.Containers["list:"+listID]
	if !s.policy.RouteClears(rhythm.Route) {
		return nil, nil
	}
	items, err := s.items.ListByList(ctx, listID)
	if err != nil {
		return nil, err
	}
	route := routeItems(items, rhythm.Route.Spots)
	named := false
	for _, it := range route {
		named = named || !it.Done
	}
	if !named {
		return nil, nil
	}
	now := s.now()
	run, err := s.currentRun(ctx, roomID, listID, route, now)
	if err != nil {
		return nil, err
	}
	ready := run != nil
	if w := rhythm.NextRun; !ready && w != nil {
		ready = !now.Before(w.Start) && !now.After(w.End) && w.Confidence >= s.policy.MinRunConfidence
	}
	return &UpNextView{Ready: ready, Run: run, Route: route}, nil
}

// routeItems maps the live items onto the route's spots. A look-alike name ("tomato", "tomatoes")
// takes the spot of the thing the route learned it as; items with no spot are left out.
func routeItems(items []models.ListItem, spots map[string]float64) []autopilot.RouteItem {
	var out []autopilot.RouteItem
	for _, it := range items {
		if it.IsArchived {
			continue
		}
		key, spot, ok := spotFor(parse.NormalizeKey(it.Description), spots)
		if !ok {
			continue
		}
		out = append(out, autopilot.RouteItem{ItemID: it.ItemID, Key: key, Spot: spot, Done: it.Completed})
	}
	return out
}

// spotFor finds a name's spot: exact first, then the look-alike with the highest similarity.
func spotFor(name string, spots map[string]float64) (key string, spot float64, ok bool) {
	if sp, found := spots[name]; found {
		return name, sp, true
	}
	best := 0.0
	for k, sp := range spots {
		if sim := parse.Similarity(k, name); sim >= parse.SimilarThreshold && (sim > best || (sim == best && k < key)) {
			best, key, spot, ok = sim, k, sp, true
		}
	}
	return key, spot, ok
}

// currentRun reads the list's check-offs, newest first, while they chain (no gap above
// predict.RunGap and the newest is itself that recent). Earlier check-offs, such as last week's
// items that were never cleared, are never part of it. The anchor is the newest check-off that
// matches a checked item on the route.
func (s *AutopilotService) currentRun(ctx context.Context, roomID, listID string, route []autopilot.RouteItem, now time.Time) (*UpNextRun, error) {
	evs, err := s.events.ListByContainer(ctx, roomID, "list", listID, []string{"item.checked"}, now.Add(-upNextRunLookback), upNextRunScan)
	if err != nil || len(evs) == 0 || now.Sub(evs[0].OccurredAt) > predict.RunGap {
		return nil, err
	}
	run := &UpNextRun{StartedAt: evs[0].OccurredAt}
	prev := evs[0].OccurredAt
	for _, e := range evs {
		if prev.Sub(e.OccurredAt) > predict.RunGap {
			break
		}
		prev, run.StartedAt = e.OccurredAt, e.OccurredAt
		if run.AnchorItemID == "" {
			run.AnchorItemID = anchorFor(e, route)
		}
	}
	return run, nil
}

// anchorFor is the checked route item an event was about, "" when there is none.
func anchorFor(e analytics.Event, route []autopilot.RouteItem) string {
	for _, it := range route {
		if it.Done && (it.Key == e.Key || parse.Similar(it.Key, e.Key)) {
			return it.ItemID
		}
	}
	return ""
}

// slipStack lists which autopilot slips this list has something to show for, front to back
// (autopilot.SlipOrder). Autopilot floats one slip at a time; the page draws the first and lets
// the rest peek beneath it.
func slipStack(mode autopilot.Mode, v *AutopilotView) []autopilot.Feature {
	has := map[autopilot.Feature]bool{
		autopilot.FeatureUpNext:      v.UpNext != nil,
		autopilot.FeatureAutoAdd:     len(v.Applied) > 0,
		autopilot.FeatureSuggestions: len(v.Suggestions) > 0,
	}
	out := []autopilot.Feature{}
	for _, f := range autopilot.SlipOrder {
		if autopilot.Has(mode, f) && has[f] {
			out = append(out, f)
		}
	}
	return out
}
