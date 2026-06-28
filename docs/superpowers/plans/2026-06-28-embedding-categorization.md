# Embedding-Based Grocery Categorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded substring categorizer with a self-contained semantic categorizer that runs a small sentence-embedding model in-process and matches new grocery items to the existing keyword list by meaning (kNN), with the keyword matcher kept as a graceful fallback.

**Architecture:** A new `categorization` package defines a `Categorizer` interface. `KeywordCategorizer` holds today's logic (the single source of truth for the term→category list). `EmbeddingCategorizer` embeds an item and finds the nearest anchors among that same term list, voting by cosine similarity. A `Chain` runs embedding first and falls back to keyword matching when embedding declines or errors. `ListService` depends only on the `Categorizer` interface (constructor-injected).

**Tech Stack:** Go 1.22, `github.com/knights-analytics/hugot` (pure-Go backend, no CGO/native libs), `all-MiniLM-L6-v2` ONNX model, MongoDB, Docker, Railway.

---

## Deviations From The Approved Spec (read first)

The spec (`docs/superpowers/specs/2026-06-28-embedding-categorization-design.md`) was approved before library research. Two conscious changes, both reducing risk:

1. **Pure-Go hugot backend instead of CGO + `libonnxruntime.so`.** hugot's `NewGoSession` runs ONNX inference and tokenization in pure Go. This keeps the existing `CGO_ENABLED=0` Alpine Docker build, removes the native shared-library/glibc/debian-slim work, and removes the cross-compile caveat. The ORT backend (faster, CGO) remains a documented upgrade path. Everything stays **in-process**, honoring the spec's decision.

2. **Anchors stay a Go slice (`DefaultRules`), not `anchors.json`.** The keyword matcher and the embedding anchor set are the *same* list. Keeping one in-memory slice as the single source of truth is DRY and type-safe. Since anchors are baked into the image either way (no external storage), a JSON file would add file/embed plumbing with no deploy-time benefit. Adding an item is still a one-line declarative data edit.

Everything else follows the spec: kNN vote, exact-match short-circuit, threshold→General, feature-flagged rollout, keyword fallback, accuracy benchmark.

---

## File Structure

**New package `backend/internal/services/categorization/`:**
- `categorizer.go` — `Categorizer` interface and shared doc.
- `rules.go` — `Rule` type and `DefaultRules` (the term→category list, moved verbatim from `list_service.go`). Single source of truth.
- `keyword.go` — `KeywordCategorizer` (substring matching over `DefaultRules`).
- `keyword_test.go` — migrated 97-case regression suite.
- `vector.go` — `cosine`, `normalize`, and kNN vote pure functions.
- `vector_test.go` — pure-math unit tests (no model).
- `embedder.go` — `Embedder` interface (abstraction over hugot).
- `embedding.go` — `EmbeddingCategorizer` (exact-match → kNN → threshold).
- `embedding_test.go` — categorizer logic tests using a fake `Embedder`.
- `chain.go` — `Chain` composite (primary + fallback, graceful degradation).
- `chain_test.go` — ordering and fallback tests using fakes.
- `hugot_embedder.go` — `HugotEmbedder` (real hugot adapter, pure-Go backend).
- `hugot_embedder_test.go` — integration test, skips when model files absent.
- `benchmark_test.go` — accuracy benchmark: Chain (embedding+keyword) vs keyword baseline.

**Modified:**
- `backend/internal/services/list_service.go` — remove `autoCategorize`; `ListService` gains a `categorizer` field; `NewListService` gains a parameter; `CreateItem` calls the injected categorizer.
- `backend/internal/services/categorization_test.go` — deleted (migrated into the new package).
- `backend/internal/config/config.go` — new embedding env vars.
- `backend/internal/config/config_test.go` — defaults for new vars.
- `backend/cmd/gracie-server/main.go` — build the categorizer, inject it.
- `backend/cmd/fetch-model/main.go` — **new** tiny build-time tool to download the model.
- `backend/Dockerfile`, `backend/Dockerfile.railway` — download + bake the model into the image.

---

## Categorizer Contract (used by every task)

```go
// Categorize returns a category and a confidence in [0,1].
// A categorizer DECLINES by returning an empty category ("") — either because
// it has no opinion (e.g. below confidence threshold, or no keyword match) or
// because of a recoverable error (err != nil). The Chain treats both an empty
// category and a non-nil error as "try the next categorizer". Only the Chain
// applies the final "General" default.
type Categorizer interface {
    Categorize(ctx context.Context, description string) (category string, confidence float64, err error)
}
```

Semantics every implementer must honor:
- `KeywordCategorizer`: never errors. Returns `(category, 1.0, nil)` on a substring match, else `("", 0, nil)`.
- `EmbeddingCategorizer`: returns `("", 0, err)` on model error; `(category, confidence, nil)` when top-1 cosine ≥ threshold; `("", confidence, nil)` when below threshold (declines).
- `Chain`: tries members in order; first non-empty category wins; if all decline, returns `("General", 0, nil)`.

---

## Task 1: Scaffold package, interface, and move the rule list

**Files:**
- Create: `backend/internal/services/categorization/categorizer.go`
- Create: `backend/internal/services/categorization/rules.go`

- [ ] **Step 1: Create the interface file**

`backend/internal/services/categorization/categorizer.go`:

```go
// Package categorization assigns a grocery category to a free-text item
// description. It exposes a Categorizer interface with three strategies:
// keyword substring matching, semantic embedding kNN, and a fallback Chain.
package categorization

import "context"

// Categorizer assigns a category to a description. See the plan's
// "Categorizer Contract" for the decline ("") and error semantics.
type Categorizer interface {
	Categorize(ctx context.Context, description string) (category string, confidence float64, err error)
}

// General is the fallback category for items no strategy can place.
const General = "General"
```

- [ ] **Step 2: Move the rule list verbatim into `rules.go`**

Create `backend/internal/services/categorization/rules.go`. Define the type, then copy **every** `{k: ..., v: ...}` entry from the `rules` slice currently in `list_service.go` (lines 363–604) into `DefaultRules`, renaming fields `k→Term`, `v→Category`. **Preserve the exact order** — the keyword matcher depends on specific-before-generic ordering.

```go
package categorization

// Rule maps a lowercase keyword/phrase to a category. The ordering of
// DefaultRules matters for substring matching (specific phrases first),
// and the same list doubles as the anchor set for embedding kNN.
type Rule struct {
	Term     string
	Category string
}

// DefaultRules is the single source of truth for both keyword matching and
// embedding anchors. Add new items here (data, not logic).
var DefaultRules = []Rule{
	// --- paste all entries from list_service.go rules slice here, in order ---
	{Term: "butternut squash", Category: "Produce"},
	{Term: "winter squash", Category: "Produce"},
	// ... (continue through every existing entry, ending with) ...
	{Term: "drink", Category: "Beverages"},
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd backend && go build ./internal/services/categorization/`
Expected: builds with no errors.

- [ ] **Step 4: Commit**

```bash
cd backend && git add internal/services/categorization/categorizer.go internal/services/categorization/rules.go
git commit -m "feat(categorization): scaffold package and move rule list to single source"
```

---

## Task 2: KeywordCategorizer + migrate the regression suite

**Files:**
- Create: `backend/internal/services/categorization/keyword.go`
- Create: `backend/internal/services/categorization/keyword_test.go`

- [ ] **Step 1: Write the failing test (migrated 97 cases)**

Create `keyword_test.go`. Copy the full `tests` table from the existing `backend/internal/services/categorization_test.go` (all 97 `{desc, want}` cases) into the table below. Because `KeywordCategorizer` declines with `""` instead of returning `"General"`, the test applies the `General` default itself.

```go
package categorization

import (
	"context"
	"testing"
)

func TestKeywordCategorizer(t *testing.T) {
	kc := NewKeywordCategorizer()
	ctx := context.Background()

	tests := []struct {
		desc string
		want string
	}{
		{"Butternut Squash", "Produce"},
		{"Banana Ketchup", "Pantry"},
		{"Peanut Butter", "Pantry"},
		{"Butter", "Eggs & Dairy"},
		{"Banana", "Produce"},
		// ... paste the remaining cases from categorization_test.go ...
	}

	for _, tt := range tests {
		cat, _, err := kc.Categorize(ctx, tt.desc)
		if err != nil {
			t.Fatalf("%q: unexpected error: %v", tt.desc, err)
		}
		if cat == "" {
			cat = General
		}
		if cat != tt.want {
			t.Errorf("Categorize(%q) = %q, want %q", tt.desc, cat, tt.want)
		}
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && go test ./internal/services/categorization/ -run TestKeywordCategorizer`
Expected: FAIL — `NewKeywordCategorizer` undefined.

- [ ] **Step 3: Implement `KeywordCategorizer`**

`backend/internal/services/categorization/keyword.go`:

```go
package categorization

import (
	"context"
	"strings"
)

// KeywordCategorizer matches a lowercased description against DefaultRules
// using ordered substring matching. It is the permanent fallback strategy.
type KeywordCategorizer struct {
	rules []Rule
}

// NewKeywordCategorizer builds a matcher over DefaultRules.
func NewKeywordCategorizer() *KeywordCategorizer {
	return &KeywordCategorizer{rules: DefaultRules}
}

// Categorize returns (category, 1.0, nil) on the first substring match, or
// ("", 0, nil) when nothing matches (declines; the Chain applies General).
func (k *KeywordCategorizer) Categorize(_ context.Context, description string) (string, float64, error) {
	d := strings.ToLower(description)
	for _, r := range k.rules {
		if strings.Contains(d, r.Term) {
			return r.Category, 1.0, nil
		}
	}
	return "", 0, nil
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && go test ./internal/services/categorization/ -run TestKeywordCategorizer -v`
Expected: PASS for all cases. If any case fails, the rule list in Task 1 was pasted incompletely or out of order — fix `rules.go`.

- [ ] **Step 5: Commit**

```bash
cd backend && git add internal/services/categorization/keyword.go internal/services/categorization/keyword_test.go
git commit -m "feat(categorization): add KeywordCategorizer with migrated regression suite"
```

---

## Task 3: Vector math (cosine, normalize, kNN vote)

**Files:**
- Create: `backend/internal/services/categorization/vector.go`
- Create: `backend/internal/services/categorization/vector_test.go`

- [ ] **Step 1: Write the failing tests**

`backend/internal/services/categorization/vector_test.go`:

```go
package categorization

import (
	"math"
	"testing"
)

func almost(a, b float32) bool { return math.Abs(float64(a-b)) < 1e-5 }

func TestCosineIdenticalIsOne(t *testing.T) {
	a := []float32{1, 2, 3}
	if got := cosine(a, a); !almost(got, 1.0) {
		t.Errorf("cosine(a,a) = %v, want 1.0", got)
	}
}

func TestCosineOrthogonalIsZero(t *testing.T) {
	if got := cosine([]float32{1, 0}, []float32{0, 1}); !almost(got, 0.0) {
		t.Errorf("cosine = %v, want 0.0", got)
	}
}

func TestNormalizeUnitLength(t *testing.T) {
	v := normalize([]float32{3, 4})
	if !almost(v[0], 0.6) || !almost(v[1], 0.8) {
		t.Errorf("normalize([3,4]) = %v, want [0.6 0.8]", v)
	}
}

func TestKNNVoteWeightsBySimilarity(t *testing.T) {
	// Two "Produce" neighbors at 0.9/0.8 outvote one "Pantry" at 0.85.
	neighbors := []scored{
		{category: "Produce", score: 0.9},
		{category: "Pantry", score: 0.85},
		{category: "Produce", score: 0.8},
	}
	cat, top := knnVote(neighbors)
	if cat != "Produce" {
		t.Errorf("knnVote category = %q, want Produce", cat)
	}
	if !almost(top, 0.9) {
		t.Errorf("knnVote top score = %v, want 0.9", top)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && go test ./internal/services/categorization/ -run 'TestCosine|TestNormalize|TestKNN'`
Expected: FAIL — `cosine`, `normalize`, `scored`, `knnVote` undefined.

- [ ] **Step 3: Implement the math**

`backend/internal/services/categorization/vector.go`:

```go
package categorization

import (
	"math"
	"sort"
)

// scored is one neighbor's category and its cosine similarity to the query.
type scored struct {
	category string
	score    float32
}

// cosine returns the cosine similarity of two equal-length vectors.
func cosine(a, b []float32) float32 {
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return float32(dot / (math.Sqrt(na) * math.Sqrt(nb)))
}

// normalize returns the L2-normalized copy of v (zero vector returned as-is).
func normalize(v []float32) []float32 {
	var n float64
	for _, x := range v {
		n += float64(x) * float64(x)
	}
	if n == 0 {
		return v
	}
	inv := float32(1.0 / math.Sqrt(n))
	out := make([]float32, len(v))
	for i, x := range v {
		out[i] = x * inv
	}
	return out
}

// knnVote sums similarity per category across the given neighbors and returns
// the winning category plus the single highest neighbor score (used as the
// confidence / threshold value).
func knnVote(neighbors []scored) (string, float32) {
	weight := map[string]float32{}
	var top float32
	for _, n := range neighbors {
		weight[n.category] += n.score
		if n.score > top {
			top = n.score
		}
	}
	// Deterministic winner: highest weight, ties broken by category name.
	type kv struct {
		cat string
		w   float32
	}
	pairs := make([]kv, 0, len(weight))
	for c, w := range weight {
		pairs = append(pairs, kv{c, w})
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].w != pairs[j].w {
			return pairs[i].w > pairs[j].w
		}
		return pairs[i].cat < pairs[j].cat
	})
	if len(pairs) == 0 {
		return "", 0
	}
	return pairs[0].cat, top
}
```

- [ ] **Step 4: Run to verify passing**

Run: `cd backend && go test ./internal/services/categorization/ -run 'TestCosine|TestNormalize|TestKNN' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend && git add internal/services/categorization/vector.go internal/services/categorization/vector_test.go
git commit -m "feat(categorization): add cosine/normalize/knnVote vector math"
```

---

## Task 4: Embedder interface + EmbeddingCategorizer (with fake)

**Files:**
- Create: `backend/internal/services/categorization/embedder.go`
- Create: `backend/internal/services/categorization/embedding.go`
- Create: `backend/internal/services/categorization/embedding_test.go`

- [ ] **Step 1: Define the Embedder interface**

`backend/internal/services/categorization/embedder.go`:

```go
package categorization

import "context"

// Embedder turns texts into fixed-length vectors. It abstracts the model
// backend so the categorizer logic is testable without loading a real model.
type Embedder interface {
	// Embed returns one vector per input text, in order.
	Embed(ctx context.Context, texts []string) ([][]float32, error)
	// Close releases any model resources.
	Close() error
}
```

- [ ] **Step 2: Write the failing test (fake embedder)**

`backend/internal/services/categorization/embedding_test.go`:

```go
package categorization

import (
	"context"
	"testing"
)

// fakeEmbedder maps known phrases to fixed 2-D vectors so cosine results are
// predictable. Unknown phrases map to a far-away vector.
type fakeEmbedder struct{}

func (fakeEmbedder) Close() error { return nil }
func (fakeEmbedder) Embed(_ context.Context, texts []string) ([][]float32, error) {
	vecs := map[string][]float32{
		"milk":       {1, 0},
		"whole milk": {0.98, 0.20}, // near "milk"
		"cheddar":    {0, 1},
		"xyzzy":      {-1, -1}, // far from everything
	}
	out := make([][]float32, len(texts))
	for i, t := range texts {
		if v, ok := vecs[t]; ok {
			out[i] = v
		} else {
			out[i] = []float32{-1, -1}
		}
	}
	return out, nil
}

func newTestCategorizer(t *testing.T) *EmbeddingCategorizer {
	t.Helper()
	anchors := []Rule{
		{Term: "milk", Category: "Eggs & Dairy"},
		{Term: "cheddar", Category: "Eggs & Dairy"},
	}
	ec, err := NewEmbeddingCategorizerWithEmbedder(context.Background(), fakeEmbedder{}, anchors, 0.5, 5)
	if err != nil {
		t.Fatalf("build categorizer: %v", err)
	}
	return ec
}

func TestEmbeddingExactMatchShortCircuit(t *testing.T) {
	ec := newTestCategorizer(t)
	cat, conf, err := ec.Categorize(context.Background(), "Milk")
	if err != nil {
		t.Fatal(err)
	}
	if cat != "Eggs & Dairy" || conf != 1.0 {
		t.Errorf("got (%q, %v), want (Eggs & Dairy, 1.0)", cat, conf)
	}
}

func TestEmbeddingNearestNeighbor(t *testing.T) {
	ec := newTestCategorizer(t)
	cat, conf, err := ec.Categorize(context.Background(), "whole milk")
	if err != nil {
		t.Fatal(err)
	}
	if cat != "Eggs & Dairy" {
		t.Errorf("got %q, want Eggs & Dairy", cat)
	}
	if conf < 0.9 {
		t.Errorf("confidence %v, want >= 0.9", conf)
	}
}

func TestEmbeddingBelowThresholdDeclines(t *testing.T) {
	ec := newTestCategorizer(t)
	cat, _, err := ec.Categorize(context.Background(), "xyzzy")
	if err != nil {
		t.Fatal(err)
	}
	if cat != "" {
		t.Errorf("got %q, want \"\" (decline)", cat)
	}
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && go test ./internal/services/categorization/ -run TestEmbedding`
Expected: FAIL — `EmbeddingCategorizer` / `NewEmbeddingCategorizerWithEmbedder` undefined.

- [ ] **Step 4: Implement `EmbeddingCategorizer`**

`backend/internal/services/categorization/embedding.go`:

```go
package categorization

import (
	"context"
	"sort"
	"strings"
)

// EmbeddingCategorizer assigns categories by embedding the description and
// finding the nearest anchors among DefaultRules (kNN, similarity-weighted).
type EmbeddingCategorizer struct {
	embedder  Embedder
	anchorVec [][]float32 // normalized anchor embeddings, aligned with anchorCat
	anchorCat []string
	exact     map[string]string // lowercased term -> category
	threshold float64
	topK      int
}

// NewEmbeddingCategorizerWithEmbedder builds the categorizer from an explicit
// Embedder and anchor list, embedding all anchors once. Used in tests and by
// NewEmbeddingCategorizer.
func NewEmbeddingCategorizerWithEmbedder(ctx context.Context, e Embedder, anchors []Rule, threshold float64, topK int) (*EmbeddingCategorizer, error) {
	terms := make([]string, len(anchors))
	cats := make([]string, len(anchors))
	exact := make(map[string]string, len(anchors))
	for i, a := range anchors {
		terms[i] = a.Term
		cats[i] = a.Category
		// First rule wins on duplicate terms, matching ordered keyword priority.
		if _, ok := exact[a.Term]; !ok {
			exact[a.Term] = a.Category
		}
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
		exact:     exact,
		threshold: threshold,
		topK:      topK,
	}, nil
}

// Categorize: exact-match short-circuit, else embed + kNN vote + threshold.
func (ec *EmbeddingCategorizer) Categorize(ctx context.Context, description string) (string, float64, error) {
	norm := strings.ToLower(strings.Join(strings.Fields(description), " "))
	if cat, ok := ec.exact[norm]; ok {
		return cat, 1.0, nil
	}
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
		return "", float64(top), nil // decline; Chain applies General
	}
	return cat, float64(top), nil
}
```

- [ ] **Step 5: Run to verify passing**

Run: `cd backend && go test ./internal/services/categorization/ -run TestEmbedding -v`
Expected: PASS for all three tests.

- [ ] **Step 6: Commit**

```bash
cd backend && git add internal/services/categorization/embedder.go internal/services/categorization/embedding.go internal/services/categorization/embedding_test.go
git commit -m "feat(categorization): add Embedder interface and EmbeddingCategorizer"
```

---

## Task 5: Chain composite (primary + graceful fallback)

**Files:**
- Create: `backend/internal/services/categorization/chain.go`
- Create: `backend/internal/services/categorization/chain_test.go`

- [ ] **Step 1: Write the failing tests**

`backend/internal/services/categorization/chain_test.go`:

```go
package categorization

import (
	"context"
	"errors"
	"testing"
)

// stub is a Categorizer returning a fixed result.
type stub struct {
	cat  string
	conf float64
	err  error
}

func (s stub) Categorize(context.Context, string) (string, float64, error) {
	return s.cat, s.conf, s.err
}

func TestChainUsesFirstNonEmpty(t *testing.T) {
	c := NewChain(stub{cat: "Produce", conf: 0.8}, stub{cat: "Pantry", conf: 1.0})
	cat, _, _ := c.Categorize(context.Background(), "x")
	if cat != "Produce" {
		t.Errorf("got %q, want Produce", cat)
	}
}

func TestChainFallsBackOnDecline(t *testing.T) {
	c := NewChain(stub{cat: ""}, stub{cat: "Pantry", conf: 1.0})
	cat, _, _ := c.Categorize(context.Background(), "x")
	if cat != "Pantry" {
		t.Errorf("got %q, want Pantry", cat)
	}
}

func TestChainFallsBackOnError(t *testing.T) {
	c := NewChain(stub{err: errors.New("model down")}, stub{cat: "Pantry", conf: 1.0})
	cat, _, err := c.Categorize(context.Background(), "x")
	if err != nil {
		t.Fatalf("chain should swallow member error, got %v", err)
	}
	if cat != "Pantry" {
		t.Errorf("got %q, want Pantry", cat)
	}
}

func TestChainAllDeclineReturnsGeneral(t *testing.T) {
	c := NewChain(stub{cat: ""}, stub{cat: ""})
	cat, _, _ := c.Categorize(context.Background(), "x")
	if cat != General {
		t.Errorf("got %q, want General", cat)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && go test ./internal/services/categorization/ -run TestChain`
Expected: FAIL — `NewChain` undefined.

- [ ] **Step 3: Implement `Chain`**

`backend/internal/services/categorization/chain.go`:

```go
package categorization

import "context"

// Chain tries each member in order and returns the first non-empty category.
// A member that errors or declines ("") is skipped, giving graceful
// degradation (e.g. embedding model down -> keyword matcher). If every member
// declines, Chain returns the General fallback.
type Chain struct {
	members []Categorizer
}

// NewChain builds a Chain from the given strategies, in priority order.
func NewChain(members ...Categorizer) *Chain {
	return &Chain{members: members}
}

func (c *Chain) Categorize(ctx context.Context, description string) (string, float64, error) {
	for _, m := range c.members {
		cat, conf, err := m.Categorize(ctx, description)
		if err != nil || cat == "" {
			continue
		}
		return cat, conf, nil
	}
	return General, 0, nil
}
```

- [ ] **Step 4: Run to verify passing**

Run: `cd backend && go test ./internal/services/categorization/ -run TestChain -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend && git add internal/services/categorization/chain.go internal/services/categorization/chain_test.go
git commit -m "feat(categorization): add Chain composite with graceful fallback"
```

---

## Task 6: Wire the categorizer into ListService

**Files:**
- Modify: `backend/internal/services/list_service.go`
- Delete: `backend/internal/services/categorization_test.go`
- Modify: `backend/cmd/gracie-server/main.go:38` (the `NewListService(...)` call)

- [ ] **Step 1: Add the dependency to `ListService`**

In `backend/internal/services/list_service.go`, add the import and field, and extend the constructor:

```go
import (
	// ... existing imports ...
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
)

type ListService struct {
	users       store.UserRepository
	rooms       store.RoomRepository
	lists       store.ListRepository
	items       store.ListItemRepository
	categorizer categorization.Categorizer
}

func NewListService(users store.UserRepository, rooms store.RoomRepository, lists store.ListRepository, items store.ListItemRepository, categorizer categorization.Categorizer) *ListService {
	return &ListService{users: users, rooms: rooms, lists: lists, items: items, categorizer: categorizer}
}
```

- [ ] **Step 2: Replace `autoCategorize` usage in `CreateItem`**

In `CreateItem` (around `list_service.go:223`), replace:

```go
	// Auto-categorize if not provided
	if it.Category == "" {
		it.Category = s.autoCategorize(description)
	}
```

with:

```go
	// Auto-categorize if not provided. Errors degrade to General rather than
	// failing item creation.
	if it.Category == "" {
		cat, _, err := s.categorizer.Categorize(ctx, description)
		if err != nil || cat == "" {
			cat = categorization.General
		}
		it.Category = cat
	}
```

- [ ] **Step 3: Delete the old function and its test**

Delete the entire `autoCategorize` method (`list_service.go:357-613`) and remove the now-unused `"strings"` import **only if** nothing else in the file uses it (run `grep -n "strings\." backend/internal/services/list_service.go` first; keep the import if other usages remain).

Delete the migrated test file:

```bash
cd backend && git rm internal/services/categorization_test.go
```

- [ ] **Step 4: Update the constructor call in main.go**

In `backend/cmd/gracie-server/main.go`, temporarily pass a keyword-only categorizer so the build stays green (full wiring comes in Task 9). Change line 38:

```go
	listSvc := services.NewListService(usersRepo, roomsRepo, listsRepo, itemsRepo, categorization.NewKeywordCategorizer())
```

Add the import to main.go:

```go
	"github.com/janvillarosa/gracie-app/backend/internal/services/categorization"
```

- [ ] **Step 5: Verify the whole backend builds and tests pass**

Run: `cd backend && go build ./... && go test ./internal/services/...`
Expected: build succeeds; categorization package tests pass; no references to the deleted `autoCategorize` remain. If `go vet`/build reports other `NewListService` callers, update each to pass `categorization.NewKeywordCategorizer()`.

- [ ] **Step 6: Commit**

```bash
cd backend && git add -A
git commit -m "refactor(list): inject Categorizer into ListService, remove autoCategorize"
```

---

## Task 7: Config — embedding env vars

**Files:**
- Modify: `backend/internal/config/config.go`
- Modify: `backend/internal/config/config_test.go`

- [ ] **Step 1: Write the failing test**

Add to `backend/internal/config/config_test.go`:

```go
func TestEmbeddingDefaults(t *testing.T) {
	for _, k := range []string{"EMBEDDING_ENABLED", "EMBEDDING_MODEL_PATH", "EMBED_THRESHOLD", "EMBED_TOPK"} {
		os.Unsetenv(k)
	}
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.EmbeddingEnabled {
		t.Errorf("EmbeddingEnabled default = true, want false")
	}
	if cfg.EmbeddingModelPath != "/app/models/minilm" {
		t.Errorf("EmbeddingModelPath = %q", cfg.EmbeddingModelPath)
	}
	if cfg.EmbedThreshold != 0.45 {
		t.Errorf("EmbedThreshold = %v, want 0.45", cfg.EmbedThreshold)
	}
	if cfg.EmbedTopK != 5 {
		t.Errorf("EmbedTopK = %v, want 5", cfg.EmbedTopK)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && go test ./internal/config/ -run TestEmbeddingDefaults`
Expected: FAIL — fields undefined.

- [ ] **Step 3: Add fields and parsing**

In `backend/internal/config/config.go`, add fields to `Config`:

```go
	// Embedding categorization
	EmbeddingEnabled   bool
	EmbeddingModelPath string
	EmbedThreshold     float64
	EmbedTopK          int
```

In `Load()`, after the existing assignments and before the validation block, add:

```go
	cfg.EmbeddingEnabled = getEnv("EMBEDDING_ENABLED", "false") == "true"
	cfg.EmbeddingModelPath = getEnv("EMBEDDING_MODEL_PATH", "/app/models/minilm")
	cfg.EmbedThreshold = getEnvFloat("EMBED_THRESHOLD", 0.45)
	cfg.EmbedTopK = getEnvInt("EMBED_TOPK", 5)
```

Add the float helper at the bottom of the file:

```go
func getEnvFloat(key string, def float64) float64 {
	if v := os.Getenv(key); v != "" {
		var f float64
		if _, err := fmt.Sscanf(v, "%g", &f); err == nil && f > 0 {
			return f
		}
	}
	return def
}
```

- [ ] **Step 4: Run to verify passing**

Run: `cd backend && go test ./internal/config/ -run TestEmbeddingDefaults -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend && git add internal/config/config.go internal/config/config_test.go
git commit -m "feat(config): add embedding categorization env vars"
```

---

## Task 8: HugotEmbedder (real model adapter, pure-Go backend)

**Files:**
- Modify: `backend/go.mod` (add hugot)
- Create: `backend/internal/services/categorization/hugot_embedder.go`
- Create: `backend/internal/services/categorization/hugot_embedder_test.go`
- Create: `backend/cmd/fetch-model/main.go`

> **Library note:** hugot's feature-extraction config/result field names should be confirmed against godoc (`go doc github.com/knights-analytics/hugot`) at implementation time — the API is isolated to this one file, so the rest of the package is unaffected if names differ. Expected shape: `hugot.FeatureExtractionConfig{ModelPath, Name}`, `hugot.NewPipeline(session, config)`, `pipeline.RunPipeline(ctx, texts)` returning a result whose `.Embeddings` is `[][]float32`. Use `hugot.NewGoSession(ctx)` (pure Go, no native libs, no build tags).

- [ ] **Step 1: Add the dependency**

Run:
```bash
cd backend && go get github.com/knights-analytics/hugot@latest && go mod tidy
```
Expected: `go.mod`/`go.sum` updated. If the pure-Go backend requires a build tag or a specific minor version, note it here and pin it.

- [ ] **Step 2: Implement `HugotEmbedder`**

`backend/internal/services/categorization/hugot_embedder.go`:

```go
package categorization

import (
	"context"
	"fmt"

	"github.com/knights-analytics/hugot"
)

// HugotEmbedder runs a sentence-embedding ONNX model via hugot's pure-Go
// backend (no CGO, no native libraries). Construct once at startup and reuse;
// it is safe for sequential use from the service layer.
type HugotEmbedder struct {
	session  *hugot.Session
	pipeline *hugot.FeatureExtractionPipeline
}

// NewHugotEmbedder loads the model directory at modelPath (must contain the
// ONNX model + tokenizer files).
func NewHugotEmbedder(ctx context.Context, modelPath string) (*HugotEmbedder, error) {
	session, err := hugot.NewGoSession(ctx)
	if err != nil {
		return nil, fmt.Errorf("hugot session: %w", err)
	}
	config := hugot.FeatureExtractionConfig{
		ModelPath: modelPath,
		Name:      "grocery-embed",
	}
	pipeline, err := hugot.NewPipeline(session, config)
	if err != nil {
		_ = session.Destroy()
		return nil, fmt.Errorf("hugot pipeline: %w", err)
	}
	return &HugotEmbedder{session: session, pipeline: pipeline}, nil
}

// Embed returns one vector per input text.
func (h *HugotEmbedder) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	out, err := h.pipeline.RunPipeline(ctx, texts)
	if err != nil {
		return nil, fmt.Errorf("hugot run: %w", err)
	}
	return out.Embeddings, nil // confirm field name via `go doc`; see library note
}

// Close releases the model/session.
func (h *HugotEmbedder) Close() error {
	if h.session != nil {
		return h.session.Destroy()
	}
	return nil
}
```

If `hugot.NewPipeline` returns the generic pipeline type rather than `*hugot.FeatureExtractionPipeline`, type-assert it (`pipeline.(*hugot.FeatureExtractionPipeline)`) or use the typed constructor shown by `go doc`. Keep the change confined to this file.

- [ ] **Step 3: Write the integration test (skips without a model)**

`backend/internal/services/categorization/hugot_embedder_test.go`:

```go
package categorization

import (
	"context"
	"os"
	"testing"
)

// modelDir returns the model path from TEST_MODEL_PATH, skipping if unset so
// unit runs don't require a downloaded model.
func modelDir(t *testing.T) string {
	t.Helper()
	p := os.Getenv("TEST_MODEL_PATH")
	if p == "" {
		t.Skip("TEST_MODEL_PATH not set; skipping model integration test")
	}
	return p
}

func TestHugotEmbedderRealModel(t *testing.T) {
	ctx := context.Background()
	emb, err := NewHugotEmbedder(ctx, modelDir(t))
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	defer emb.Close()

	vecs, err := emb.Embed(ctx, []string{"milk", "whole milk", "screwdriver"})
	if err != nil {
		t.Fatalf("embed: %v", err)
	}
	if len(vecs) != 3 || len(vecs[0]) == 0 {
		t.Fatalf("unexpected embedding shape: %d vectors", len(vecs))
	}
	// "milk" and "whole milk" should be closer than "milk" and "screwdriver".
	near := cosine(normalize(vecs[0]), normalize(vecs[1]))
	far := cosine(normalize(vecs[0]), normalize(vecs[2]))
	if near <= far {
		t.Errorf("expected milk~whole milk (%.3f) > milk~screwdriver (%.3f)", near, far)
	}
}

func TestEmbeddingCategorizerRealModel(t *testing.T) {
	ctx := context.Background()
	emb, err := NewHugotEmbedder(ctx, modelDir(t))
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	defer emb.Close()

	ec, err := NewEmbeddingCategorizerWithEmbedder(ctx, emb, DefaultRules, 0.45, 5)
	if err != nil {
		t.Fatalf("build categorizer: %v", err)
	}
	// A novel item absent from DefaultRules should land in a sensible category.
	cat, conf, err := ec.Categorize(ctx, "ribeye steak")
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("ribeye steak -> %s (%.3f)", cat, conf)
	if cat != "Meat & Seafood" {
		t.Errorf("got %q, want Meat & Seafood", cat)
	}
}
```

- [ ] **Step 4: Create the build-time model fetcher**

`backend/cmd/fetch-model/main.go`:

```go
// Command fetch-model downloads the sentence-embedding model into a target
// directory at build time, so the running image needs no network access.
//
// Usage: fetch-model <output-dir>
package main

import (
	"context"
	"log"
	"os"

	"github.com/knights-analytics/hugot"
)

func main() {
	out := "./models"
	if len(os.Args) > 1 {
		out = os.Args[1]
	}
	modelID := os.Getenv("EMBEDDING_MODEL_ID")
	if modelID == "" {
		modelID = "KnightsAnalytics/all-MiniLM-L6-v2"
	}
	path, err := hugot.DownloadModel(modelID, out, hugot.NewDownloadOptions())
	if err != nil {
		log.Fatalf("download model %s: %v", modelID, err)
	}
	log.Printf("model downloaded to %s", path)
}
```

> **Model choice:** `KnightsAnalytics/all-MiniLM-L6-v2` ships hugot-compatible ONNX + tokenizer files (384-dim). If the integration test shows weak results on non-English items, swap `EMBEDDING_MODEL_ID` to a multilingual MiniLM ONNX build — no code change.

- [ ] **Step 5: Download the model and run the integration tests locally**

Run:
```bash
cd backend && go run ./cmd/fetch-model ./models
TEST_MODEL_PATH=$(ls -d ./models/*/ | head -1) go test ./internal/services/categorization/ -run 'RealModel' -v
```
Expected: both `*RealModel` tests PASS (or print the actual category for `ribeye steak` if the assertion needs tuning — adjust the expectation to the observed-correct category and note it). Confirm the model subdirectory name and set it as `EMBEDDING_MODEL_PATH` later.

- [ ] **Step 6: Run the full package test suite (model-independent tests still pass)**

Run: `cd backend && go test ./internal/services/categorization/`
Expected: PASS (integration tests skip when `TEST_MODEL_PATH` is unset).

- [ ] **Step 7: Commit (exclude the downloaded model)**

Add `backend/models/` to `backend/.gitignore` first, then:
```bash
cd backend && printf "\n/models/\n" >> .gitignore
git add internal/services/categorization/hugot_embedder.go internal/services/categorization/hugot_embedder_test.go cmd/fetch-model/main.go go.mod go.sum .gitignore
git commit -m "feat(categorization): add HugotEmbedder and build-time model fetcher"
```

---

## Task 9: Construct and inject the real categorizer in main.go

**Files:**
- Modify: `backend/cmd/gracie-server/main.go`

- [ ] **Step 1: Build the categorizer from config with startup fallback**

In `backend/cmd/gracie-server/main.go`, replace the temporary line from Task 6:

```go
	listSvc := services.NewListService(usersRepo, roomsRepo, listsRepo, itemsRepo, categorization.NewKeywordCategorizer())
```

with:

```go
	categorizer := buildCategorizer(ctx, cfg)
	listSvc := services.NewListService(usersRepo, roomsRepo, listsRepo, itemsRepo, categorizer)
```

Add this helper function at the bottom of `main.go`:

```go
// buildCategorizer returns the keyword categorizer by default, or an
// embedding+keyword Chain when EMBEDDING_ENABLED=true and the model loads.
// A model load failure logs and degrades to keyword-only so the app still boots.
func buildCategorizer(ctx context.Context, cfg *config.Config) categorization.Categorizer {
	keyword := categorization.NewKeywordCategorizer()
	if !cfg.EmbeddingEnabled {
		log.Printf("categorization: keyword mode (embedding disabled)")
		return keyword
	}
	emb, err := categorization.NewHugotEmbedder(ctx, cfg.EmbeddingModelPath)
	if err != nil {
		log.Printf("categorization: embedding init failed (%v); using keyword fallback", err)
		return keyword
	}
	ec, err := categorization.NewEmbeddingCategorizerWithEmbedder(ctx, emb, categorization.DefaultRules, cfg.EmbedThreshold, cfg.EmbedTopK)
	if err != nil {
		log.Printf("categorization: anchor embedding failed (%v); using keyword fallback", err)
		_ = emb.Close()
		return keyword
	}
	log.Printf("categorization: embedding mode (model=%s, threshold=%.2f, topK=%d)", cfg.EmbeddingModelPath, cfg.EmbedThreshold, cfg.EmbedTopK)
	return categorization.NewChain(ec, keyword)
}
```

Ensure `config` is imported in main.go (it already is) and that `categorization` import added in Task 6 remains.

- [ ] **Step 2: Verify build**

Run: `cd backend && go build ./...`
Expected: builds clean.

- [ ] **Step 3: Smoke-test both modes locally**

Run (keyword mode, no model needed):
```bash
cd backend && EMBEDDING_ENABLED=false go run ./cmd/gracie-server &
sleep 2 && kill %1
```
Expected log line: `categorization: keyword mode (embedding disabled)`.

Run (embedding mode against the downloaded model):
```bash
cd backend && EMBEDDING_ENABLED=true EMBEDDING_MODEL_PATH=$(ls -d ./models/*/ | head -1) go run ./cmd/gracie-server &
sleep 6 && kill %1
```
Expected log line: `categorization: embedding mode (...)` with no fallback warning.

- [ ] **Step 4: Commit**

```bash
cd backend && git add cmd/gracie-server/main.go
git commit -m "feat(categorization): wire embedding categorizer with keyword fallback"
```

---

## Task 10: Accuracy benchmark — no regression vs keyword baseline

**Files:**
- Create: `backend/internal/services/categorization/benchmark_test.go`

- [ ] **Step 1: Write the benchmark test**

This test loads the real model (skips without `TEST_MODEL_PATH`) and asserts the Chain is at least as accurate as keyword-only on the 97-case suite — a sound, non-flaky property since keyword is the Chain's fallback. It also prints the embedding-only accuracy for visibility.

`backend/internal/services/categorization/benchmark_test.go`:

```go
package categorization

import (
	"context"
	"testing"
)

// benchCases mirrors the migrated keyword suite. Reuse the same table by
// copying the {desc, want} pairs from keyword_test.go.
var benchCases = []struct {
	desc string
	want string
}{
	{"Butternut Squash", "Produce"},
	{"Milk", "Eggs & Dairy"},
	// ... paste the full 97-case table here ...
}

func accuracy(t *testing.T, c Categorizer) float64 {
	t.Helper()
	ctx := context.Background()
	hits := 0
	for _, tc := range benchCases {
		cat, _, err := c.Categorize(ctx, tc.desc)
		if err != nil {
			t.Fatalf("%q: %v", tc.desc, err)
		}
		if cat == "" {
			cat = General
		}
		if cat == tc.want {
			hits++
		}
	}
	return float64(hits) / float64(len(benchCases))
}

func TestChainAccuracyNoRegression(t *testing.T) {
	ctx := context.Background()
	emb, err := NewHugotEmbedder(ctx, modelDir(t)) // skips when TEST_MODEL_PATH unset
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	defer emb.Close()
	ec, err := NewEmbeddingCategorizerWithEmbedder(ctx, emb, DefaultRules, 0.45, 5)
	if err != nil {
		t.Fatal(err)
	}

	keyword := NewKeywordCategorizer()
	chain := NewChain(ec, keyword)

	baseline := accuracy(t, keyword)
	embOnly := accuracy(t, ec)
	chainAcc := accuracy(t, chain)
	t.Logf("accuracy — keyword: %.1f%%, embedding-only: %.1f%%, chain: %.1f%%",
		baseline*100, embOnly*100, chainAcc*100)

	if chainAcc < baseline {
		t.Errorf("chain accuracy %.3f regressed below keyword baseline %.3f", chainAcc, baseline)
	}
}
```

- [ ] **Step 2: Run the benchmark**

Run:
```bash
cd backend && TEST_MODEL_PATH=$(ls -d ./models/*/ | head -1) go test ./internal/services/categorization/ -run TestChainAccuracyNoRegression -v
```
Expected: PASS, with a log line reporting all three accuracy numbers. Use the embedding-only number to decide whether to tune `EMBED_THRESHOLD` (lower → more confident answers, fewer declines; higher → more declines to keyword/General).

- [ ] **Step 3: Run the full suite without a model (CI default)**

Run: `cd backend && go test ./...`
Expected: PASS; model-dependent tests skip.

- [ ] **Step 4: Commit**

```bash
cd backend && git add internal/services/categorization/benchmark_test.go
git commit -m "test(categorization): accuracy benchmark with no-regression guarantee"
```

---

## Task 11: Docker — bake the model into the image

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `backend/Dockerfile.railway`

> Pure-Go hugot needs no native libraries, so the existing `CGO_ENABLED=0` Alpine build is unchanged. The only additions are downloading the model in the builder and copying it into the final image. If `go run ./cmd/fetch-model` needs network egress that your build environment blocks, see the note in Task 13.

- [ ] **Step 1: Update `backend/Dockerfile.railway`**

In the builder stage, after `RUN go mod download` and the existing build commands, add a model-download step. In the final stage, copy the model and set the env var. Full updated file:

```dockerfile
# syntax=docker/dockerfile:1

FROM golang:1.22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git ca-certificates

# Cache deps
COPY go.mod go.sum ./
RUN go mod download

# Build binaries
COPY . ./
RUN mkdir -p /out && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/gracie-server ./cmd/gracie-server && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/setup-ddb ./cmd/setup-ddb

# Download the embedding model into the image (no runtime network needed)
RUN go run ./cmd/fetch-model /out/models

FROM alpine:3.20
RUN adduser -D -h /app app && apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /out/gracie-server /usr/local/bin/gracie-server
COPY --from=builder /out/setup-ddb /usr/local/bin/setup-ddb
COPY --from=builder /out/models /app/models
COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

- [ ] **Step 2: Mirror the change in `backend/Dockerfile`**

Apply the same two additions (the `RUN go run ./cmd/fetch-model /out/models` line in the builder, and `COPY --from=builder /out/models /app/models` in the final stage). This file builds from the repo root (`WORKDIR /app/backend`), so the fetch command is `RUN go run ./cmd/fetch-model /out/models` run from that workdir. Add `ca-certificates` to the builder's `apk add` line.

- [ ] **Step 3: Confirm the model path matches config**

The model lands in `/app/models/<model-subdir>/`. Set the runtime `EMBEDDING_MODEL_PATH` to the exact subdirectory (determine it from the Task 8 download, e.g. `/app/models/KnightsAnalytics_all-MiniLM-L6-v2`). If hugot's `DownloadModel` returns the final path, capture it in the fetch-model log (Task 8 already logs it) and use that value.

- [ ] **Step 4: Build the image locally to verify**

Run:
```bash
cd backend && docker build -f Dockerfile.railway -t gracie-embed-test .
docker run --rm gracie-embed-test ls -R /app/models | head -20
```
Expected: image builds; the model files (`*.onnx`, `tokenizer.json`, `config.json`) are present under `/app/models/`.

- [ ] **Step 5: Commit**

```bash
cd backend && git add Dockerfile Dockerfile.railway
git commit -m "build(docker): download and bake embedding model into image"
```

---

## Task 12: Railway deployment configuration

**Files:**
- Modify: `backend/README.md` (deployment notes)

This task is configuration + documentation; there is no code test. Apply the settings in the Railway dashboard for the backend service and record them in the README.

- [ ] **Step 1: Set Railway service variables**

In the Railway backend service → Variables, add:
- `EMBEDDING_ENABLED=false` (keep keyword mode until validated in production)
- `EMBEDDING_MODEL_PATH=/app/models/<model-subdir>` (the exact path from Task 11 Step 3)
- `EMBED_THRESHOLD=0.45`
- `EMBED_TOPK=5`

- [ ] **Step 2: Confirm builder and resources**

- Ensure the service builds from the **Dockerfile** (`Dockerfile.railway`), not nixpacks.
- Verify the plan provides **≥ 512 MB RAM** (1 GB recommended) — pure-Go ONNX inference plus the model raises the memory floor above the current tiny API. This is the key constraint to confirm before enabling embeddings.
- Set the healthcheck timeout to tolerate model load at boot (~2–5 s in embedding mode). If a healthcheck path exists, keep it; embedding init happens before the server starts listening, so readiness already implies the model is loaded (or has fallen back to keyword).

- [ ] **Step 3: Deploy with embeddings OFF, verify baseline**

Deploy. Confirm logs show `categorization: keyword mode (embedding disabled)` and item creation still categorizes exactly as before. This proves the refactor is behavior-neutral in production.

- [ ] **Step 4: Flip embeddings ON, validate**

Set `EMBEDDING_ENABLED=true`, redeploy. Confirm logs show `categorization: embedding mode (...)` with **no** fallback warning. Create a few novel items (e.g. "ribeye steak", "oat flat white", "dragonfruit") and confirm sensible categories. If memory pressure or latency is unacceptable, set `EMBEDDING_ENABLED=false` to instantly revert (no redeploy of code needed).

- [ ] **Step 5: Document in README and commit**

Add a "Categorization" section to `backend/README.md` documenting the four env vars, the keyword-fallback behavior, the RAM requirement, and the `EMBEDDING_ENABLED` kill-switch. Then:

```bash
cd backend && git add README.md
git commit -m "docs: document embedding categorization deployment on Railway"
```

---

## Task 13: Final verification and branch wrap-up

**Files:** none (verification only)

- [ ] **Step 1: Full test suite, model-independent**

Run: `cd backend && go test ./...`
Expected: all PASS; categorization model tests skip without `TEST_MODEL_PATH`.

- [ ] **Step 2: Full test suite with the model**

Run: `cd backend && TEST_MODEL_PATH=$(ls -d ./models/*/ | head -1) go test ./internal/services/categorization/ -v`
Expected: integration + benchmark tests PASS; review the printed accuracy line.

- [ ] **Step 3: Vet and build**

Run: `cd backend && go vet ./... && go build ./...`
Expected: clean.

- [ ] **Step 4: Confirm no stray references to the old function**

Run: `cd backend && grep -rn "autoCategorize" . || echo "clean"`
Expected: `clean`.

- [ ] **Step 5: Update the spec's deployment section (optional consistency)**

If desired, note in `docs/superpowers/specs/2026-06-28-embedding-categorization-design.md` that the implementation uses hugot's pure-Go backend (no CGO/native libs), superseding the ORT/CGO deployment details. Commit any doc change.

- [ ] **Step 6: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to choose merge/PR/cleanup for `feature/embedding-categorization`.

---

## Risk Notes & Build-Environment Caveats

- **Network during Docker build (Task 11):** `fetch-model` downloads from Hugging Face at build time. Railway's builder has egress, so this works there. If a build environment blocks egress, pre-download the model and `COPY` it from a committed/LFS path or an artifact store instead — change confined to the Dockerfile builder stage.
- **hugot pure-Go maturity:** if the Go backend underperforms or a pipeline feature is missing, switch `HugotEmbedder` to the ORT backend: `hugot.NewORTSession(ctx, hugot.WithOnnxLibraryPath(...))` under build tag `ORT`, and add `libonnxruntime.so` + `tokenizers.a` to a debian-slim runtime stage (the spec's original deployment shape). Only `hugot_embedder.go` and the Dockerfiles change; all categorizer logic and tests are unaffected because they target the `Embedder` interface.
- **Threshold tuning:** `EMBED_THRESHOLD` is the main accuracy dial. Use Task 10's printed embedding-only accuracy to tune. It's env-configurable, so tuning needs no redeploy of code.
- **Determinism:** CPU inference is deterministic for a fixed model, so the benchmark and integration tests are stable across runs.
