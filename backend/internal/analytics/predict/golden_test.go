package predict

import (
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"testing"
	"time"
)

var updateGolden = flag.Bool("update", false, "rewrite testdata/*.golden.json from the current code")

// goldenSeries is a fixed, seeded spread of histories: steady and jittery rhythms, skipped
// weeks, bursts, changed habits, check-only houses and ignores.
func goldenSeries() [][3][]time.Time {
	rng := rand.New(rand.NewSource(20261017))
	var out [][3][]time.Time
	for i := 0; i < 60; i++ {
		gap := []float64{1, 3, 7, 7, 7, 10, 14, 30}[i%8]
		jitter := []float64{0, 0.1, 0.3, 0.6}[i%4]
		n := 3 + rng.Intn(20)
		var added, checked, ignores []time.Time
		d := rng.Float64() * 3
		for k := 0; k < n; k++ {
			if rng.Float64() < 0.15 { // a skipped cycle
				d += gap
			}
			d += gap * (1 + jitter*(rng.Float64()*2-1))
			if i%5 != 0 {
				added = append(added, at(d))
			}
			if rng.Float64() < 0.8 {
				checked = append(checked, at(d+0.5+rng.Float64()))
			}
			if rng.Float64() < 0.05 {
				ignores = append(ignores, at(d-0.5))
			}
			if rng.Float64() < 0.1 { // a burst
				added = append(added, at(d+0.01))
			}
		}
		out = append(out, [3][]time.Time{added, checked, ignores})
	}
	return out
}

type goldenRow struct {
	Params   string
	OK       bool
	Forecast Forecast
}

func goldenRows(predict func(p Params, added, checked, ignores []time.Time) (Forecast, bool)) []goldenRow {
	var rows []goldenRow
	for _, s := range goldenSeries() {
		for _, np := range []struct {
			name string
			p    Params
		}{{"default", DefaultParams}, {"classic", ClassicParams}} {
			f, ok := predict(np.p, s[0], s[1], s[2])
			rows = append(rows, goldenRow{np.name, ok, f})
		}
	}
	return rows
}

func checkGolden(t *testing.T, name string, rows any) {
	t.Helper()
	got, err := json.MarshalIndent(rows, "", " ")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join("testdata", name+".golden.json")
	if *updateGolden {
		if err := os.WriteFile(path, got, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var g, w any
	if err := json.Unmarshal(got, &g); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(want, &w); err != nil {
		t.Fatal(err)
	}
	if diff := sameJSON("", g, w); diff != "" {
		t.Fatalf("%s differs from the golden at %s (a house that never travels must get the same forecasts)", path, diff)
	}
}

// sameJSON compares two decoded JSON trees exactly, except that numbers may differ by one part in
// a billion and timestamps by a microsecond: arm64 fuses multiply-adds and amd64 does not, so the
// last bit of a float (and a nanosecond of a time computed from one) differs between a Mac and CI.
// It returns the path of the first difference, or "".
func sameJSON(path string, a, b any) string {
	switch x := a.(type) {
	case map[string]any:
		y, ok := b.(map[string]any)
		if !ok || len(x) != len(y) {
			return path
		}
		for k, v := range x {
			if d := sameJSON(path+"."+k, v, y[k]); d != "" {
				return d
			}
		}
	case []any:
		y, ok := b.([]any)
		if !ok || len(x) != len(y) {
			return path
		}
		for i := range x {
			if d := sameJSON(fmt.Sprintf("%s[%d]", path, i), x[i], y[i]); d != "" {
				return d
			}
		}
	case float64:
		y, ok := b.(float64)
		if !ok || math.Abs(x-y) > 1e-9*math.Max(1, math.Max(math.Abs(x), math.Abs(y))) {
			return path
		}
	case string:
		y, ok := b.(string)
		if !ok {
			return path
		}
		if x == y {
			return ""
		}
		tx, err1 := time.Parse(time.RFC3339Nano, x)
		ty, err2 := time.Parse(time.RFC3339Nano, y)
		if err1 != nil || err2 != nil {
			return path
		}
		if d := tx.Sub(ty); d > time.Microsecond || d < -time.Microsecond {
			return path
		}
	default:
		if a != b {
			return path
		}
	}
	return ""
}

// TestPredictNoAwayUnchanged pins the forecasts of houses that never travel.
func TestPredictNoAwayUnchanged(t *testing.T) {
	checkGolden(t, "predict", goldenRows(func(p Params, a, c, i []time.Time) (Forecast, bool) {
		return p.Predict(a, c, i)
	}))
}

type rhythmRow struct {
	Rhythm Rhythm
	Due    time.Time
	DueOK  bool
	Window Window
	WinOK  bool
}

func rhythmRows(intervals func([]time.Time) Rhythm, due func(Rhythm) (time.Time, bool), next func(Rhythm, Histogram, *time.Location, time.Time) (Window, bool)) []rhythmRow {
	loc, _ := time.LoadLocation("Europe/Lisbon")
	var rows []rhythmRow
	for _, s := range goldenSeries() {
		var occ []Occurrence
		for _, t := range s[1] {
			l := t.In(loc)
			occ = append(occ, Occurrence{At: t, HOW: int(l.Weekday())*24 + l.Hour()})
		}
		r := intervals(s[1])
		now := r.Last.Add(36 * time.Hour)
		h := HOWHistogram(occ, now)
		d, dok := due(r)
		w, wok := next(r, h, loc, now)
		rows = append(rows, rhythmRow{r, d, dok, w, wok})
	}
	return rows
}

// TestRhythmNoAwayUnchanged pins rhythms, due dates and next windows of houses that never travel.
func TestRhythmNoAwayUnchanged(t *testing.T) {
	checkGolden(t, "rhythm", rhythmRows(Intervals, Rhythm.Due, NextWindow))
}

func TestSameJSONToleratesOnlyFloatNoise(t *testing.T) {
	dec := func(s string) any {
		var v any
		if err := json.Unmarshal([]byte(s), &v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	base := `{"d":1.118808362787764,"t":"2026-02-26T10:12:56.332921335Z","s":"added","ok":true}`
	if d := sameJSON("", dec(base), dec(`{"d":1.1188083627877643,"t":"2026-02-26T10:12:56.332921336Z","s":"added","ok":true}`)); d != "" {
		t.Fatalf("last-bit noise must pass, failed at %s", d)
	}
	for _, other := range []string{
		`{"d":1.1189,"t":"2026-02-26T10:12:56.332921335Z","s":"added","ok":true}`,
		`{"d":1.118808362787764,"t":"2026-02-26T10:12:57.332921335Z","s":"added","ok":true}`,
		`{"d":1.118808362787764,"t":"2026-02-26T10:12:56.332921335Z","s":"checked","ok":true}`,
		`{"d":1.118808362787764,"t":"2026-02-26T10:12:56.332921335Z","s":"added","ok":false}`,
	} {
		if sameJSON("", dec(base), dec(other)) == "" {
			t.Fatalf("a real change must fail: %s", other)
		}
	}
}
