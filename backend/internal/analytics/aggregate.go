package analytics

import (
	"context"
	"strings"
	"time"
)

// DocUpdate is a storage-agnostic update to one aggregate document. Every operation is
// commutative or idempotent, so folding the same events twice never happens by design
// (watermark) and re-applying a failed transaction is safe.
type DocUpdate struct {
	ID  string
	Inc map[string]int64     // dotted path -> amount
	Min map[string]time.Time // keep the earliest
	Max map[string]time.Time // keep the latest
	Set map[string]any       // last write wins; used for markers and labels
}

func newDocUpdate(id string) *DocUpdate {
	return &DocUpdate{ID: id, Inc: map[string]int64{}, Min: map[string]time.Time{}, Max: map[string]time.Time{}, Set: map[string]any{}}
}

// Batch is everything one fold pass changes.
type Batch struct {
	Periods map[string]*DocUpdate // period_stats docs
	Keys    map[string]*DocUpdate // key_stats docs
	Dirty   map[string]struct{}   // subjects ("u:<id>", "h:<room>") whose profile needs recomputing
	Touched map[string]KeyRef     // keys whose intervals need recomputing, by key_stats id
}

func NewBatch() *Batch {
	return &Batch{Periods: map[string]*DocUpdate{}, Keys: map[string]*DocUpdate{}, Dirty: map[string]struct{}{}, Touched: map[string]KeyRef{}}
}

func (b *Batch) period(id string) *DocUpdate {
	u, ok := b.Periods[id]
	if !ok {
		u = newDocUpdate(id)
		b.Periods[id] = u
	}
	return u
}

func (b *Batch) key(id string) *DocUpdate {
	u, ok := b.Keys[id]
	if !ok {
		u = newDocUpdate(id)
		b.Keys[id] = u
	}
	return u
}

// KeyRef identifies one thing ("whole milk" among a house's items).
type KeyRef struct {
	RoomID, SubjectType, Key string
}

// ID is the key_stats document id.
func (k KeyRef) ID() string { return k.RoomID + ":" + k.SubjectType + ":" + k.Key }

// KeyIntervals is the recomputed rhythm of one key.
type KeyIntervals struct {
	N          int        // completions (or requests) counted
	Source     string     // "complete" or "request"
	EWMADays   float64    // smoothed days between occurrences
	CV         float64    // spread of the gaps relative to their mean
	LastAt     time.Time  // latest counted occurrence
	DueAt      *time.Time // LastAt + EWMADays; nil until there is enough history
	ComputedAt time.Time
}

// AggregateRepository stores the precomputed documents and the rollup bookkeeping.
type AggregateRepository interface {
	// AcquireLease takes the rollup lease for owner when it is free, expired or already
	// held by owner, and returns the current watermark (zero time before the first fold).
	AcquireLease(ctx context.Context, owner string, ttl time.Duration, now time.Time) (watermark time.Time, ok bool, err error)
	// ApplyBatch writes the aggregates, marks subjects dirty and advances the watermark in
	// ONE transaction, so a crash can never apply a window twice or skip one.
	ApplyBatch(ctx context.Context, b *Batch, owner string, watermark time.Time) error
	ReleaseLease(ctx context.Context, owner string) error
	// SetKeyIntervals replaces the interval fields of one key_stats document.
	SetKeyIntervals(ctx context.Context, id string, iv KeyIntervals) error
	// DeleteByRoom and DeleteByUser remove aggregates when a house or account is deleted.
	DeleteByRoom(ctx context.Context, roomID string) error
	DeleteByUser(ctx context.Context, userID string) error
}

// ApplyToDoc applies u to a nested in-memory document with the same semantics the Mongo
// operators have. The in-memory fake uses it, and tests assert against the result.
func ApplyToDoc(doc map[string]any, u *DocUpdate) {
	for p, n := range u.Inc {
		cur, _ := getPath(doc, p).(int64)
		setPath(doc, p, cur+n)
	}
	for p, t := range u.Min {
		if cur, ok := getPath(doc, p).(time.Time); !ok || t.Before(cur) {
			setPath(doc, p, t)
		}
	}
	for p, t := range u.Max {
		if cur, ok := getPath(doc, p).(time.Time); !ok || t.After(cur) {
			setPath(doc, p, t)
		}
	}
	for p, v := range u.Set {
		setPath(doc, p, v)
	}
}

func getPath(doc map[string]any, path string) any {
	parts := strings.Split(path, ".")
	cur := doc
	for i, p := range parts {
		v, ok := cur[p]
		if !ok {
			return nil
		}
		if i == len(parts)-1 {
			return v
		}
		cur, ok = v.(map[string]any)
		if !ok {
			return nil
		}
	}
	return nil
}

func setPath(doc map[string]any, path string, v any) {
	parts := strings.Split(path, ".")
	cur := doc
	for _, p := range parts[:len(parts)-1] {
		next, ok := cur[p].(map[string]any)
		if !ok {
			next = map[string]any{}
			cur[p] = next
		}
		cur = next
	}
	cur[parts[len(parts)-1]] = v
}

// GetPath reads a dotted path from a nested document (test helper).
func GetPath(doc map[string]any, path string) any { return getPath(doc, path) }
