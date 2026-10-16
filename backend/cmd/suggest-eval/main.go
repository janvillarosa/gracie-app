// Command suggest-eval measures smart suggestions before and after they go live.
//
//	suggest-eval backtest   replay every house's history and print precision + a MinScore sweep
//	suggest-eval shadow     score live item.suggestion_predicted events against what happened next
//	suggest-eval backfill   turn existing list items into events (dry run unless -apply)
//
// It reads the same MONGODB_URI / MONGODB_DB as the server. backtest and shadow only read.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
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
	case "backfill":
		backfill(ctx, cli, *room, *apply, time.Duration(cfg.AnalyticsRetentionDays)*24*time.Hour)
	default:
		usage()
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: suggest-eval backtest|shadow|backfill [-room ID] [-apply]")
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
