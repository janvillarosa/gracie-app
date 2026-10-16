// Command suggest-eval measures smart suggestions before and after they go live.
//
//	suggest-eval backtest   replay every house's history and print precision + a MinScore sweep
//	suggest-eval shadow     score live item.suggestion_predicted events against what happened next
//	suggest-eval backfill   turn existing list items into events (dry run unless -apply)
//	suggest-eval tune       replay history across a grid of window, regularity and score settings
//
// It reads the same MONGODB_URI / MONGODB_DB as the server. backtest and shadow only read.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"sort"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/eval"
	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/config"
	"github.com/janvillarosa/gracie-app/backend/internal/models"
	mongostore "github.com/janvillarosa/gracie-app/backend/internal/store/mongo"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	cmd, args := os.Args[1], os.Args[2:]
	fs := flag.NewFlagSet(cmd, flag.ExitOnError)
	apply := fs.Bool("apply", false, "backfill: write the events (default is a dry run)")
	room := fs.String("room", "", "limit to one house id")
	minPrecision := fs.Float64("min-precision", 0.6, "tune: only list settings at least this precise")
	_ = fs.Parse(args)

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	ctx := context.Background()
	cli, err := mongostore.New(ctx, cfg.MongoURI, cfg.MongoDB)
	if err != nil {
		log.Fatalf("mongo: %v", err)
	}
	defer func() { _ = cli.Close(ctx) }()

	switch cmd {
	case "backtest":
		backtest(ctx, cli, *room)
	case "shadow":
		shadow(ctx, cli, *room)
	case "explain":
		explain(ctx, cli, *room)
	case "tune":
		tune(ctx, cli, *room, *minPrecision)
	case "backfill":
		backfill(ctx, cli, *room, *apply, time.Duration(cfg.AnalyticsRetentionDays)*24*time.Hour)
	default:
		usage()
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: suggest-eval backtest|shadow|tune|backfill [-room ID] [-apply] [-min-precision 0.6]")
	os.Exit(2)
}

func roomFilter(room string, extra bson.D) bson.D {
	if room != "" {
		extra = append(extra, bson.E{Key: "room_id", Value: room})
	}
	return extra
}

func loadEvents(ctx context.Context, cli *mongostore.Client, filter bson.D) []analytics.Event {
	cur, err := cli.DB.Collection("events").Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "occurred_at", Value: 1}}))
	if err != nil {
		log.Fatalf("read events: %v", err)
	}
	var evs []analytics.Event
	if err := cur.All(ctx, &evs); err != nil {
		log.Fatalf("decode events: %v", err)
	}
	return evs
}

func backtest(ctx context.Context, cli *mongostore.Client, room string) {
	evs := loadEvents(ctx, cli, roomFilter(room, bson.D{{Key: "subject.type", Value: "item"},
		{Key: "name", Value: bson.D{{Key: "$in", Value: bson.A{"item.added", "item.checked", "item.suggestion_ignored"}}}}}))
	series := eval.GroupEvents(evs)
	fmt.Printf("%d events, %d (house, item) series\n\n", len(evs), len(series))
	cur := eval.Replay(series, predict.DefaultParams)
	fmt.Printf("policy MinScore=%.2f MaxCV=%.2f\n", cur.Params.MinScore, cur.Params.MaxCV)
	fmt.Printf("  replayable series: %d, qualifying at least once: %d\n", cur.Series, cur.Qualifying)
	fmt.Printf("  predictions: %d  hits: %d  too late: %d  too early: %d  precision: %.1f%%\n", cur.Predictions, cur.Hits, cur.TooLate, cur.TooEarly, 100*cur.Precision())
	fmt.Printf("  score distribution (0.0-0.2 ... 0.8-1.0): %v\n\n", cur.ScoreBuckets)
	fmt.Println("MinScore sweep:")
	for _, r := range eval.Sweep(series, predict.DefaultParams, []float64{0.4, 0.5, 0.6, 0.65, 0.7, 0.8, 0.9}) {
		fmt.Printf("  %.2f  predictions %5d  precision %5.1f%%  qualifying %4d\n", r.Params.MinScore, r.Predictions, 100*r.Precision(), r.Qualifying)
	}
}

func shadow(ctx context.Context, cli *mongostore.Client, room string) {
	evs := loadEvents(ctx, cli, roomFilter(room, bson.D{{Key: "subject.type", Value: "item"},
		{Key: "name", Value: bson.D{{Key: "$in", Value: bson.A{"item.added", "item.suggestion_ignored", "item.suggestion_predicted"}}}}}))
	rep := eval.Shadow(evs, time.Now().UTC())
	fmt.Printf("live predictions: %d (still pending: %d)\n", rep.Predictions, rep.Pending)
	fmt.Printf("  hits: %d  premature: %d  ignored: %d  accepted: %d\n", rep.Hits, rep.TooEarly, rep.Ignored, rep.Accepted)
	fmt.Printf("  precision: %.1f%%\n", 100*rep.Precision())
	fmt.Println("go-live gate: precision >= 70% over >= 50 settled predictions across >= 2 weeks")
}

func backfill(ctx context.Context, cli *mongostore.Client, room string, apply bool, retention time.Duration) {
	cur, err := cli.DB.Collection("list_items").Find(ctx, roomFilter(room, bson.D{}))
	if err != nil {
		log.Fatalf("read items: %v", err)
	}
	var items []models.ListItem
	if err := cur.All(ctx, &items); err != nil {
		log.Fatalf("decode items: %v", err)
	}
	have := map[string]bool{}
	for _, e := range loadEvents(ctx, cli, roomFilter(room, bson.D{{Key: "subject.type", Value: "item"},
		{Key: "name", Value: bson.D{{Key: "$in", Value: bson.A{"item.added", "item.checked"}}}}})) {
		have[e.Subject.ID+"|"+e.Name] = true
	}
	evs := eval.BackfillEvents(items, have, time.Now().UTC(), retention)
	fmt.Printf("%d items, %d already have events, %d events to write\n", len(items), len(have), len(evs))
	if !apply {
		fmt.Println("dry run: pass -apply to write them (safe to repeat: ids are deterministic)")
		return
	}
	if err := mongostore.NewEventRepo(cli).InsertMany(ctx, evs); err != nil {
		log.Fatalf("insert: %v", err)
	}
	fmt.Println("written; the next fold recomputes the affected keys")
}

// tune replays the history across a grid of model and window settings, always at the default
// confidence bar (MinScore) and regularity limit (MaxCV), and lists the settings that are precise
// enough: most items covered first, then the shortest windows (the least nagging). For the best
// strict setting it also lists what would be suggested today.
func tune(ctx context.Context, cli *mongostore.Client, room string, minPrecision float64) {
	evs := loadEvents(ctx, cli, roomFilter(room, bson.D{{Key: "subject.type", Value: "item"},
		{Key: "name", Value: bson.D{{Key: "$in", Value: bson.A{"item.added", "item.checked", "item.suggestion_ignored"}}}}}))
	series := eval.GroupEvents(evs)
	day := 24 * time.Hour
	var rows []eval.Report
	for _, median := range []bool{false, true} {
		for _, recent := range []int{0, 6, 8, 12} {
			if !median && recent > 0 {
				continue
			}
			for _, skips := range []int{0, 2, 3, 4} {
				for _, strict := range []bool{true, false} {
					for _, cycles := range []int{0, 8, 12, 16} {
						for _, lead := range []float64{0.2, 0.35, 0.5} {
							for _, grace := range []float64{0.1, 0.25, 0.4} {
								for _, maxLead := range []float64{2, 3} {
									for _, maxGrace := range []float64{1, 2} {
										for _, jitter := range []float64{0, 1, 2} {
											p := predict.DefaultParams
											p.MedianCadence, p.RecentGaps, p.Skips, p.StrictSkips = median, recent, skips, strict
											p.LeadFrac, p.GraceFrac = lead, grace
											p.MaxLead = time.Duration(maxLead * float64(day))
											p.MaxGrace = time.Duration(maxGrace * float64(day))
											p.MaxJitterGrace = p.MaxGrace
											p.JitterK = jitter
											p.RecentCycles = cycles
											rows = append(rows, eval.Replay(series, p))
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}
	cur := eval.Replay(series, predict.DefaultParams)
	fmt.Printf("%d series, bar MinScore %.2f MaxCV %.2f. current: qualifying %d, precision %.0f%%\n\n",
		cur.Series, predict.DefaultParams.MinScore, predict.DefaultParams.MaxCV, cur.Qualifying, 100*cur.Precision())
	for _, strict := range []bool{true, false} {
		var good []eval.Report
		for _, r := range rows {
			if r.Params.StrictSkips == strict && r.Predictions >= 5 && r.Precision() >= minPrecision {
				good = append(good, r)
			}
		}
		sort.Slice(good, func(i, j int) bool {
			if good[i].Qualifying != good[j].Qualifying {
				return good[i].Qualifying > good[j].Qualifying
			}
			if a, b := good[i].Precision(), good[j].Precision(); a != b {
				return a > b
			}
			return good[i].AvgWindowDays() < good[j].AvgWindowDays()
		})
		label := "lenient (one trial per cycle)"
		if strict {
			label = "STRICT (every shown window without an add is a miss)"
		}
		fmt.Printf("%s, precision >= %.0f%%:\n", label, 100*minPrecision)
		fmt.Println("items  prec  preds  window  median recent skips cycles  lead grace maxLead maxGrace jitter")
		for i, r := range good {
			if i == 12 {
				break
			}
			p := r.Params
			fmt.Printf("%5d  %3.0f%%  %5d  %5.1fd  %6v %6d %5d %6d  %4.2f  %4.2f  %5.0fd  %6.0fd  %5.1f\n",
				r.Qualifying, 100*r.Precision(), r.Predictions, r.AvgWindowDays(),
				p.MedianCadence, p.RecentGaps, p.Skips, p.RecentCycles, p.LeadFrac, p.GraceFrac, p.MaxLead.Hours()/24, p.MaxGrace.Hours()/24, p.JitterK)
		}
		if len(good) == 0 {
			fmt.Println("(none)")
			continue
		}
		today(series, good[0].Params)
		fmt.Println()
	}
}

// today lists what the given settings would suggest now, from the full history.
func today(series []eval.Series, p predict.Params) {
	now := time.Now().UTC()
	fmt.Println("  confident items under the best setting (* = window open now):")
	for _, s := range series {
		f, ok := p.Predict(s.Added, s.Checked, s.Ignore)
		if !ok || !f.Confident(p) {
			continue
		}
		mark := " "
		if f.OpenAt(now) {
			mark = "*"
		}
		next := ""
		for _, w := range f.Windows {
			next += fmt.Sprintf(" %s..%s", w.Opens.Format("01-02"), w.Closes.Format("01-02"))
		}
		fmt.Printf("  %s %-22s score %.2f  every %.1fd  cv %.2f  hits %d/%d  windows%s\n", mark, s.Key, f.Score, f.EWMADays, f.CV, f.Hits, f.Trials, next)
	}
}

// explain prints every item's forecast under the widest skip-aware setting, best first, whether
// or not it clears the bar, so it is clear what holds an item back.
func explain(ctx context.Context, cli *mongostore.Client, room string) {
	evs := loadEvents(ctx, cli, roomFilter(room, bson.D{{Key: "subject.type", Value: "item"},
		{Key: "name", Value: bson.D{{Key: "$in", Value: bson.A{"item.added", "item.checked", "item.suggestion_ignored"}}}}}))
	p := predict.DefaultParams
	p.MedianCadence, p.RecentGaps, p.Skips = true, 20, 4
	p.LeadFrac, p.GraceFrac = 0.5, 0.4
	p.MaxLead, p.MaxGrace, p.MaxJitterGrace = 3*24*time.Hour, 2*24*time.Hour, 2*24*time.Hour
	type row struct {
		key string
		f   predict.Forecast
	}
	var rows []row
	for _, s := range eval.GroupEvents(evs) {
		if f, ok := p.Predict(s.Added, s.Checked, s.Ignore); ok {
			rows = append(rows, row{s.Key, f})
		}
		if s.Key == os.Getenv("EXPLAIN_KEY") {
			kept := predict.Collapse(s.Added)
			for i := predict.MinOccurrences; i < len(kept); i++ {
				f, ok := p.Predict(kept[:i], nil, nil)
				if !ok {
					continue
				}
				_, hit, late := p.Judge(f.Windows, kept[i])
				gap := kept[i].Sub(kept[i-1]).Hours() / 24
				fmt.Printf("  #%2d gap %5.1fd every %4.1fd cv %.2f first window %s..%s actual %s hit %v late %v\n", i, gap, f.EWMADays, f.CV,
					f.Windows[0].Opens.Format("01-02 Mon"), f.Windows[0].Closes.Format("01-02 Mon"), kept[i].Format("01-02 Mon"), hit, late)
			}
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].f.Score > rows[j].f.Score })
	for i, r := range rows {
		if i == 20 {
			break
		}
		fmt.Printf("%-22s n %3d  every %5.1fd  cv %.2f  hits %2d/%-2d  score %.2f  %s\n", r.key, r.f.N, r.f.EWMADays, r.f.CV, r.f.Hits, r.f.Trials, r.f.Score, r.f.Series)
	}
}
