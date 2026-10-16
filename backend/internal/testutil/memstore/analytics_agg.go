package memstore

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/janvillarosa/gracie-app/backend/internal/analytics"
)

// AggRepo is an in-memory analytics.AggregateRepository.
type AggRepo struct {
	mu         sync.Mutex
	owner      string
	leaseUntil time.Time
	watermark  time.Time
	periods    map[string]map[string]any
	keys       map[string]map[string]any
	dirty      map[string]bool
	profiles   map[string]*analytics.Profile
	failApply  error
}

func NewAggRepo() *AggRepo {
	return &AggRepo{periods: map[string]map[string]any{}, keys: map[string]map[string]any{}, dirty: map[string]bool{}, profiles: map[string]*analytics.Profile{}}
}

func (r *AggRepo) AcquireLease(_ context.Context, owner string, ttl time.Duration, now time.Time) (time.Time, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.owner != "" && r.owner != owner && now.Before(r.leaseUntil) {
		return time.Time{}, false, nil
	}
	r.owner, r.leaseUntil = owner, now.Add(ttl)
	return r.watermark, true, nil
}

func (r *AggRepo) ReleaseLease(_ context.Context, owner string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.owner == owner {
		r.owner, r.leaseUntil = "", time.Time{}
	}
	return nil
}

// ApplyBatch is atomic: it either applies everything and moves the watermark, or nothing.
func (r *AggRepo) ApplyBatch(_ context.Context, b *analytics.Batch, owner string, watermark time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.failApply != nil {
		return r.failApply
	}
	if r.owner != owner {
		return context.Canceled // lease lost
	}
	for id, u := range b.Periods {
		doc := r.periods[id]
		if doc == nil {
			doc = map[string]any{}
			r.periods[id] = doc
		}
		analytics.ApplyToDoc(doc, u)
	}
	for id, u := range b.Keys {
		doc := r.keys[id]
		if doc == nil {
			doc = map[string]any{}
			r.keys[id] = doc
		}
		analytics.ApplyToDoc(doc, u)
	}
	for s := range b.Dirty {
		r.dirty[s] = true
	}
	r.watermark = watermark
	return nil
}

func (r *AggRepo) SetKeyIntervals(_ context.Context, id string, iv analytics.KeyIntervals) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	doc := r.keys[id]
	if doc == nil {
		doc = map[string]any{}
		r.keys[id] = doc
	}
	doc["intervals"] = iv
	return nil
}

func (r *AggRepo) DeleteByRoom(_ context.Context, roomID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id := range r.periods {
		if strings.HasPrefix(id, "h:"+roomID+":") {
			delete(r.periods, id)
		}
	}
	for id := range r.keys {
		if strings.HasPrefix(id, roomID+":") {
			delete(r.keys, id)
		}
	}
	delete(r.dirty, "h:"+roomID)
	delete(r.profiles, "h:"+roomID)
	return nil
}

func (r *AggRepo) DeleteByUser(_ context.Context, userID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id := range r.periods {
		if strings.HasPrefix(id, "u:"+userID+":") {
			delete(r.periods, id)
		}
	}
	delete(r.dirty, "u:"+userID)
	delete(r.profiles, "u:"+userID)
	return nil
}

// FailNextApply makes ApplyBatch fail (test helper for crash-before-commit).
func (r *AggRepo) FailApply(err error) {
	r.mu.Lock()
	r.failApply = err
	r.mu.Unlock()
}

// Period returns a copy-safe view of a period doc (test helper); nil when absent.
func (r *AggRepo) Period(id string) map[string]any {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.periods[id]
}

// Key returns a key_stats doc (test helper); nil when absent.
func (r *AggRepo) Key(id string) map[string]any {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.keys[id]
}

// Watermark returns the fold watermark (test helper).
func (r *AggRepo) Watermark() time.Time {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.watermark
}

// Dirty returns the subjects awaiting a profile recompute, sorted (test helper).
func (r *AggRepo) Dirty() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []string
	for s := range r.dirty {
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}

var _ analytics.AggregateRepository = (*AggRepo)(nil)
