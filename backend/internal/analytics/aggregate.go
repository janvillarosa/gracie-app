package analytics

import (
	"context"
	"strings"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics/predict"
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
	Requeue map[string]struct{}   // rooms whose every key is marked stale (RequeueRoom events)
}

func NewBatch() *Batch {
	return &Batch{Periods: map[string]*DocUpdate{}, Keys: map[string]*DocUpdate{}, Dirty: map[string]struct{}{}, Touched: map[string]KeyRef{}, Requeue: map[string]struct{}{}}
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

// ForecastVersion is the version of the logic that builds KeyIntervals (rhythm and add forecast).
// Bump it whenever that logic changes: the worker then rebuilds every older forecast from the
// stored history, so a change takes effect without waiting for each key's next event.
// 2: skip-aware, recent-cycle forecasts with repeating windows.
// 3: home time: gaps, due dates and windows leave out the spans the whole house was away (trips).
const ForecastVersion = 3

// KeyIntervals is the recomputed rhythm of one key.
type KeyIntervals struct {
	N          int        `bson:"n" json:"n"`                               // occurrences counted
	Source     string     `bson:"source" json:"source"`                     // "complete" or "request"
	EWMADays   float64    `bson:"ewma_days" json:"ewma_days"`               // smoothed days between occurrences
	CV         float64    `bson:"cv" json:"cv"`                             // spread of the gaps relative to their mean
	LastAt     time.Time  `bson:"last_at" json:"last_at"`                   // latest counted occurrence
	DueAt      *time.Time `bson:"due_at,omitempty" json:"due_at,omitempty"` // LastAt + EWMADays; nil until there is enough history
	ComputedAt time.Time  `bson:"computed_at" json:"computed_at"`
	// Version is the ForecastVersion this was computed with (0: before versioning).
	Version int `bson:"v,omitempty" json:"v,omitempty"`
	// Add forecasts the next time the thing is asked for, with its backtested track record.
	// Nil until there is enough history. Smart suggestions read only this.
	Add *AddForecast `bson:"add,omitempty" json:"add,omitempty"`
	// Weekly is set when the thing follows the calendar (bin day): done on one local weekday every
	// one or two weeks. Learned from completions, or requests when completions are thin.
	Weekly *predict.Weekly `bson:"weekly,omitempty" json:"weekly,omitempty"`
	// LastBy is who completed it last and Turns who completed it, newest first (up to
	// predict.MaxTurns; real people only, system:* actors are left out). predict.NextTurn reads them.
	LastBy string   `bson:"last_by,omitempty" json:"last_by,omitempty"`
	Turns  []string `bson:"turns,omitempty" json:"turns,omitempty"`
}

// AddForecast is a stored predict.Forecast: when the thing is next expected to be added, the
// window a suggestion for it is shown in, and how often that window was right in the past.
type AddForecast struct {
	Series string `bson:"series" json:"series"` // "added" or "checked"
	// Clock is "home" when the rhythm was measured in home time (the house's trips left out), ""
	// on the wall clock. Projecting the forecast forward must use the same clock.
	Clock    string    `bson:"clock,omitempty" json:"clock,omitempty"`
	N        int       `bson:"n" json:"n"`
	EWMADays float64   `bson:"ewma_days" json:"ewma_days"`
	CV       float64   `bson:"cv" json:"cv"`
	LastAt   time.Time `bson:"last_at" json:"last_at"` // start of the current cycle
	DueAt    time.Time `bson:"due_at" json:"due_at"`
	OpensAt  time.Time `bson:"opens_at" json:"opens_at"`
	ClosesAt time.Time `bson:"closes_at" json:"closes_at"`
	Trials   int       `bson:"trials" json:"trials"`
	Hits     int       `bson:"hits" json:"hits"`
	Score    float64   `bson:"score" json:"score"`
	// NameCertainty is how sure the forecast is that its history is one thing: 1 when every event
	// was this exact name (or a plural or spacing of it), lower when look-alike names were merged
	// in ("yoghurt" for "yogurt"). Score already includes it.
	NameCertainty float64 `bson:"name_certainty,omitempty" json:"name_certainty,omitempty"`
	// Windows are every window the forecast may show: the first (OpensAt..ClosesAt) and one per
	// skipped cycle it rides through. A suggestion is shown while now is inside any of them.
	Windows []ForecastWindow `bson:"windows,omitempty" json:"windows,omitempty"`
}

// Forecast turns the stored forecast back into the predict form (for NeedBy).
func (a AddForecast) Forecast() predict.Forecast {
	f := predict.Forecast{Series: a.Series, Clock: a.Clock, N: a.N, EWMADays: a.EWMADays, CV: a.CV, LastAt: a.LastAt,
		DueAt: a.DueAt, OpensAt: a.OpensAt, ClosesAt: a.ClosesAt, Trials: a.Trials, Hits: a.Hits, Score: a.Score}
	for _, w := range a.Windows {
		f.Windows = append(f.Windows, predict.Span{Opens: w.Opens, Closes: w.Closes})
	}
	return f
}

// ForecastWindow is one suggestion window.
type ForecastWindow struct {
	Opens  time.Time `bson:"opens" json:"opens"`
	Closes time.Time `bson:"closes" json:"closes"`
}

// KeyStat is what is known about one thing in a house ("whole milk"): how often it was
// asked for and finished, by whom, and when it is likely due again.
type KeyStat struct {
	RoomID      string                      `bson:"room_id" json:"-"`
	SubjectType string                      `bson:"subject_type" json:"subject_type"`
	Key         string                      `bson:"key" json:"key"`
	Category    string                      `bson:"category,omitempty" json:"category,omitempty"`
	Counts      map[string]int64            `bson:"counts" json:"counts"`
	FirstAt     time.Time                   `bson:"first_at" json:"first_at"`
	LastAt      map[string]time.Time        `bson:"last_at" json:"last_at"`
	ByActor     map[string]map[string]int64 `bson:"by_actor,omitempty" json:"by_actor,omitempty"`
	Intervals   *KeyIntervals               `bson:"intervals,omitempty" json:"intervals,omitempty"`
	// Containers counts the key's events per container ("list:<id>"): where the thing lives.
	Containers map[string]int64 `bson:"containers,omitempty" json:"-"`
}

// AggregateRepository stores the precomputed documents and the rollup bookkeeping.
type AggregateRepository interface {
	// AcquireLease takes the rollup lease for owner when it is free, expired or already
	// held by owner, and returns the current watermark (zero time before the first fold).
	AcquireLease(ctx context.Context, owner string, ttl time.Duration, now time.Time) (watermark time.Time, ok bool, err error)
	// ApplyBatch writes the aggregates, marks subjects dirty, requeues the batch's rooms
	// (RequeueRoomKeys) and advances the watermark in ONE transaction, so a crash can never apply
	// a window twice or skip one.
	ApplyBatch(ctx context.Context, b *Batch, owner string, watermark time.Time) error
	ReleaseLease(ctx context.Context, owner string) error
	// SetKeyIntervals replaces the interval fields of one key_stats document.
	SetKeyIntervals(ctx context.Context, id string, iv KeyIntervals) error
	// ClaimDirty removes and returns up to limit subjects whose profile needs recomputing.
	ClaimDirty(ctx context.Context, limit int) ([]string, error)
	MarkDirty(ctx context.Context, subjects ...string) error
	// RequeueStale marks profiles last computed before `before` dirty (idle people's streaks and
	// windows must move on even without new events). It returns how many it queued.
	RequeueStale(ctx context.Context, before time.Time, limit int) (int, error)
	PutProfile(ctx context.Context, p *Profile) error
	// GetProfile returns (nil, nil) when none has been computed yet.
	GetProfile(ctx context.Context, id string) (*Profile, error)
	// GetPeriod returns the raw period document, or (nil, nil) when nothing happened in it.
	GetPeriod(ctx context.Context, id string) (map[string]any, error)
	GetKeyStats(ctx context.Context, roomID, subjectType string, keys []string) (map[string]KeyStat, error)
	// DueKeys returns keys whose predicted due date falls before `before`, soonest first.
	DueKeys(ctx context.Context, roomID, subjectType string, before time.Time, limit int) ([]KeyStat, error)
	// UpcomingKeys returns keys whose add forecast window contains now, with a score of at
	// least minScore and a CV of at most maxCV, highest score first.
	// UpcomingKeys returns keys with a suggestion window that opens by opensBefore and is still open
	// at now (opensBefore == now: open right now).
	UpcomingKeys(ctx context.Context, roomID, subjectType string, now, opensBefore time.Time, minScore, maxCV float64, limit int) ([]KeyStat, error)
	// RequeueRoomKeys marks every computed key of a room stale (intervals.v = 0), so RefreshStale
	// rebuilds them. It returns how many it marked.
	RequeueRoomKeys(ctx context.Context, roomID string) (int, error)
	// ForecastKeys returns up to limit keys of a room (any subject type) with an add forecast whose
	// first window opens by opensBefore, soonest first.
	ForecastKeys(ctx context.Context, roomID string, opensBefore time.Time, limit int) ([]KeyStat, error)
	// StaleKeys returns up to limit keys whose intervals were computed with an older (or no)
	// ForecastVersion than version.
	StaleKeys(ctx context.Context, version, limit int) ([]KeyRef, error)
	// ListKeys returns up to limit keys known in a house for one subject type (for finding
	// look-alike names).
	ListKeys(ctx context.Context, roomID, subjectType string, limit int) ([]string, error)
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
