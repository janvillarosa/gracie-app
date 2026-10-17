package analytics

import (
	"context"
	"log"
	"math/rand"
	"sort"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
	"github.com/janvillarosa/gracie-app/backend/internal/parse"
	"github.com/janvillarosa/gracie-app/backend/pkg/ids"
)

const (
	// ingestLag leaves room for events still in a recorder buffer or a retrying flush, so a
	// window is only folded once nothing older can still arrive.
	ingestLag = 2 * time.Minute
	foldLimit = 5000
	leaseTTL  = 5 * time.Minute
	keyEvents = 500 // newest events read per key when recomputing its rhythm
	// keysScanned bounds the look-alike search per recompute; maxSiblings bounds how many
	// look-alike names are merged into one forecast.
	keysScanned = 2000
	// staleBatch bounds how many outdated forecasts one tick rebuilds.
	staleBatch  = 500
	maxSiblings = 5
)

func minTime(cur, t time.Time) time.Time {
	if cur.IsZero() || t.Before(cur) {
		return t
	}
	return cur
}

func maxTime(cur, t time.Time) time.Time {
	if cur.IsZero() || t.After(cur) {
		return t
	}
	return cur
}

// Worker folds raw events into the precomputed aggregates.
type Worker struct {
	events EventRepository
	aggs   AggregateRepository
	reg    *Registry
	owner  string
	now    func() time.Time
}

func NewWorker(events EventRepository, aggs AggregateRepository, reg *Registry) *Worker {
	return &Worker{events: events, aggs: aggs, reg: reg, owner: ids.NewID("worker"), now: time.Now}
}

// WithClock replaces the clock (tests drive the ingest lag and staleness with it).
func (w *Worker) WithClock(now func() time.Time) *Worker {
	w.now = now
	return w
}

// FoldOnce runs one fold pass and returns how many events it folded. Only the instance
// holding the lease does work, so any number of instances can run it safely.
func (w *Worker) FoldOnce(ctx context.Context) (int, error) {
	now := w.now().UTC()
	watermark, ok, err := w.aggs.AcquireLease(ctx, w.owner, leaseTTL, now)
	if err != nil || !ok {
		return 0, err
	}
	defer func() { _ = w.aggs.ReleaseLease(context.Background(), w.owner) }()

	upper := now.Add(-ingestLag).Truncate(time.Millisecond)
	evs, err := w.events.ListIngestedBetween(ctx, watermark, upper, foldLimit)
	if err != nil || len(evs) == 0 {
		return 0, err
	}
	next := upper
	if len(evs) == foldLimit {
		// The page is full, so more may follow. Drop the trailing events that share the last
		// timestamp (they are read again next pass) and resume just after the last one kept.
		last := evs[len(evs)-1].IngestedAt
		cut := len(evs)
		for cut > 0 && evs[cut-1].IngestedAt.Equal(last) {
			cut--
		}
		if cut > 0 {
			evs = evs[:cut]
			next = evs[cut-1].IngestedAt.Add(time.Millisecond)
		} // else every event shares one millisecond: take them all and move on
	}
	batch := Fold(w.reg, evs)
	if err := w.aggs.ApplyBatch(ctx, batch, w.owner, next); err != nil {
		return 0, err
	}
	// Intervals are derived from the raw history, so recomputing is idempotent and sits
	// outside the transaction. A failure here is repaired by the next event for the key.
	// A key's look-alikes ("oranges" for "orange") share its add history, so they are
	// recomputed too.
	done := map[string]bool{}
	var also []KeyRef
	for _, ref := range batch.Touched {
		done[ref.ID()] = true
		sibs, err := w.recomputeKey(ctx, ref)
		if err != nil {
			log.Printf("analytics: recompute %s: %v", ref.ID(), err)
		}
		also = append(also, sibs...)
	}
	for _, ref := range also {
		if done[ref.ID()] {
			continue
		}
		done[ref.ID()] = true
		if _, err := w.recomputeKey(ctx, ref); err != nil {
			log.Printf("analytics: recompute %s: %v", ref.ID(), err)
		}
	}
	return len(evs), nil
}

// weighted is an occurrence and how sure we are it is this key (1 for its own events, the name
// similarity for a look-alike's).
type weighted struct {
	at time.Time
	w  float64
}

func timesOf(ws []weighted) []time.Time {
	sort.Slice(ws, func(i, j int) bool { return ws[i].at.Before(ws[j].at) })
	out := make([]time.Time, len(ws))
	for i, x := range ws {
		out[i] = x.at
	}
	return out
}

func meanWeight(ws []weighted) float64 {
	if len(ws) == 0 {
		return 1
	}
	var sum float64
	for _, x := range ws {
		sum += x.w
	}
	return sum / float64(len(ws))
}

// similarKeys returns the house's other keys of the same type whose names are alike enough to
// be the same thing, most alike first, with their similarity.
func (w *Worker) similarKeys(ctx context.Context, ref KeyRef) ([]KeyRef, []float64, error) {
	keys, err := w.aggs.ListKeys(ctx, ref.RoomID, ref.SubjectType, keysScanned)
	if err != nil {
		return nil, nil, err
	}
	type sib struct {
		key string
		s   float64
	}
	var sibs []sib
	for _, k := range keys {
		if k == ref.Key {
			continue
		}
		if s := parse.Similarity(ref.Key, k); s >= parse.SimilarThreshold {
			sibs = append(sibs, sib{k, s})
		}
	}
	sort.Slice(sibs, func(i, j int) bool { return sibs[i].s > sibs[j].s })
	if len(sibs) > maxSiblings {
		sibs = sibs[:maxSiblings]
	}
	refs := make([]KeyRef, len(sibs))
	sims := make([]float64, len(sibs))
	for i, s := range sibs {
		refs[i], sims[i] = KeyRef{RoomID: ref.RoomID, SubjectType: ref.SubjectType, Key: s.key}, s.s
	}
	return refs, sims, nil
}

// recomputeKey rebuilds one key's rhythm from its newest events: completions first, and
// requests when there are too few completions to say anything. The add forecast also learns
// from look-alike names ("oranges" for "orange"), and its score is scaled by how sure it is that
// the merged history is one thing. It returns the look-alikes, whose forecasts share this history.
func (w *Worker) recomputeKey(ctx context.Context, ref KeyRef) ([]KeyRef, error) {
	evs, err := w.events.ListForKey(ctx, ref.RoomID, ref.SubjectType, ref.Key, keyEvents)
	if err != nil {
		return nil, err
	}
	var done, asked []time.Time
	var wDone, wAsked, wIgnored []weighted
	classify := func(evs []Event, weight float64, own bool) {
		for _, e := range evs {
			def, ok := w.reg.Resolve(e.Name)
			if !ok {
				continue
			}
			switch def.Role {
			case RoleComplete:
				if own {
					done = append(done, e.OccurredAt)
				}
				wDone = append(wDone, weighted{e.OccurredAt, weight})
			case RoleRequest:
				if own {
					asked = append(asked, e.OccurredAt)
				}
				wAsked = append(wAsked, weighted{e.OccurredAt, weight})
			case RoleDismiss:
				// Turned down mid-shop, days before it was due: not evidence the rhythm is wrong.
				if e.Props["during"] == DuringRun {
					continue
				}
				wIgnored = append(wIgnored, weighted{e.OccurredAt, weight})
			}
		}
	}
	classify(evs, 1, true)
	sibs, sims, err := w.similarKeys(ctx, ref)
	if err != nil {
		return nil, err
	}
	for i, s := range sibs {
		sevs, err := w.events.ListForKey(ctx, s.RoomID, s.SubjectType, s.Key, keyEvents)
		if err != nil {
			return sibs, err
		}
		classify(sevs, sims[i], false)
	}

	source, rhythm := "complete", predict.Intervals(done)
	if rhythm.N < predict.MinOccurrences {
		if alt := predict.Intervals(asked); alt.N > rhythm.N {
			source, rhythm = "request", alt
		}
	}
	iv := KeyIntervals{N: rhythm.N, Source: source, EWMADays: rhythm.EWMADays, CV: rhythm.CV, LastAt: rhythm.Last, ComputedAt: w.now().UTC(), Version: ForecastVersion}
	if due, ok := rhythm.Due(); ok {
		iv.DueAt = &due
	}
	if f, ok := predict.DefaultParams.Predict(timesOf(wAsked), timesOf(wDone), timesOf(wIgnored)); ok {
		certainty := meanWeight(wAsked)
		if f.Series == predict.SeriesChecked {
			certainty = meanWeight(wDone)
		}
		iv.Add = &AddForecast{Series: f.Series, N: f.N, EWMADays: f.EWMADays, CV: f.CV, LastAt: f.LastAt,
			DueAt: f.DueAt, OpensAt: f.OpensAt, ClosesAt: f.ClosesAt, Trials: f.Trials, Hits: f.Hits,
			Score: f.Score * certainty, NameCertainty: certainty}
		for _, w := range f.Windows {
			iv.Add.Windows = append(iv.Add.Windows, ForecastWindow{Opens: w.Opens.UTC(), Closes: w.Closes.UTC()})
		}
	}
	return sibs, w.aggs.SetKeyIntervals(ctx, ref.ID(), iv)
}

// RefreshStale rebuilds up to limit forecasts computed by older logic (or before forecasts were
// versioned) from their stored history. Recomputing is idempotent, so any number of instances may
// run it; it returns how many were rebuilt.
func (w *Worker) RefreshStale(ctx context.Context, limit int) (int, error) {
	refs, err := w.aggs.StaleKeys(ctx, ForecastVersion, limit)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, ref := range refs {
		if _, err := w.recomputeKey(ctx, ref); err != nil {
			log.Printf("analytics: refresh %s: %v", ref.ID(), err)
			continue
		}
		n++
	}
	return n, nil
}

// RunFold folds on a jittered timer until ctx ends, like the coordinate purge.
func (w *Worker) RunFold(ctx context.Context, every, jitter time.Duration) {
	for {
		if n, err := w.FoldOnce(ctx); err != nil {
			log.Printf("analytics: fold: %v", err)
		} else if n > 0 {
			log.Printf("analytics: folded %d events", n)
		}
		// After a deploy that changed the forecast logic, the first tick brings every older
		// forecast up to date (in batches), with no new events needed.
		if n, err := w.RefreshStale(ctx, staleBatch); err != nil {
			log.Printf("analytics: refresh stale forecasts: %v", err)
		} else if n > 0 {
			log.Printf("analytics: rebuilt %d stale forecasts", n)
		}
		wait := every
		if jitter > 0 {
			wait += time.Duration(rand.Int63n(int64(jitter)))
		}
		t := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-t.C:
		}
	}
}
