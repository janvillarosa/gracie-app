package categorization

import (
	"context"
	"errors"
	"testing"
)

// fakeIndex implements CategoryIndex for testing.
type fakeIndex struct {
	data       map[string]string
	lookupErr  error
	upsertErr  error
	upsertKeys []string
}

func newFakeIndex() *fakeIndex {
	return &fakeIndex{data: map[string]string{}}
}

func (f *fakeIndex) Lookup(ctx context.Context, key string) (string, bool, error) {
	if f.lookupErr != nil {
		return "", false, f.lookupErr
	}
	cat, found := f.data[key]
	return cat, found, nil
}

func (f *fakeIndex) Upsert(ctx context.Context, key, category string) error {
	f.upsertKeys = append(f.upsertKeys, key)
	if f.upsertErr != nil {
		return f.upsertErr
	}
	f.data[key] = category
	return nil
}

// stubCat is a Categorizer returning a fixed result.
type stubCat struct {
	cat   string
	conf  float64
	err   error
	calls int
}

func (s *stubCat) Categorize(ctx context.Context, desc string) (string, float64, error) {
	s.calls++
	return s.cat, s.conf, s.err
}

func TestCachingHitSkipsInner(t *testing.T) {
	idx := newFakeIndex()
	idx.data["milk"] = "Eggs & Dairy"

	inner := &stubCat{cat: "Produce", conf: 0.8}
	caching := NewCachingCategorizer(inner, idx)

	cat, conf, err := caching.Categorize(context.Background(), "2 lbs Milk")

	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if cat != "Eggs & Dairy" {
		t.Errorf("got category %q, want Eggs & Dairy", cat)
	}
	if conf != 1.0 {
		t.Errorf("got confidence %f, want 1.0", conf)
	}
	if inner.calls != 0 {
		t.Errorf("inner should not be called on cache hit, got %d calls", inner.calls)
	}
}

func TestCachingMissWritesThrough(t *testing.T) {
	idx := newFakeIndex()
	inner := &stubCat{cat: "Produce", conf: 0.8}
	caching := NewCachingCategorizer(inner, idx)

	cat, conf, err := caching.Categorize(context.Background(), "2 lbs Bananas")

	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if cat != "Produce" {
		t.Errorf("got category %q, want Produce", cat)
	}
	if conf != 0.8 {
		t.Errorf("got confidence %f, want 0.8", conf)
	}
	if inner.calls != 1 {
		t.Errorf("inner should be called once on cache miss, got %d calls", inner.calls)
	}
	if idx.data["bananas"] != "Produce" {
		t.Errorf("got cached entry %q, want Produce", idx.data["bananas"])
	}
}

func TestCachingDoesNotCacheDeclineOrGeneral(t *testing.T) {
	tests := []struct {
		name      string
		cat       string
		conf      float64
		shouldErr bool
	}{
		{
			name:      "decline (empty category)",
			cat:       "",
			conf:      0.1,
			shouldErr: false,
		},
		{
			name:      "General category",
			cat:       General,
			conf:      0.5,
			shouldErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			idx := newFakeIndex()
			inner := &stubCat{cat: tt.cat, conf: tt.conf}
			caching := NewCachingCategorizer(inner, idx)

			result, _, err := caching.Categorize(context.Background(), "2 Apples")

			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
			if result != tt.cat {
				t.Errorf("got category %q, want %q", result, tt.cat)
			}
			if len(idx.upsertKeys) != 0 {
				t.Errorf("should not upsert on decline or General, got upserts: %v", idx.upsertKeys)
			}
		})
	}
}

func TestCachingLookupErrorFallsThrough(t *testing.T) {
	idx := newFakeIndex()
	idx.lookupErr = errors.New("mongo down")

	inner := &stubCat{cat: "Produce", conf: 0.8}
	caching := NewCachingCategorizer(inner, idx)

	cat, conf, err := caching.Categorize(context.Background(), "2 Apples")

	if err != nil {
		t.Errorf("should not propagate lookup error, got: %v", err)
	}
	if cat != "Produce" {
		t.Errorf("got category %q, want Produce", cat)
	}
	if conf != 0.8 {
		t.Errorf("got confidence %f, want 0.8", conf)
	}
	if inner.calls != 1 {
		t.Errorf("should fall through to inner on lookup error, got %d calls", inner.calls)
	}
}

func TestCachingUpsertErrorIsSwallowed(t *testing.T) {
	idx := newFakeIndex()
	idx.upsertErr = errors.New("write failed")

	inner := &stubCat{cat: "Produce", conf: 0.8}
	caching := NewCachingCategorizer(inner, idx)

	cat, conf, err := caching.Categorize(context.Background(), "2 Apples")

	if err != nil {
		t.Errorf("should not propagate upsert error, got: %v", err)
	}
	if cat != "Produce" {
		t.Errorf("got category %q, want Produce", cat)
	}
	if conf != 0.8 {
		t.Errorf("got confidence %f, want 0.8", conf)
	}
}

func TestCachingInnerErrorPropagates(t *testing.T) {
	idx := newFakeIndex()
	boom := errors.New("model down")
	inner := &stubCat{cat: "", conf: 0, err: boom}
	caching := NewCachingCategorizer(inner, idx)

	cat, _, err := caching.Categorize(context.Background(), "2 Apples")

	if !errors.Is(err, boom) {
		t.Errorf("should propagate inner error, got: %v", err)
	}
	if cat != "" {
		t.Errorf("got category %q, want empty", cat)
	}
	if len(idx.upsertKeys) != 0 {
		t.Errorf("should not upsert on error, got upserts: %v", idx.upsertKeys)
	}
}
