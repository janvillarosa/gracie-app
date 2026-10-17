package services

import (
	"context"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/autopilot"
	"github.com/janvillarosa/gracie-app/backend/internal/parse"
	"github.com/janvillarosa/gracie-app/backend/internal/store"
)

const (
	// upcomingScan bounds the candidates read per request for the slip and run mode (a
	// point-indexed range).
	upcomingScan = 20
	// needsScan bounds the candidates read per list for assist.
	needsScan = 50
	// keyEventScan is how many of a thing's newest raw events the cycle check reads.
	keyEventScan = 50
)

// analyticsSignals is autopilot.Signals over the analytics reads, the raw events, the live list
// and the away calendar. It only reads.
type analyticsSignals struct {
	reader *analytics.Reader
	events analytics.EventRepository
	items  store.ListItemRepository
	away   analytics.AwayCalendar
}

func (s *AutopilotService) signals() autopilot.Signals {
	return analyticsSignals{reader: s.reader, events: s.events, items: s.items, away: s.away}
}

func listKey(listID string) string { return "list:" + listID }

func (a analyticsSignals) RunRhythm(ctx context.Context, roomID, listID string) (int, float64, error) {
	p, err := a.reader.HouseProfile(ctx, roomID)
	if err != nil || p == nil {
		return 0, 0, err
	}
	c := p.Containers[listKey(listID)]
	return c.Runs, c.IntervalDay, nil
}

func (a analyticsSignals) RunPlan(ctx context.Context, roomID, listID string, now time.Time) (*autopilot.RunPlan, error) {
	rp, err := a.reader.RunPlan(ctx, roomID, listKey(listID), now)
	if err != nil || rp == nil {
		return nil, err
	}
	return &autopilot.RunPlan{
		Next:       autopilot.Window{Start: rp.Next.Start, End: rp.Next.End},
		After:      autopilot.Window{Start: rp.After.Start, End: rp.After.End},
		Confidence: rp.Confidence,
	}, nil
}

func (a analyticsSignals) Away(ctx context.Context, roomID string) (predict.Away, error) {
	if a.away == nil {
		return nil, nil
	}
	away, err := a.away.HouseAway(ctx, roomID)
	return away.Normalize(), err
}

func (a analyticsSignals) Candidates(ctx context.Context, roomID, listID string, h autopilot.Horizon, now, until time.Time, away predict.Away) ([]autopilot.Candidate, error) {
	if h != autopilot.HorizonRunAfterNext {
		stats, err := a.reader.Upcoming(ctx, roomID, "item", now, until, upcomingScan)
		if err != nil {
			return nil, err
		}
		out := make([]autopilot.Candidate, 0, len(stats))
		for _, st := range stats {
			if c, ok := toCandidate(st); ok {
				out = append(out, c)
			}
		}
		return out, nil
	}
	needs, err := a.reader.NeedsBefore(ctx, roomID, listKey(listID), until, away, needsScan)
	if err != nil {
		return nil, err
	}
	out := make([]autopilot.Candidate, 0, len(needs))
	for _, n := range needs {
		if n.Stat.SubjectType != "item" {
			continue
		}
		if c, ok := toCandidate(n.Stat); ok {
			c.NeedBy = n.P
			out = append(out, c)
		}
	}
	return out, nil
}

func toCandidate(st analytics.KeyStat) (autopilot.Candidate, bool) {
	if st.Intervals == nil || st.Intervals.Add == nil {
		return autopilot.Candidate{}, false
	}
	add := st.Intervals.Add
	c := autopilot.Candidate{
		Key: st.Key, Category: st.Category, Containers: st.Containers,
		Series: add.Series, Score: add.Score, CV: add.CV, Trials: add.Trials, EveryDays: add.EWMADays,
		LastAt: add.LastAt, OpensAt: add.OpensAt, ClosesAt: add.ClosesAt,
	}
	for _, w := range add.Windows {
		c.Windows = append(c.Windows, predict.Span{Opens: w.Opens, Closes: w.Closes})
	}
	return c, true
}

func toKeyEvents(evs []analytics.Event) []autopilot.KeyEvent {
	out := make([]autopilot.KeyEvent, len(evs))
	for i, e := range evs {
		during, _ := e.Props["during"].(string)
		out[i] = autopilot.KeyEvent{Name: e.Name, At: e.OccurredAt, During: during}
	}
	return out
}

func (a analyticsSignals) Reactions(ctx context.Context, roomID, listID string, since time.Time, limit int) ([]autopilot.KeyEvent, error) {
	evs, err := a.events.ListByContainer(ctx, roomID, "list", listID, autopilot.ReactionEvents, since, limit)
	if err != nil {
		return nil, err
	}
	return toKeyEvents(evs), nil
}

func (a analyticsSignals) OnList(ctx context.Context, listID string) ([]string, error) {
	items, err := a.items.ListByList(ctx, listID)
	if err != nil {
		return nil, err
	}
	// Only what is still to get counts as on the list. A checked item was bought: many houses
	// never clear their list, so checked rows pile up and would otherwise block every proposal.
	// A purchase in the current cycle is caught by the cycle check instead.
	keys := make([]string, 0, len(items))
	for _, it := range items {
		if !it.IsArchived && !it.Completed {
			keys = append(keys, parse.NormalizeKey(it.Description))
		}
	}
	return keys, nil
}

func (a analyticsSignals) KeyEvents(ctx context.Context, roomID, key string) ([]autopilot.KeyEvent, error) {
	evs, err := a.events.ListForKey(ctx, roomID, "item", key, keyEventScan)
	if err != nil {
		return nil, err
	}
	return toKeyEvents(evs), nil
}

func (a analyticsSignals) Usual(ctx context.Context, roomID string, keys []string) (map[string]autopilot.Usual, error) {
	items, err := a.items.ListByRoom(ctx, roomID)
	if err != nil {
		return nil, err
	}
	pantry, _ := pantryByKey(items)
	out := make(map[string]autopilot.Usual, len(keys))
	for _, k := range keys {
		if p := displayFor(pantry, k); p != nil {
			out[k] = autopilot.Usual{Display: p.Description, Quantity: p.Quantity, Unit: p.Unit, Category: p.Category}
		}
	}
	return out, nil
}

// displayFor picks how to show key: the most recent wording the house used for it or any
// look-alike ("Oranges" if that is what they typed last), with that item's usual quantity.
func displayFor(pantry map[string]*PantryItem, key string) *PantryItem {
	best := pantry[key]
	for k, p := range pantry {
		if k == key || !parse.Similar(key, k) {
			continue
		}
		if best == nil || p.LastAddedAt.After(best.LastAddedAt) {
			best = p
		}
	}
	return best
}
