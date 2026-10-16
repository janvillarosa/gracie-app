// Command analytics-backfill rebuilds behavior-analytics events for things that happened
// before analytics existed (see docs/superpowers/specs/2026-10-16-analytics-backfill-design.md).
//
// Usage: analytics-backfill [--apply [--fold]] [--room <room_id>] [--before <RFC3339>]
//
// It reads the same environment as the server (MONGODB_URI, MONGODB_DB,
// ANALYTICS_RETENTION_DAYS, ANALYTICS_ENABLED). By default it is a dry run: it reports what
// it would write and writes nothing. --apply inserts the events; --fold then waits out the
// ingest lag and drains the rollup so the aggregates are ready, instead of waiting for the
// server's next fold tick. Re-running is safe: event ids are deterministic.
//
// In the production image the entrypoint starts the server, so run it with an override:
//
//	docker run --entrypoint /usr/local/bin/analytics-backfill <image> --room <id>
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
	"github.com/janvillarosa/gracie-app/backend/internal/config"
	"github.com/janvillarosa/gracie-app/backend/internal/services"
	mongostore "github.com/janvillarosa/gracie-app/backend/internal/store/mongo"
	"github.com/janvillarosa/gracie-app/backend/internal/trips"
)

type options struct {
	Apply  bool
	Fold   bool
	RoomID string
	Before time.Time
}

func parseArgs(args []string, errOut io.Writer) (options, error) {
	var o options
	var before string
	fs := flag.NewFlagSet("analytics-backfill", flag.ContinueOnError)
	fs.SetOutput(errOut)
	fs.BoolVar(&o.Apply, "apply", false, "write the events (default is a dry run that writes nothing)")
	fs.BoolVar(&o.Fold, "fold", false, "after --apply, wait out the ingest lag and fold the aggregates now")
	fs.StringVar(&o.RoomID, "room", "", "limit to one house (room id), for a trial run")
	fs.StringVar(&before, "before", "", "only events strictly before this RFC3339 time (default: when live analytics began)")
	if err := fs.Parse(args); err != nil {
		return o, err
	}
	if fs.NArg() > 0 {
		return o, fmt.Errorf("unexpected arguments: %v", fs.Args())
	}
	if o.Fold && !o.Apply {
		return o, errors.New("--fold needs --apply: a dry run writes nothing to fold")
	}
	if before != "" {
		t, err := time.Parse(time.RFC3339, before)
		if err != nil {
			return o, fmt.Errorf("--before: %w", err)
		}
		o.Before = t.UTC()
	}
	return o, nil
}

// summary is the human-readable report on stderr; the JSON report goes to stdout.
func summary(rep *analytics.BackfillReport) string {
	mode := "DRY RUN: nothing was written. Re-run with --apply to write."
	if rep.Applied {
		mode = "APPLIED."
	}
	return fmt.Sprintf("%s\ncutoff: %s (only earlier events are backfilled)\nemitted: %d  inserted: %d  folded: %d  profiles: %d  utc-fallback: %d\nby event:  %v\nby source: %v\nskipped:   %v\n",
		mode, rep.Cutoff.Format(time.RFC3339), rep.Emitted, rep.Inserted, rep.Folded, rep.Profiles, rep.UTCFallback,
		analytics.SortedCounts(rep.ByName), analytics.SortedCounts(rep.BySource), analytics.SortedCounts(rep.Skipped))
}

func run(ctx context.Context, o options, stdout, stderr io.Writer) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}
	if !cfg.AnalyticsEnabled {
		return errors.New("ANALYTICS_ENABLED is false: nothing would fold the backfilled events")
	}
	mcli, err := mongostore.New(ctx, cfg.MongoURI, cfg.MongoDB)
	if err != nil {
		return fmt.Errorf("mongo connect: %w", err)
	}
	defer func() { _ = mcli.Close(context.Background()) }()

	events := mongostore.NewEventRepo(mcli)
	// The unique event_id index is what makes a re-run a no-op, so it must exist before inserting.
	if err := events.EnsureIndexes(ctx); err != nil {
		return fmt.Errorf("events indexes: %w", err)
	}
	aggs := mongostore.NewAggRepo(mcli, mongostore.NewTx(mcli))
	if err := aggs.EnsureIndexes(ctx); err != nil {
		return fmt.Errorf("aggregate indexes: %w", err)
	}

	reg := analytics.NewRegistry()
	services.RegisterAnalyticsEvents(reg)
	trips.RegisterAnalyticsEvents(reg)

	reader := mongostore.NewBackfillReader(mcli)
	dir := services.NewBackfillDirectory(reader)
	sources := append(dir.Sources(), trips.NewBackfillSource(reader.EachTrip))
	b := analytics.NewBackfill(events, reg, analytics.NewWorker(events, aggs, reg), sources...)

	if !o.Apply {
		_, _ = fmt.Fprintln(stderr, "dry run (no --apply): nothing will be written")
	}
	rep, runErr := b.Run(ctx, analytics.BackfillEnv{
		Before:    o.Before,
		Retention: time.Duration(cfg.AnalyticsRetentionDays) * 24 * time.Hour,
		TZ:        dir.TZ,
	}, analytics.BackfillOptions{RoomID: o.RoomID, Apply: o.Apply, Fold: o.Fold})
	if rep != nil {
		// Even a failed run reports how far it got; a re-run completes the rest.
		_, _ = fmt.Fprint(stderr, summary(rep))
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(rep)
	}
	if errors.Is(runErr, analytics.ErrNoCutoff) {
		return fmt.Errorf("%w; pass --before <RFC3339> to choose one", runErr)
	}
	return runErr
}

func main() {
	o, err := parseArgs(os.Args[1:], os.Stderr)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		log.Fatalf("analytics-backfill: %v", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, o, os.Stdout, os.Stderr); err != nil {
		log.Fatalf("analytics-backfill: %v", err)
	}
}
