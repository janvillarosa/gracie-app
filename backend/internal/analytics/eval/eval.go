// Package eval measures how good smart suggestions are, without touching a database: it
// replays history through the same predict code the server runs, and joins live
// predictions with what the house did next. cmd/suggest-eval is a thin shell around it.
package eval

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	"github.com/janvillarosa/gracie-app/backend/internal/parse"
)

// Series is everything one house did with one thing, in ascending time order.
type Series struct {
	Room, Key              string
	Added, Checked, Ignore []time.Time
}

// GroupEvents folds raw item events into one Series per house and key.
func GroupEvents(evs []analytics.Event) []Series {
	by := map[string]*Series{}
	var order []string
	for _, e := range evs {
		if e.Key == "" || e.RoomID == "" {
			continue
		}
		id := e.RoomID + "\x00" + e.Key
		s, ok := by[id]
		if !ok {
			s = &Series{Room: e.RoomID, Key: e.Key}
			by[id] = s
			order = append(order, id)
		}
		switch e.Name {
		case "item.added":
			s.Added = append(s.Added, e.OccurredAt)
		case "item.checked":
			s.Checked = append(s.Checked, e.OccurredAt)
		case "item.suggestion_ignored":
			s.Ignore = append(s.Ignore, e.OccurredAt)
		}
	}
	out := make([]Series, 0, len(order))
	for _, id := range order {
		s := by[id]
		for _, ts := range [][]time.Time{s.Added, s.Checked, s.Ignore} {
			sort.Slice(ts, func(i, j int) bool { return ts[i].Before(ts[j]) })
		}
		out = append(out, *s)
	}
	return out
}

// Report is the precision of the "show it when confident" policy over replayed history.
type Report struct {
	Params       predict.Params
	Series       int // series with enough history to be replayed at least once
	Qualifying   int // series that were confident at least once
	Predictions  int // every moment the policy would have shown a suggestion
	Hits         int // the next add landed inside the window
	TooLate      int // the add came before the window opened: we would have been late
	TooEarly     int // the add came after the window closed: we would have nagged
	ScoreBuckets [5]int
	WindowDays   float64 // total days the shown suggestions' windows were open (the nagging cost)
}

// AvgWindowDays is how long a shown suggestion stays up, on average.
func (r Report) AvgWindowDays() float64 {
	if r.Predictions == 0 {
		return 0
	}
	return r.WindowDays / float64(r.Predictions)
}

// Precision is hits over predictions, or 0 with none.
func (r Report) Precision() float64 {
	if r.Predictions == 0 {
		return 0
	}
	return float64(r.Hits) / float64(r.Predictions)
}

// target picks the history a series is judged on: adds when there are enough, else checks.
func target(s Series) (times []time.Time, series string) {
	if adds := predict.Collapse(s.Added); len(adds) > predict.MinSeries {
		return adds, predict.SeriesAdded
	}
	return predict.Collapse(s.Checked), predict.SeriesChecked
}

// Replay walks every series forward one occurrence at a time. At each step it forecasts the
// next occurrence from what came before, and when that forecast clears the bar it checks
// whether the occurrence landed inside the suggestion window.
func Replay(all []Series, p predict.Params) Report { return ReplayAway(all, p, nil) }

// ReplayAway is Replay in home time: away holds each house's away spans (by room id; a house
// missing from it is never away). An occurrence while the house was away is not judged (nothing
// would have been shown), but it still counts as history for the forecasts after it.
func ReplayAway(all []Series, p predict.Params, away map[string]predict.Away) Report {
	rep := Report{Params: p}
	for _, s := range all {
		times, kind := target(s)
		ha := away[s.Room]
		replayed, qualified := false, false
		for i := predict.MinOccurrences + 1; i < len(times); i++ {
			replayed = true
			if ha.Contains(times[i]) {
				continue
			}
			prefix := times[:i]
			var f predict.Forecast
			var ok bool
			ign := before(s.Ignore, times[i-1])
			if kind == predict.SeriesAdded {
				f, ok = p.PredictAway(prefix, nil, ign, ha)
			} else {
				f, ok = p.PredictAway(nil, prefix, ign, ha)
			}
			if !ok || !f.Confident(p) {
				continue
			}
			qualified = true
			rep.ScoreBuckets[min(4, int(f.Score*5))]++
			ws := f.Windows
			if len(ws) == 0 {
				ws = []predict.Span{{Opens: f.OpensAt, Closes: f.ClosesAt}}
			}
			shown, hit, late := p.Judge(ws, times[i])
			rep.Predictions += shown
			for k := 0; k < shown && k < len(ws); k++ {
				rep.WindowDays += ws[k].Closes.Sub(ws[k].Opens).Hours() / 24
			}
			switch {
			case hit:
				rep.Hits++
				rep.TooEarly += shown - 1
			case late:
				rep.TooLate++
			default:
				rep.TooEarly += shown
			}
		}
		if replayed {
			rep.Series++
		}
		if qualified {
			rep.Qualifying++
		}
	}
	return rep
}

func before(ts []time.Time, t time.Time) []time.Time {
	var out []time.Time
	for _, x := range ts {
		if x.Before(t) {
			out = append(out, x)
		}
	}
	return out
}

// Sweep replays history for each minimum score so a threshold can be picked from evidence.
func Sweep(all []Series, base predict.Params, minScores []float64) []Report {
	return SweepAway(all, base, minScores, nil)
}

// SweepAway is Sweep in home time (see ReplayAway).
func SweepAway(all []Series, base predict.Params, minScores []float64, away map[string]predict.Away) []Report {
	out := make([]Report, 0, len(minScores))
	for _, m := range minScores {
		p := base
		p.MinScore = m
		out = append(out, ReplayAway(all, p, away))
	}
	return out
}

// ShadowReport joins live predictions with what happened next.
type ShadowReport struct {
	Predictions int
	Hits        int // the next add came inside the window
	TooEarly    int // the add came after the window closed: the suggestion was premature
	Pending     int // the window has not closed and nothing was added yet
	Ignored     int // the house turned the suggestion down
	Accepted    int // an add tagged source=suggestion (mode on only)
}

func (r ShadowReport) Precision() float64 {
	if done := r.Predictions - r.Pending; done > 0 {
		return float64(r.Hits) / float64(done)
	}
	return 0
}

// Shadow scores item.suggestion_predicted events against the adds, ignores and accepts that
// followed. events may hold anything; only the relevant names are read.
func Shadow(events []analytics.Event, now time.Time) ShadowReport {
	type key struct{ room, key string }
	adds, ignores := map[key][]analytics.Event{}, map[key][]time.Time{}
	var preds []analytics.Event
	for _, e := range events {
		k := key{e.RoomID, e.Key}
		switch e.Name {
		case "item.added":
			adds[k] = append(adds[k], e)
		case "item.suggestion_ignored":
			ignores[k] = append(ignores[k], e.OccurredAt)
		case "item.suggestion_predicted":
			preds = append(preds, e)
		}
	}
	var rep ShadowReport
	for _, p := range preds {
		closes, err := time.Parse(time.RFC3339, str(p.Props["closes_at"]))
		if err != nil {
			continue
		}
		rep.Predictions++
		k := key{p.RoomID, p.Key}
		var next *analytics.Event
		for i := range adds[k] {
			if a := adds[k][i]; !a.OccurredAt.Before(p.OccurredAt) && (next == nil || a.OccurredAt.Before(next.OccurredAt)) {
				next = &adds[k][i]
			}
		}
		switch {
		case next != nil && !next.OccurredAt.After(closes):
			rep.Hits++
			if next.Props["source"] == "suggestion" {
				rep.Accepted++
			}
		case next != nil:
			rep.TooEarly++
		case now.After(closes):
			rep.TooEarly++
		default:
			rep.Pending++
		}
		for _, t := range ignores[k] {
			if !t.Before(p.OccurredAt) && !t.After(closes) {
				rep.Ignored++
				break
			}
		}
	}
	return rep
}

func str(v any) string { s, _ := v.(string); return s }

// BackfillEvents turns existing list items into the events they would have produced, so
// houses that were active before analytics existed get forecasts too. Ids are derived from
// the item and verb, so running it twice inserts nothing new. have lists "<item id>|<name>"
// pairs that already have an event; those items are skipped.
func BackfillEvents(items []models.ListItem, have map[string]bool, now time.Time, retention time.Duration) []analytics.Event {
	var out []analytics.Event
	emit := func(name string, it models.ListItem, at time.Time) {
		if at.IsZero() || have[it.ItemID+"|"+name] || at.Add(retention).Before(now) {
			return
		}
		key := parse.NormalizeKey(it.Description)
		if key == "" {
			return
		}
		sum := sha256.Sum256([]byte(it.ItemID + "\x00" + name))
		actor := it.CreatedBy
		if name == "item.checked" && it.CompletedBy != "" {
			actor = it.CompletedBy
		}
		e := analytics.Event{
			EventID: "bf_" + hex.EncodeToString(sum[:12]), Name: name, Source: "backfill", ActorID: actor, RoomID: it.RoomID,
			Subject: analytics.Ref{Type: "item", ID: it.ItemID}, Container: &analytics.Ref{Type: "list", ID: it.ListID},
			Key: key, Category: it.Category, OccurredAt: at,
		}
		analytics.Stamp(&e, now, "UTC", retention)
		out = append(out, e)
	}
	for _, it := range items {
		emit("item.added", it, it.CreatedAt)
		if it.Completed && it.CompletedAt != nil {
			emit("item.checked", it, *it.CompletedAt)
		}
	}
	return out
}
