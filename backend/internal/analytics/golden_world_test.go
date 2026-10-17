package analytics_test

import (
	"context"
	"encoding/json"
	"flag"
	"math"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/eval"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/households"
	"github.com/janvillarosa/gracie-app/backend/internal/testutil/memstore"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
)

var updateWorld = flag.Bool("update", false, "rewrite testdata/world.golden.json")

// learnedWorld folds the golden households through the real worker (with their away calendar)
// and recomputes every profile, as production would by households.End.
func learnedWorld(t *testing.T) (households.World, *memstore.AggRepo) {
	t.Helper()
	w := households.Golden()
	reg := registry()
	trips.RegisterAnalyticsEvents(reg)
	events, aggs := memstore.NewEventRepo(), memstore.NewAggRepo()
	if err := events.InsertMany(context.Background(), w.Events); err != nil {
		t.Fatal(err)
	}
	now := households.End
	worker := analytics.NewWorker(events, aggs, reg).WithClock(func() time.Time { return now }).WithAway(w.Calendar())
	for {
		n, err := worker.FoldOnce(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if n == 0 {
			break
		}
	}
	for {
		n, err := worker.ProfilePass(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if n == 0 {
			break
		}
	}
	return w, aggs
}

type keyRow struct {
	Key       string          `json:"key"`
	Kind      string          `json:"kind"`
	N         int             `json:"n"`
	Source    string          `json:"source"`
	Days      float64         `json:"days"`
	CV        float64         `json:"cv"`
	Series    string          `json:"series,omitempty"`
	Clock     string          `json:"clock,omitempty"`
	Score     float64         `json:"score,omitempty"`
	Confident bool            `json:"confident"`
	Due       string          `json:"due,omitempty"`
	Weekly    *predict.Weekly `json:"weekly,omitempty"`
	NextTurn  string          `json:"next_turn,omitempty"`
}

type houseRow struct {
	Persona string         `json:"persona"`
	Away    int            `json:"away_spans"`
	Keys    []keyRow       `json:"keys"`
	Runs    map[string]any `json:"runs,omitempty"`
}

func round(x float64) float64 { return math.Round(x*1000) / 1000 }

func snapshot(w households.World, aggs *memstore.AggRepo) []houseRow {
	var out []houseRow
	for _, h := range w.Houses {
		row := houseRow{Persona: h.Persona, Away: len(h.Away())}
		for _, e := range h.Expect {
			doc := aggs.Key(h.Room + ":item:" + e.Key)
			iv, _ := doc["intervals"].(analytics.KeyIntervals)
			k := keyRow{Key: e.Key, Kind: string(e.Kind), N: iv.N, Source: iv.Source, Days: round(iv.EWMADays), CV: round(iv.CV), Weekly: iv.Weekly,
				NextTurn: predict.NextTurn(iv.Turns, h.Members)}
			if iv.Add != nil {
				f := predict.Forecast{Trials: iv.Add.Trials, Score: iv.Add.Score, CV: iv.Add.CV}
				k.Series, k.Clock, k.Score, k.Confident = iv.Add.Series, iv.Add.Clock, round(iv.Add.Score), f.Confident(predict.DefaultParams)
				k.Due = iv.Add.DueAt.Format(time.RFC3339)
			}
			row.Keys = append(row.Keys, k)
		}
		if p, err := aggs.GetProfile(context.Background(), "h:"+h.Room); err == nil && p != nil {
			row.Runs = map[string]any{}
			names := make([]string, 0, len(p.Containers))
			for c := range p.Containers {
				names = append(names, c)
			}
			sort.Strings(names)
			for _, c := range names {
				cr := p.Containers[c]
				r := map[string]any{"runs": cr.Runs, "interval_days": round(cr.IntervalDay), "cv": round(cr.CV)}
				if cr.NextRun != nil {
					r["next"] = cr.NextRun.Start.Format(time.RFC3339)
				}
				row.Runs[c[len("list:"+h.Room+"_"):]] = r
			}
		}
		out = append(out, row)
	}
	return out
}

// TestGoldenWorld pins what the engine learns from the golden households. A change to the
// forecast, the fold or the dataset shows up here as a diff to review: rerun with -update and
// read the diff of testdata/world.golden.json before committing it.
func TestGoldenWorld(t *testing.T) {
	w, aggs := learnedWorld(t)
	series := eval.GroupEvents(w.Events)
	wall := eval.Replay(series, predict.DefaultParams)
	home := eval.ReplayAway(series, predict.DefaultParams, w.Away())
	golden := map[string]any{
		"houses": snapshot(w, aggs),
		"eval": map[string]any{
			"wall": map[string]any{"predictions": wall.Predictions, "hits": wall.Hits, "late": wall.TooLate, "early": wall.TooEarly, "qualifying": wall.Qualifying, "precision": round(wall.Precision())},
			"home": map[string]any{"predictions": home.Predictions, "hits": home.Hits, "late": home.TooLate, "early": home.TooEarly, "qualifying": home.Qualifying, "precision": round(home.Precision())},
		},
	}
	got, err := json.MarshalIndent(golden, "", " ")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join("testdata", "world.golden.json")
	if *updateWorld {
		if err := os.MkdirAll("testdata", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(got, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(append(got, '\n')) != string(want) {
		t.Fatalf("what the engine learns from the golden households changed; rerun with -update and review the diff of %s", path)
	}
}

// TestGoldenWorldBehaves asserts the personas' intent, independent of exact numbers.
func TestGoldenWorldBehaves(t *testing.T) {
	w, aggs := learnedWorld(t)
	staples, confident := 0, 0
	for _, h := range w.Houses {
		for _, e := range h.Expect {
			iv, _ := aggs.Key(h.Room + ":item:" + e.Key)["intervals"].(analytics.KeyIntervals)
			ok := iv.Add != nil && (predict.Forecast{Trials: iv.Add.Trials, Score: iv.Add.Score, CV: iv.Add.CV}).Confident(predict.DefaultParams)
			switch e.Kind {
			case households.Staple:
				staples++
				if ok {
					confident++
				}
			case households.Calendar:
				if len(e.Turns) > 0 {
					last := iv.LastBy
					want := e.Turns[0]
					if last == e.Turns[0] {
						want = e.Turns[1]
					}
					if got := predict.NextTurn(iv.Turns, h.Members); got != want {
						t.Errorf("%s/%s: %s did it last, so it is %s's turn; got %q (turns %v)", h.Persona, e.Key, last, want, got, iv.Turns)
					}
				}
				wk := iv.Weekly
				if wk == nil || wk.EveryWeeks != e.EveryWeeks || wk.Weekday != e.Weekday || wk.Hour != e.Hour {
					t.Errorf("%s/%s should follow the calendar %d/%d/%d: %+v", h.Persona, e.Key, e.EveryWeeks, e.Weekday, e.Hour, wk)
				}
			case households.Irregular, households.Thin, households.OneOff:
				if ok {
					t.Errorf("%s/%s (%s) must never be suggested: %+v", h.Persona, e.Key, e.Kind, iv.Add)
				}
			}
		}
	}
	// Staples with a wobbly rhythm (a fortnightly coffee that is sometimes 10 days, sometimes
	// 18) are honestly not confident yet; this is the floor, the golden file pins the exact set.
	if float64(confident) < 0.55*float64(staples) {
		t.Errorf("only %d of %d staples became confident", confident, staples)
	}
	// Measuring in home time (where it backtests better) must not cost hits or items, and may
	// not cost more than half a point of precision on the golden households.
	series := eval.GroupEvents(w.Events)
	wall, home := eval.Replay(series, predict.DefaultParams), eval.ReplayAway(series, predict.DefaultParams, w.Away())
	if home.Hits < wall.Hits || home.Qualifying < wall.Qualifying || home.Precision() < wall.Precision()-0.005 {
		t.Errorf("home %d hits %.3f (%d items) vs wall %d hits %.3f (%d items)", home.Hits, home.Precision(), home.Qualifying, wall.Hits, wall.Precision(), wall.Qualifying)
	}
}
