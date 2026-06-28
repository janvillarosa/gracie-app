# Category Index + Backend Quantity Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a MongoDB-backed exact-match category index so item categorization skips the local ML embedding model for known descriptions, and port the frontend quantity parser to the backend so categorization keys are clean and legacy records normalize on read.

**Architecture:** A leaf `parse` package (Go port of the frontend `parseInput`) provides `NormalizeKey`. A `CachingCategorizer` decorator wraps **only** the embedding categorizer: it checks the Mongo `category_index` collection first, calls the model on a miss, and writes confident results back. The in-memory anchor exact-match map is removed; the 452 anchors are pre-seeded into the index. The list read path normalizes legacy descriptions non-destructively.

**Tech Stack:** Go 1.26, MongoDB (`go.mongodb.org/mongo-driver`), existing `categorization` package, standard `testing`.

**Spec:** `docs/superpowers/specs/2026-06-28-category-index-design.md`

---

## File Structure

**Create:**
- `backend/internal/parse/parse.go` — `ParseInput`, `NormalizeKey`, `QUANTITY_UNITS` (Go port of frontend `parseInput.ts`).
- `backend/internal/parse/parse_test.go` — ported test table + `NormalizeKey` tests.
- `backend/internal/store/mongo/category_index_repo.go` — Mongo `CategoryIndexRepo`: `Lookup`, `Upsert`, `Seed`, `EnsureIndexes`.
- `backend/internal/store/mongo/category_index_repo_test.go` — integration test (skips without Mongo).
- `backend/internal/services/categorization/caching.go` — `CategoryIndex` interface + `CachingCategorizer` decorator.
- `backend/internal/services/categorization/caching_test.go` — decorator tests with a fake index.

**Modify:**
- `backend/internal/services/categorization/embedding.go` — remove in-memory exact map; normalize input via `parse.NormalizeKey`.
- `backend/internal/services/categorization/embedding_test.go` — drop the exact-match short-circuit assertion if present.
- `backend/internal/config/config.go` — add `CategoryIndexEnabled` (`CATEGORY_INDEX_ENABLED`, default `"true"`).
- `backend/internal/config/config_test.go` — assert the new default.
- `backend/internal/services/list_service.go` — read-time normalization in `ListItems`.
- `backend/internal/services/list_service_test.go` — legacy-record normalization test.
- `backend/cmd/gracie-server/main.go` — build the Mongo index repo, `EnsureIndexes`, seed anchors, wrap the embedding categorizer.

---

## Task 1: `parse` package — Go port of `parseInput`

**Files:**
- Create: `backend/internal/parse/parse.go`
- Test: `backend/internal/parse/parse_test.go`

Reference (do not modify): `frontend/src/lib/parseInput.ts`.

- [ ] **Step 1: Write the failing tests**

Create `backend/internal/parse/parse_test.go`:

```go
package parse

import "testing"

func TestParseInput(t *testing.T) {
	cases := []struct {
		in              string
		desc, qty, unit string
	}{
		{"3 bags Milk", "Milk", "3", "bags"},
		{"1.5kg Beef", "Beef", "1.5", "kg"},
		{"2 lbs chicken breast", "chicken breast", "2", "lbs"},
		{"2 bell peppers", "bell peppers", "2", ""},
		{"5 large eggs", "large eggs", "5", ""},
		{"Milk", "Milk", "", ""},
		{"bell peppers", "bell peppers", "", ""},
		{"  Milk  ", "Milk", "", ""},
		{"2% milk", "2% milk", "", ""},
	}
	for _, c := range cases {
		d, q, u := ParseInput(c.in)
		if d != c.desc || q != c.qty || u != c.unit {
			t.Errorf("ParseInput(%q) = (%q,%q,%q), want (%q,%q,%q)", c.in, d, q, u, c.desc, c.qty, c.unit)
		}
	}
}

func TestNormalizeKey(t *testing.T) {
	cases := []struct{ in, want string }{
		{"2 lbs Chicken Breast", "chicken breast"},
		{"Chicken   Breast", "chicken breast"},
		{"1.5kg Beef", "beef"},
		{"Milk", "milk"},
		{"2 bell peppers", "bell peppers"},
	}
	for _, c := range cases {
		if got := NormalizeKey(c.in); got != c.want {
			t.Errorf("NormalizeKey(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && go test ./internal/parse/...`
Expected: FAIL — `undefined: ParseInput` / `undefined: NormalizeKey` (package won't compile).

- [ ] **Step 3: Write the implementation**

Create `backend/internal/parse/parse.go`:

```go
// Package parse extracts a leading quantity and unit from a free-text item
// description and produces a normalized categorization key. It is the Go port
// of the frontend frontend/src/lib/parseInput.ts and MUST stay behaviorally in
// sync with it (shared test cases guard this).
package parse

import (
	"regexp"
	"strings"
)

// quantityUnits is the allowlist ported verbatim from parseInput.ts. A word
// following a number is only treated as a unit if it appears here.
var quantityUnits = map[string]struct{}{
	"kg": {}, "g": {}, "lb": {}, "lbs": {}, "oz": {},
	"bag": {}, "bags": {},
	"bottle": {}, "bottles": {},
	"box": {}, "boxes": {},
	"pack": {}, "packs": {},
	"can": {}, "cans": {},
	"cup": {}, "cups": {},
	"tbsp": {}, "tablespoon": {}, "tablespoons": {},
	"tsp": {}, "teaspoon": {}, "teaspoons": {},
	"ml": {}, "l": {}, "liter": {}, "liters": {}, "litre": {}, "litres": {},
	"gal": {}, "gallon": {}, "gallons": {},
	"piece": {}, "pieces": {}, "pc": {}, "pcs": {},
	"dozen": {}, "doz": {},
	"bunch": {}, "bunches": {},
	"head": {}, "heads": {},
	"jar": {}, "jars": {},
	"carton": {}, "cartons": {},
	"stick": {}, "sticks": {},
	"slice": {}, "slices": {},
	"loaf": {}, "loaves": {},
	"roll": {}, "rolls": {},
	"sheet": {}, "sheets": {},
	"bar": {}, "bars": {},
	"tube": {}, "tubes": {},
	"clove": {}, "cloves": {},
}

// leadingQty mirrors the TS regex: optional number, a word, then the rest.
var leadingQty = regexp.MustCompile(`^([\d.]+)\s*([a-zA-Z]+)\s+(.+)$`)

// ParseInput splits a free-text input into (description, quantity, unit),
// stripping only a LEADING quantity + recognized unit. A number followed by a
// non-unit word (e.g. "2 bell peppers") yields that quantity with an empty unit
// and the words kept in the description. Inputs without a leading number are
// returned trimmed and unchanged.
func ParseInput(input string) (description, quantity, unit string) {
	trimmed := strings.TrimSpace(input)
	m := leadingQty.FindStringSubmatch(trimmed)
	if m == nil {
		return trimmed, "", ""
	}
	qty, word, rest := m[1], m[2], strings.TrimSpace(m[3])
	if _, ok := quantityUnits[strings.ToLower(word)]; ok {
		return rest, qty, word
	}
	// Word is not a unit (e.g. "bell", "large") — keep it in the description.
	return word + " " + rest, qty, ""
}

// NormalizeKey returns the canonical categorization key for a description:
// quantity/unit stripped, lowercased, internal whitespace collapsed and trimmed.
// Every read layer keys off this function so the keys line up exactly.
func NormalizeKey(description string) string {
	desc, _, _ := ParseInput(description)
	return strings.ToLower(strings.Join(strings.Fields(desc), " "))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/parse/...`
Expected: PASS (`ok ... internal/parse`).

- [ ] **Step 5: Commit**

```bash
cd backend && git add internal/parse/parse.go internal/parse/parse_test.go
git commit -m "feat(parse): port frontend quantity parser to backend"
```

---

## Task 2: Mongo `CategoryIndexRepo`

**Files:**
- Create: `backend/internal/store/mongo/category_index_repo.go`
- Test: `backend/internal/store/mongo/category_index_repo_test.go`

The integration test reuses the existing `connectOrSkip` helper in `backend/internal/store/mongo/mongo_integration_test.go` (same package), which skips when Mongo is unreachable.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/store/mongo/category_index_repo_test.go`:

```go
package mongo

import (
	"context"
	"testing"
)

func TestCategoryIndexRepo(t *testing.T) {
	c := connectOrSkip(t)
	repo := NewCategoryIndexRepo(c)
	ctx := context.Background()
	if err := repo.EnsureIndexes(ctx); err != nil {
		t.Fatalf("indexes: %v", err)
	}

	// Miss on empty collection.
	if _, found, err := repo.Lookup(ctx, "milk"); err != nil || found {
		t.Fatalf("lookup empty = (found=%v, err=%v), want (false, nil)", found, err)
	}

	// Upsert then hit.
	if err := repo.Upsert(ctx, "milk", "Eggs & Dairy"); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	cat, found, err := repo.Lookup(ctx, "milk")
	if err != nil || !found || cat != "Eggs & Dairy" {
		t.Fatalf("lookup = (%q, %v, %v), want (Eggs & Dairy, true, nil)", cat, found, err)
	}

	// Upsert is idempotent / last-writer-wins on the same key.
	if err := repo.Upsert(ctx, "milk", "General"); err != nil {
		t.Fatalf("re-upsert: %v", err)
	}
	cat, _, _ = repo.Lookup(ctx, "milk")
	if cat != "General" {
		t.Fatalf("after re-upsert cat = %q, want General", cat)
	}

	// Seed is idempotent and queryable.
	entries := []CategoryIndexEntry{{Key: "eggs", Category: "Eggs & Dairy"}, {Key: "milk", Category: "Eggs & Dairy"}}
	if err := repo.Seed(ctx, entries); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := repo.Seed(ctx, entries); err != nil {
		t.Fatalf("seed again: %v", err)
	}
	if cat, found, _ := repo.Lookup(ctx, "eggs"); !found || cat != "Eggs & Dairy" {
		t.Fatalf("seeded eggs = (%q, %v)", cat, found)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./internal/store/mongo/ -run TestCategoryIndexRepo`
Expected: FAIL — `undefined: NewCategoryIndexRepo` / `undefined: CategoryIndexEntry` (won't compile). (If Mongo is down the run would skip, but it fails to compile first, which is the expected failure.)

- [ ] **Step 3: Write the implementation**

Create `backend/internal/store/mongo/category_index_repo.go`:

```go
package mongo

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	mgo "go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// CategoryIndexEntry is a normalized-description -> category mapping used for
// seeding the index in bulk.
type CategoryIndexEntry struct {
	Key      string
	Category string
}

// categoryIndexDoc is the BSON shape stored in the category_index collection.
type categoryIndexDoc struct {
	Key       string    `bson:"key"`
	Category  string    `bson:"category"`
	UpdatedAt time.Time `bson:"updated_at"`
}

// CategoryIndexRepo is the MongoDB-backed exact-match cache of normalized
// descriptions to categories. It lets the categorizer skip the embedding model
// for known descriptions.
type CategoryIndexRepo struct{ db *mgo.Database }

func NewCategoryIndexRepo(c *Client) *CategoryIndexRepo { return &CategoryIndexRepo{db: c.DB} }
func (r *CategoryIndexRepo) col() *mgo.Collection         { return r.db.Collection("category_index") }

// EnsureIndexes creates the unique index on the normalized key.
func (r *CategoryIndexRepo) EnsureIndexes(ctx context.Context) error {
	_, err := r.col().Indexes().CreateOne(ctx, mgo.IndexModel{
		Keys:    bson.D{{Key: "key", Value: 1}},
		Options: options.Index().SetUnique(true),
	})
	return err
}

// Lookup returns the cached category for a normalized key, found=false when the
// key is absent.
func (r *CategoryIndexRepo) Lookup(ctx context.Context, key string) (string, bool, error) {
	var doc categoryIndexDoc
	err := r.col().FindOne(ctx, bson.D{{Key: "key", Value: key}}).Decode(&doc)
	if err != nil {
		if err == mgo.ErrNoDocuments {
			return "", false, nil
		}
		return "", false, err
	}
	return doc.Category, true, nil
}

// Upsert writes (or overwrites) the category for a normalized key. Idempotent,
// last-writer-wins.
func (r *CategoryIndexRepo) Upsert(ctx context.Context, key, category string) error {
	_, err := r.col().UpdateOne(ctx,
		bson.D{{Key: "key", Value: key}},
		bson.D{{Key: "$set", Value: bson.D{
			{Key: "category", Value: category},
			{Key: "updated_at", Value: time.Now().UTC()},
		}}},
		options.Update().SetUpsert(true),
	)
	return err
}

// Seed bulk-upserts entries. Idempotent; safe to run on every startup.
func (r *CategoryIndexRepo) Seed(ctx context.Context, entries []CategoryIndexEntry) error {
	if len(entries) == 0 {
		return nil
	}
	now := time.Now().UTC()
	models := make([]mgo.WriteModel, 0, len(entries))
	for _, e := range entries {
		models = append(models, mgo.NewUpdateOneModel().
			SetFilter(bson.D{{Key: "key", Value: e.Key}}).
			SetUpdate(bson.D{{Key: "$set", Value: bson.D{
				{Key: "category", Value: e.Category},
				{Key: "updated_at", Value: now},
			}}}).
			SetUpsert(true))
	}
	_, err := r.col().BulkWrite(ctx, models, options.BulkWrite().SetOrdered(false))
	return err
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && go test ./internal/store/mongo/ -run TestCategoryIndexRepo -v`
Expected: PASS, or `SKIP` with "mongo unavailable" if no local Mongo. Either is acceptable; it must compile and not FAIL.

- [ ] **Step 5: Commit**

```bash
cd backend && git add internal/store/mongo/category_index_repo.go internal/store/mongo/category_index_repo_test.go
git commit -m "feat(store): add Mongo category_index repo"
```

---

## Task 3: `CachingCategorizer` decorator

**Files:**
- Create: `backend/internal/services/categorization/caching.go`
- Test: `backend/internal/services/categorization/caching_test.go`

- [ ] **Step 1: Write the failing test**

Create `backend/internal/services/categorization/caching_test.go`:

```go
package categorization

import (
	"context"
	"errors"
	"testing"
)

// fakeIndex is an in-memory CategoryIndex with error injection.
type fakeIndex struct {
	data       map[string]string
	lookupErr  error
	upsertErr  error
	upsertKeys []string
}

func newFakeIndex() *fakeIndex { return &fakeIndex{data: map[string]string{}} }

func (f *fakeIndex) Lookup(ctx context.Context, key string) (string, bool, error) {
	if f.lookupErr != nil {
		return "", false, f.lookupErr
	}
	c, ok := f.data[key]
	return c, ok, nil
}

func (f *fakeIndex) Upsert(ctx context.Context, key, category string) error {
	if f.upsertErr != nil {
		return f.upsertErr
	}
	f.upsertKeys = append(f.upsertKeys, key)
	f.data[key] = category
	return nil
}

// stubCat records calls and returns a fixed result.
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
	inner := &stubCat{cat: "WRONG", conf: 0.9}
	c := NewCachingCategorizer(inner, idx)

	cat, conf, err := c.Categorize(context.Background(), "2 lbs Milk")
	if err != nil || cat != "Eggs & Dairy" || conf != 1.0 {
		t.Fatalf("got (%q,%v,%v), want (Eggs & Dairy,1,nil)", cat, conf, err)
	}
	if inner.calls != 0 {
		t.Fatalf("inner called %d times on cache hit, want 0", inner.calls)
	}
}

func TestCachingMissWritesThrough(t *testing.T) {
	idx := newFakeIndex()
	inner := &stubCat{cat: "Produce", conf: 0.8}
	c := NewCachingCategorizer(inner, idx)

	cat, _, err := c.Categorize(context.Background(), "2 Bananas")
	if err != nil || cat != "Produce" {
		t.Fatalf("got (%q,%v), want (Produce,nil)", cat, err)
	}
	if inner.calls != 1 {
		t.Fatalf("inner calls = %d, want 1", inner.calls)
	}
	if got, ok := idx.data["bananas"]; !ok || got != "Produce" {
		t.Fatalf("index[bananas] = (%q,%v), want (Produce,true)", got, ok)
	}
}

func TestCachingDoesNotCacheDeclineOrGeneral(t *testing.T) {
	// Decline ("").
	idx := newFakeIndex()
	c := NewCachingCategorizer(&stubCat{cat: "", conf: 0.1}, idx)
	if _, _, err := c.Categorize(context.Background(), "xyzzy"); err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(idx.upsertKeys) != 0 {
		t.Fatalf("decline was cached: %v", idx.upsertKeys)
	}

	// General must never be cached.
	idx2 := newFakeIndex()
	c2 := NewCachingCategorizer(&stubCat{cat: General, conf: 0.5}, idx2)
	if _, _, err := c2.Categorize(context.Background(), "mystery"); err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(idx2.upsertKeys) != 0 {
		t.Fatalf("General was cached: %v", idx2.upsertKeys)
	}
}

func TestCachingLookupErrorFallsThrough(t *testing.T) {
	idx := newFakeIndex()
	idx.lookupErr = errors.New("mongo down")
	inner := &stubCat{cat: "Produce", conf: 0.8}
	c := NewCachingCategorizer(inner, idx)

	cat, _, err := c.Categorize(context.Background(), "apple")
	if err != nil || cat != "Produce" {
		t.Fatalf("got (%q,%v), want (Produce,nil)", cat, err)
	}
	if inner.calls != 1 {
		t.Fatalf("inner calls = %d, want 1 (lookup error should not block)", inner.calls)
	}
}

func TestCachingUpsertErrorIsSwallowed(t *testing.T) {
	idx := newFakeIndex()
	idx.upsertErr = errors.New("write failed")
	c := NewCachingCategorizer(&stubCat{cat: "Produce", conf: 0.8}, idx)

	cat, _, err := c.Categorize(context.Background(), "apple")
	if err != nil || cat != "Produce" {
		t.Fatalf("got (%q,%v), want (Produce,nil) — upsert error must not surface", cat, err)
	}
}

func TestCachingInnerErrorPropagates(t *testing.T) {
	idx := newFakeIndex()
	boom := errors.New("model down")
	c := NewCachingCategorizer(&stubCat{err: boom}, idx)

	_, _, err := c.Categorize(context.Background(), "apple")
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want model down (so Chain degrades to keyword)", err)
	}
	if len(idx.upsertKeys) != 0 {
		t.Fatalf("error result was cached")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./internal/services/categorization/ -run TestCaching`
Expected: FAIL — `undefined: NewCachingCategorizer`.

- [ ] **Step 3: Write the implementation**

Create `backend/internal/services/categorization/caching.go`:

```go
package categorization

import (
	"context"
	"log"

	"github.com/janvillarosa/gracie-app/backend/internal/parse"
)

// CategoryIndex is the persistent exact-match cache the CachingCategorizer reads
// and writes. The Mongo repo (store/mongo.CategoryIndexRepo) satisfies it.
type CategoryIndex interface {
	Lookup(ctx context.Context, key string) (category string, found bool, err error)
	Upsert(ctx context.Context, key, category string) error
}

// CachingCategorizer wraps a single inner Categorizer (the embedding model) with
// a database-backed exact-match cache. It normalizes the description to a key,
// returns a cached category on a hit (skipping the model), and writes confident,
// non-General results back on a miss. Cache failures never block categorization.
//
// It is intended to wrap ONLY the embedding categorizer so keyword and General
// results — which flow through other Chain members — are never cached.
type CachingCategorizer struct {
	inner Categorizer
	index CategoryIndex
}

func NewCachingCategorizer(inner Categorizer, index CategoryIndex) *CachingCategorizer {
	return &CachingCategorizer{inner: inner, index: index}
}

func (c *CachingCategorizer) Categorize(ctx context.Context, description string) (string, float64, error) {
	key := parse.NormalizeKey(description)

	if cat, found, err := c.index.Lookup(ctx, key); err != nil {
		log.Printf("category_index: lookup failed for %q: %v (falling through to model)", key, err)
	} else if found {
		return cat, 1.0, nil
	}

	// Miss: run the model on the normalized text.
	cat, conf, err := c.inner.Categorize(ctx, key)
	if err != nil {
		return "", conf, err
	}

	// Write through only confident, placeable results.
	if cat != "" && cat != General {
		if err := c.index.Upsert(ctx, key, cat); err != nil {
			log.Printf("category_index: upsert failed for %q: %v (ignored)", key, err)
		}
	}
	return cat, conf, nil
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && go test ./internal/services/categorization/ -run TestCaching -v`
Expected: PASS (all `TestCaching*` subtests).

- [ ] **Step 5: Commit**

```bash
cd backend && git add internal/services/categorization/caching.go internal/services/categorization/caching_test.go
git commit -m "feat(categorization): add CachingCategorizer decorator"
```

---

## Task 4: Remove in-memory exact map from `EmbeddingCategorizer`

**Files:**
- Modify: `backend/internal/services/categorization/embedding.go`
- Modify (if needed): `backend/internal/services/categorization/embedding_test.go`

- [ ] **Step 1: Check the existing test for an exact-match assertion**

Run: `cd backend && grep -n "exact\|1.0\|short-circuit" internal/services/categorization/embedding_test.go`
Expected: identify any test asserting the in-memory exact short-circuit (confidence `1.0` without embedding). If one exists, it will need removal/adjustment in Step 4.

- [ ] **Step 2: Edit `embedding.go` — drop the `exact` field and short-circuit, normalize via `parse.NormalizeKey`**

In `backend/internal/services/categorization/embedding.go`:

Add the import:

```go
import (
	"context"
	"sort"

	"github.com/janvillarosa/gracie-app/backend/internal/parse"
)
```

(Remove the now-unused `"strings"` import.)

Remove the `exact` field from the struct so it reads:

```go
type EmbeddingCategorizer struct {
	embedder  Embedder
	anchorVec [][]float32 // normalized anchor embeddings, aligned with anchorCat
	anchorCat []string
	threshold float64
	topK      int
}
```

In `NewEmbeddingCategorizerWithEmbedder`, delete the `exact` map construction and the loop's `exact` assignment, and drop `exact:` from the returned struct literal:

```go
func NewEmbeddingCategorizerWithEmbedder(ctx context.Context, e Embedder, anchors []Anchor, threshold float64, topK int) (*EmbeddingCategorizer, error) {
	terms := make([]string, len(anchors))
	cats := make([]string, len(anchors))
	for i, a := range anchors {
		terms[i] = a.Term
		cats[i] = a.Category
	}
	raw, err := e.Embed(ctx, terms)
	if err != nil {
		return nil, err
	}
	vecs := make([][]float32, len(raw))
	for i, v := range raw {
		vecs[i] = normalize(v)
	}
	if topK < 1 {
		topK = 1
	}
	return &EmbeddingCategorizer{
		embedder:  e,
		anchorVec: vecs,
		anchorCat: cats,
		threshold: threshold,
		topK:      topK,
	}, nil
}
```

Replace the `Categorize` method body's normalization + exact short-circuit:

```go
// Categorize: embed the normalized text + kNN vote + threshold. The exact-match
// fast path now lives in the database-backed CachingCategorizer.
func (ec *EmbeddingCategorizer) Categorize(ctx context.Context, description string) (string, float64, error) {
	norm := parse.NormalizeKey(description)
	raw, err := ec.embedder.Embed(ctx, []string{norm})
	if err != nil {
		return "", 0, err
	}
	q := normalize(raw[0])

	neighbors := make([]scored, len(ec.anchorVec))
	for i := range ec.anchorVec {
		neighbors[i] = scored{category: ec.anchorCat[i], score: cosine(q, ec.anchorVec[i])}
	}
	sort.Slice(neighbors, func(i, j int) bool { return neighbors[i].score > neighbors[j].score })
	if len(neighbors) > ec.topK {
		neighbors = neighbors[:ec.topK]
	}

	cat, top := knnVote(neighbors)
	if float64(top) < ec.threshold {
		return "", float64(top), nil // decline; Chain applies fallback
	}
	return cat, float64(top), nil
}
```

- [ ] **Step 3: Run the categorization tests**

Run: `cd backend && go test ./internal/services/categorization/...`
Expected: possible FAIL if `embedding_test.go` asserted the removed exact short-circuit, or a compile error for the unused `strings` import elsewhere.

- [ ] **Step 4: Fix any broken assertion in `embedding_test.go`**

If Step 1/Step 3 surfaced a test that relied on the in-memory exact map returning confidence `1.0` without embedding, update it to expect the embedding path (the `fakeEmbedder` in that file drives kNN). Keep all other assertions. (If no such test exists, skip this step.)

Run again: `cd backend && go test ./internal/services/categorization/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend && git add internal/services/categorization/embedding.go internal/services/categorization/embedding_test.go
git commit -m "refactor(categorization): drop in-memory exact map; normalize via parse"
```

---

## Task 5: Config flag `CATEGORY_INDEX_ENABLED`

**Files:**
- Modify: `backend/internal/config/config.go`
- Modify: `backend/internal/config/config_test.go`

- [ ] **Step 1: Add the failing test assertion**

In `backend/internal/config/config_test.go`, add to the default-values test (alongside the existing `EmbeddingEnabled` default check) — and add `CATEGORY_INDEX_ENABLED` to the env-unset list at the top of that test:

```go
	if !cfg.CategoryIndexEnabled {
		t.Errorf("CategoryIndexEnabled default = false, want true")
	}
```

And extend the cleanup slice (currently `[]string{"EMBEDDING_ENABLED", "EMBEDDING_MODEL_PATH", "EMBED_THRESHOLD", "EMBED_TOPK"}`) to include `"CATEGORY_INDEX_ENABLED"`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./internal/config/...`
Expected: FAIL — `cfg.CategoryIndexEnabled undefined`.

- [ ] **Step 3: Add the field and load it**

In `backend/internal/config/config.go`, add to the `Config` struct (near `EmbeddingEnabled`):

```go
	CategoryIndexEnabled bool
```

In `Load()`, after the `cfg.EmbedTopK = ...` line, add:

```go
	cfg.CategoryIndexEnabled = getEnv("CATEGORY_INDEX_ENABLED", "true") == "true"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && go test ./internal/config/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend && git add internal/config/config.go internal/config/config_test.go
git commit -m "feat(config): add CATEGORY_INDEX_ENABLED flag (default true)"
```

---

## Task 6: Read-time backwards-compat normalization in `ListItems`

**Files:**
- Modify: `backend/internal/services/list_service.go`
- Test: `backend/internal/services/list_service_test.go`

This normalizes legacy rows whose quantity/unit is still baked into `description`, non-destructively (response only; the DB row is untouched).

- [ ] **Step 1: Write the failing test**

Add to `backend/internal/services/list_service_test.go`:

```go
func TestNormalizeLegacyItemForRead(t *testing.T) {
	// Legacy row: quantity baked into description, empty Quantity field.
	legacy := models.ListItem{Description: "2 lbs chicken breast", Quantity: "", Unit: ""}
	got := normalizeItemForRead(legacy)
	if got.Description != "chicken breast" || got.Quantity != "2" || got.Unit != "lbs" {
		t.Fatalf("legacy normalize = (%q,%q,%q), want (chicken breast,2,lbs)", got.Description, got.Quantity, got.Unit)
	}

	// Already-split row: must be left untouched (no double-strip).
	split := models.ListItem{Description: "chicken breast", Quantity: "2", Unit: "lbs"}
	got2 := normalizeItemForRead(split)
	if got2.Description != "chicken breast" || got2.Quantity != "2" || got2.Unit != "lbs" {
		t.Fatalf("split normalize changed item: (%q,%q,%q)", got2.Description, got2.Quantity, got2.Unit)
	}

	// Plain description, no quantity: unchanged.
	plain := models.ListItem{Description: "bell peppers", Quantity: "", Unit: ""}
	got3 := normalizeItemForRead(plain)
	if got3.Description != "bell peppers" || got3.Quantity != "" || got3.Unit != "" {
		t.Fatalf("plain normalize changed item: (%q,%q,%q)", got3.Description, got3.Quantity, got3.Unit)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./internal/services/ -run TestNormalizeLegacyItemForRead`
Expected: FAIL — `undefined: normalizeItemForRead`.

- [ ] **Step 3: Add the helper and apply it in `ListItems`**

In `backend/internal/services/list_service.go`, add the `parse` import:

```go
	"github.com/janvillarosa/gracie-app/backend/internal/parse"
```

Add the helper (e.g. just above `ListItems`):

```go
// normalizeItemForRead splits a legacy item whose quantity/unit is still baked
// into the description. Non-destructive: it only rewrites the returned copy, and
// only when the Quantity field is empty (so already-split items are untouched).
func normalizeItemForRead(it models.ListItem) models.ListItem {
	if it.Quantity != "" {
		return it
	}
	desc, qty, unit := parse.ParseInput(it.Description)
	if qty == "" {
		return it
	}
	it.Description = desc
	it.Quantity = qty
	it.Unit = unit
	return it
}
```

In `ListItems`, apply it when appending (the loop currently does `out = append(out, it)`):

```go
		out = append(out, normalizeItemForRead(it))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/services/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend && git add internal/services/list_service.go internal/services/list_service_test.go
git commit -m "feat(list): normalize legacy item quantity on read (non-destructive)"
```

---

## Task 7: Wire the index into `main.go`

**Files:**
- Modify: `backend/cmd/gracie-server/main.go`

Threads the Mongo index repo into categorizer construction, ensures its index, seeds the anchors, and wraps the embedding categorizer. No unit test (wiring); validated by build + `go vet` + the manual smoke check below.

- [ ] **Step 1: Build the index repo, ensure indexes, and seed anchors**

In `main()`, after the existing `itemsRepo := mongostore.NewListItemRepo(mcli)` / `EnsureIndexes` block and before `categorizers := buildCategorizers(ctx, cfg)`, add:

```go
	var categoryIndex *mongostore.CategoryIndexRepo
	if cfg.CategoryIndexEnabled {
		categoryIndex = mongostore.NewCategoryIndexRepo(mcli)
		if err := categoryIndex.EnsureIndexes(ctx); err != nil {
			log.Printf("category_index: ensure indexes failed: %v (continuing without cache)", err)
			categoryIndex = nil
		} else {
			seed := make([]mongostore.CategoryIndexEntry, 0, len(categorization.GroceryAnchors))
			for _, a := range categorization.GroceryAnchors {
				seed = append(seed, mongostore.CategoryIndexEntry{Key: parse.NormalizeKey(a.Term), Category: a.Category})
			}
			if err := categoryIndex.Seed(ctx, seed); err != nil {
				log.Printf("category_index: anchor seed failed: %v (continuing)", err)
			} else {
				log.Printf("category_index: seeded %d anchors", len(seed))
			}
		}
	}
```

Add imports `"github.com/janvillarosa/gracie-app/backend/internal/parse"` and ensure `categorization` and `mongostore` aliases are already imported (they are).

- [ ] **Step 2: Thread the index through `buildCategorizers` / `domainCategorizer` and wrap embedding**

Change `buildCategorizers` to accept the index and pass it down:

```go
func buildCategorizers(ctx context.Context, cfg *config.Config, index categorization.CategoryIndex) map[string]categorization.Categorizer {
	emb := buildEmbedder(ctx, cfg)
	return map[string]categorization.Categorizer{
		"grocery": domainCategorizer(ctx, emb, categorization.GroceryAnchors, categorization.General, cfg, index),
	}
}
```

Change `domainCategorizer` to wrap the embedding categorizer with the cache when an index is present:

```go
func domainCategorizer(ctx context.Context, emb categorization.Embedder, anchors []categorization.Anchor, fallback string, cfg *config.Config, index categorization.CategoryIndex) categorization.Categorizer {
	keyword := categorization.NewKeywordCategorizer(anchors)
	if emb == nil {
		return categorization.NewChain(fallback, keyword)
	}
	ec, err := categorization.NewEmbeddingCategorizerWithEmbedder(ctx, emb, anchors, cfg.EmbedThreshold, cfg.EmbedTopK)
	if err != nil {
		log.Printf("categorization: anchor embedding failed (%v); keyword-only for this domain", err)
		return categorization.NewChain(fallback, keyword)
	}
	var embMember categorization.Categorizer = ec
	if index != nil {
		embMember = categorization.NewCachingCategorizer(ec, index)
	}
	return categorization.NewChain(fallback, embMember, keyword)
}
```

Update the call site:

```go
	categorizers := buildCategorizers(ctx, cfg, indexArg(categoryIndex))
```

where the embedding categorizer is wrapped only when `categoryIndex != nil`. To pass a typed-nil safely (avoid a non-nil interface wrapping a nil pointer), add this tiny helper near `buildCategorizers`:

```go
// indexArg converts a possibly-nil concrete repo into a clean nil interface so
// domainCategorizer's `index != nil` check works correctly.
func indexArg(r *mongostore.CategoryIndexRepo) categorization.CategoryIndex {
	if r == nil {
		return nil
	}
	return r
}
```

- [ ] **Step 3: Build and vet**

Run: `cd backend && go build ./... && go vet ./...`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `cd backend && go test ./...`
Expected: PASS (Mongo-dependent tests may SKIP if no local Mongo).

- [ ] **Step 5: Commit**

```bash
cd backend && git add cmd/gracie-server/main.go
git commit -m "feat(server): wire category index cache into categorizer chain"
```

---

## Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole backend suite + vet**

Run: `cd backend && go vet ./... && go test ./...`
Expected: PASS / SKIP (no FAIL). Note in the task log whether Mongo integration tests ran or skipped.

- [ ] **Step 2: Optional manual smoke (requires local Mongo + model)**

If a local Mongo and embedding model are available:

```bash
cd backend && EMBEDDING_ENABLED=true CATEGORY_INDEX_ENABLED=true go run ./cmd/gracie-server
```

Expected log lines: `category_index: seeded <N> anchors` and `categorization: embedding model loaded ...`. Create an item via the API, then inspect Mongo: `db.category_index.find({key: "<normalized desc>"})` should contain the learned mapping after a novel description is categorized.

- [ ] **Step 3: Final commit (if any verification fixes were needed)**

```bash
cd backend && git add -A && git commit -m "test: verify category index integration"
```

---

## Self-Review Notes

- **Spec coverage:** Component 1 → Task 1; Component 2 → Task 2; Component 3 → Tasks 3+4; Component 4 → Task 6; Component 5 (wiring/config/seed) → Tasks 5+7. All covered.
- **Type consistency:** `CategoryIndex` interface (`Lookup`/`Upsert`) in Task 3 is satisfied by `CategoryIndexRepo` (Task 2). `CategoryIndexEntry` defined in Task 2 used in Task 7. `NormalizeKey`/`ParseInput` (Task 1) used in Tasks 3, 6, 7. `NewCachingCategorizer(inner, index)` signature consistent across Tasks 3 and 7.
- **Decline/General never cached:** enforced in Task 3 (`cat != "" && cat != General`) and structurally by wrapping only the embedding member (Task 7), so keyword/General results bypass the cache.
- **Graceful degradation:** lookup errors fall through, upsert errors are swallowed (Task 3); index/seed failures degrade to no-cache (Task 7).
