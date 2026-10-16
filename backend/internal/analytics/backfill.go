package analytics

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"
)

// BackfillEvents is what a backfill needs from the raw event store: append, and find
// when live recording began. Kept apart from EventRepository so request-path fakes
// don't have to grow methods they never use.
type BackfillEvents interface {
	// InsertNew appends events and returns how many were new; a duplicate event_id is
	// skipped, which is what makes re-running a backfill a no-op.
	InsertNew(ctx context.Context, evs []Event) (int, error)
	// EarliestOccurred returns the oldest occurred_at among events from source; ok is
	// false when there are none.
	EarliestOccurred(ctx context.Context, source string) (at time.Time, ok bool, err error)
}

// ErrNoCutoff means there is no live event to anchor the cutoff on and none was given.
var ErrNoCutoff = errors.New("analytics backfill: no live events yet and no explicit cutoff")

const (
	// backfillIDVersion prefixes event ids. Fixing the derivation later means a new version.
	backfillIDVersion = "bf1"
	backfillBatch     = 500
	// retentionMargin keeps a backfilled event clear of the TTL monitor until it has been folded.
	retentionMargin = 24 * time.Hour
	// foldSettle is how long past the ingest lag --fold waits so the fold window includes the batch.
	foldSettle = 5 * time.Second
	// maxFoldPasses bounds the drain loop; a pass folds at most foldLimit events.
	maxFoldPasses = 10000
)

// Skip reasons reported in BackfillReport.Skipped.
const (
	SkipAfterCutoff = "after_cutoff"
	SkipRetention   = "retention"
	SkipLiveMarker  = "live_marker"
	SkipEmptyKey    = "empty_key"
)

// BackfillEnv is what a source needs to decide what to emit. Skip lets a source count
// the records it deliberately leaves out; Run fills it in.
type BackfillEnv struct {
	RoomID    string    // "" = every house; sources pass it to their reader
	Before    time.Time // exclusive: only things that happened strictly earlier are emitted
	Retention time.Duration
	Now       time.Time
	// TZ resolves the zone to bucket an actor's local time in; "" falls back to UTC.
	TZ   func(ctx context.Context, actorID, roomID string) string
	Skip func(reason string)
}

// BackfillSource walks one domain and emits the events its documents imply. It is pure
// derivation over a read-only cursor and never writes. tzHint, when non-empty, wins over
// env.TZ (a trip knows the zone it happened in better than its creator's last-seen zone).
// Name, Source, id and local time are filled in by Run; a source sets the rest.
type BackfillSource interface {
	Name() string
	Each(ctx context.Context, env BackfillEnv, emit func(ev Event, tzHint string) error) error
}

type BackfillOptions struct {
	RoomID string // limit to one house for a trial run; "" = everything
	Apply  bool   // false = report only, nothing is written
	Fold   bool   // after inserting, wait out the ingest lag and drain the fold and profile passes
}

type BackfillReport struct {
	Cutoff      time.Time      `json:"cutoff"`
	Applied     bool           `json:"applied"`
	ByName      map[string]int `json:"by_name"`
	BySource    map[string]int `json:"by_source"`
	Skipped     map[string]int `json:"skipped"`
	UTCFallback int            `json:"utc_fallback"`
	Emitted     int            `json:"emitted"`
	Inserted    int            `json:"inserted"`
	Folded      int            `json:"folded"`
	Profiles    int            `json:"profiles"`
}

// Backfill rebuilds events for things that happened before analytics existed and feeds
// them through the normal pipeline: insert as ordinary events, let the rollup fold them.
type Backfill struct {
	events  BackfillEvents
	reg     *Registry
	worker  *Worker
	sources []BackfillSource
	now     func() time.Time
	wait    func(ctx context.Context, d time.Duration) error
}

// NewBackfill wires the sources. worker may be nil when the caller never folds.
func NewBackfill(events BackfillEvents, reg *Registry, worker *Worker, sources ...BackfillSource) *Backfill {
	return &Backfill{events: events, reg: reg, worker: worker, sources: sources, now: time.Now, wait: sleepCtx}
}

// WithClock replaces the clock and the wait (tests).
func (b *Backfill) WithClock(now func() time.Time, wait func(context.Context, time.Duration) error) *Backfill {
	b.now, b.wait = now, wait
	return b
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// Run derives, guards, and (with opt.Apply) inserts. env.Before zero means "when live
// recording began". Safe to re-run: ids are deterministic and duplicates are skipped.
func (b *Backfill) Run(ctx context.Context, env BackfillEnv, opt BackfillOptions) (*BackfillReport, error) {
	if env.Retention <= 0 {
		return nil, errors.New("analytics backfill: retention must be positive")
	}
	if env.Now.IsZero() {
		env.Now = b.now()
	}
	env.RoomID = opt.RoomID
	if env.Before.IsZero() {
		first, ok, err := b.events.EarliestOccurred(ctx, SourceServer)
		if err != nil {
			return nil, fmt.Errorf("find cutoff: %w", err)
		}
		if !ok {
			return nil, ErrNoCutoff
		}
		env.Before = first
	}
	rep := &BackfillReport{
		Cutoff: env.Before.UTC(), Applied: opt.Apply,
		ByName: map[string]int{}, BySource: map[string]int{}, Skipped: map[string]int{},
	}
	env.Skip = func(reason string) { rep.Skipped[reason]++ }
	oldest := env.Now.Add(-(env.Retention - retentionMargin))

	var batch []Event
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		// Stamp ingest time at insert, not at start: a long run must not land events behind
		// the live worker's watermark, where they would never fold.
		ing := b.now().UTC().Truncate(time.Millisecond)
		for i := range batch {
			batch[i].IngestedAt = ing
		}
		n, err := b.events.InsertNew(ctx, batch)
		rep.Inserted += n
		batch = batch[:0]
		return err
	}

	for _, src := range b.sources {
		emit := func(ev Event, tzHint string) error {
			def, ok := b.reg.Resolve(ev.Name)
			if !ok {
				return fmt.Errorf("source %s emitted unregistered event %q", src.Name(), ev.Name)
			}
			ev.Name = def.Name
			switch {
			case !ev.OccurredAt.Before(env.Before):
				env.Skip(SkipAfterCutoff)
				return nil
			case ev.OccurredAt.Before(oldest):
				env.Skip(SkipRetention)
				return nil
			}
			tz := tzHint
			if tz == "" && env.TZ != nil {
				tz = env.TZ(ctx, ev.ActorID, ev.RoomID)
			}
			if tz == "" {
				rep.UTCFallback++
			}
			ev.Source = SourceBackfill
			ev.EventID = fmt.Sprintf("%s:%s:%s", backfillIDVersion, ev.Name, ev.Subject.ID)
			Stamp(&ev, env.Now, tz, env.Retention)
			rep.Emitted++
			rep.ByName[ev.Name]++
			rep.BySource[src.Name()]++
			if !opt.Apply {
				return nil
			}
			batch = append(batch, ev)
			if len(batch) >= backfillBatch {
				return flush()
			}
			return nil
		}
		if err := src.Each(ctx, env, emit); err != nil {
			return rep, fmt.Errorf("source %s: %w", src.Name(), err)
		}
		if err := flush(); err != nil {
			return rep, fmt.Errorf("insert (%s): %w", src.Name(), err)
		}
	}

	if opt.Apply && opt.Fold && b.worker != nil {
		if err := b.drain(ctx, rep); err != nil {
			return rep, err
		}
	}
	return rep, nil
}

// drain waits out the ingest lag, then folds and recomputes profiles until nothing is left.
// If the server's own worker holds the lease a pass returns 0 early; it then finishes the job.
func (b *Backfill) drain(ctx context.Context, rep *BackfillReport) error {
	if err := b.wait(ctx, ingestLag+foldSettle); err != nil {
		return err
	}
	for i := 0; i < maxFoldPasses; i++ {
		n, err := b.worker.FoldOnce(ctx)
		if err != nil {
			return fmt.Errorf("fold: %w", err)
		}
		if n == 0 {
			break
		}
		rep.Folded += n
	}
	for i := 0; i < maxFoldPasses; i++ {
		n, err := b.worker.ProfilePass(ctx)
		if err != nil {
			return fmt.Errorf("profiles: %w", err)
		}
		if n == 0 {
			break
		}
		rep.Profiles += n
	}
	return nil
}

// SortedCounts renders a count map in a stable order for the CLI summary.
func SortedCounts(m map[string]int) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]string, len(keys))
	for i, k := range keys {
		out[i] = fmt.Sprintf("%s=%d", k, m[k])
	}
	return out
}
