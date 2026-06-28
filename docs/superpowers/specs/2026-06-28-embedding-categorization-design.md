# Embedding-Based Grocery Categorization — Design

**Date:** 2026-06-28
**Status:** Approved (design); pending implementation plan
**Author:** Jan Villarosa (with Claude)

## Problem

Grocery items are categorized by `ListService.autoCategorize` in
`backend/internal/services/list_service.go` using ~250 hardcoded
`keyword → category` rules matched with case-insensitive `strings.Contains`.
Three pains motivate a change:

1. **Novel items → `General`.** Any item whose description doesn't contain a
   known substring falls through to `General`. New brands, dishes, and regional
   foods require a human to add a rule.
2. **Misclassifications.** Substring matching causes collisions (e.g. `ham` in
   `shampoo`), and the ordered-list workarounds are fragile.
3. **Maintenance burden.** Every fix means editing Go code and redeploying.

## Constraints & Decisions

These were settled during brainstorming and are fixed for this design:

- **No external LLM API.** Fully self-contained; no per-item network calls or
  third-party API costs.
- **Local embedding model**, run **in-process** inside the existing Go API
  container (CGO + ONNX Runtime), not as a separate sidecar service.
- **kNN against the existing list.** The current ~250 `keyword → category`
  entries are reused as labeled **anchor** examples rather than discarded.
- **Deployed via Docker on Railway.** Deployment is a first-class concern (see
  §6).
- **Out of scope:** a learn-from-user-corrections layer (chosen against in
  favor of embeddings). Noted as a future extension only.

## Categories (unchanged)

Produce, Pantry, Eggs & Dairy, Meat & Seafood, Grains & Bakery, Frozen,
Beverages, Plant-Based, Household, General (fallback).

## 1. Categorization Algorithm

Given a raw item description (quantity/unit already stripped upstream by the
frontend `parseInput`):

1. **Normalize** — lowercase, collapse whitespace, trim.
2. **Exact-anchor short-circuit** — if the normalized text exactly equals an
   anchor term, return that anchor's category with `confidence = 1.0`. No model
   inference. This keeps known items deterministic and eliminates the
   substring-collision bug class for them.
3. **Embed** the normalized text into a 384-dim vector.
4. **kNN** — cosine similarity against all anchor embeddings; take **top-k**
   (default `k = 5`).
5. **Similarity-weighted vote** — sum similarities per category across the
   top-k; the highest-scoring category wins.
6. **Threshold τ** — if the best top-1 similarity is below `τ`
   (default `0.45`), return `General`. Otherwise return the winning category.
7. Return `(category, confidence)` where `confidence` is the winning
   top-1 cosine similarity (or `1.0` from the short-circuit).

Determinism: CPU inference for a fixed model is deterministic, so identical
input yields identical output — tests are stable.

## 2. Components & Boundaries

A single interface decouples `ListService` from any concrete strategy
(dependency inversion):

```go
type Categorizer interface {
    Categorize(ctx context.Context, description string) (category string, confidence float64, err error)
}
```

Implementations:

- **`KeywordCategorizer`** — today's substring logic, preserved verbatim and
  kept as the permanent fallback.
- **`EmbeddingCategorizer`** — the model-backed strategy from §1. Owns the ONNX
  session, tokenizer, anchor matrix, threshold, and k.
- **`ChainCategorizer`** — composite that tries strategies in order:
  exact-match → embedding → keyword → `General`. This is also the
  **graceful-degradation** path: if the model fails to load or errors at
  runtime, the chain falls back to `KeywordCategorizer` so the app never breaks.

`ListService` receives a `Categorizer` via its constructor (currently it calls
`s.autoCategorize` directly). `autoCategorize` becomes the body of
`KeywordCategorizer`.

Each unit is independently testable: the chain with fakes, the keyword matcher
with strings, the embedding matcher with a loaded model, and the kNN/cosine
math with synthetic vectors.

## 3. Data: Anchors as Config, Not Code

- Extract the ~250 entries into `backend/internal/services/categorization/anchors.json`
  — a list of `{ "term": "...", "category": "..." }`.
- Loaded at startup; embeddings for all anchors computed once (~250 vectors,
  sub-second) and held in memory as a `[N][384]float32` matrix plus parallel
  category slice.
- Extending coverage = adding entries to JSON (data), not editing Go (code).
- Anchors are embedded as plain category-bearing example terms; the file is the
  single source of truth for both the exact-match short-circuit and the kNN
  anchor matrix.

(Optional optimization, deferred: precompute anchor embeddings at build time
into a binary file to shave startup time. Not needed initially — startup
compute is fast.)

## 4. Model & Libraries

- **Model:** `all-MiniLM-L6-v2`, 384-dim, int8-quantized ONNX (~23 MB).
  English-centric — adequate because most anchors and items are English, and
  Filipino/British terms already present as anchors resolve via the
  exact-match short-circuit or near-identical embeddings. **Config swap:** set
  the model path to `paraphrase-multilingual-MiniLM-L12-v2` (~118 MB, same
  384-dim) if novel non-English item accuracy becomes a problem.
- **Inference + tokenization:** `hugot`
  (`github.com/knights-analytics/hugot`), which wraps ONNX Runtime and provides
  feature-extraction pipelines (WordPiece tokenization, mean pooling, L2
  normalization) — minimizing hand-written tokenizer/pooling code. Raw
  `onnxruntime_go` is the documented fallback if `hugot` proves unsuitable.
- **Pooling/normalization:** mean pooling over token embeddings with attention
  mask, then L2-normalize (so cosine = dot product). Handled by the hugot
  pipeline.

## 5. Configuration (12-Factor)

All via environment variables; model files baked into the image as a
disposable build artifact:

| Var | Default | Purpose |
|-----|---------|---------|
| `EMBEDDING_ENABLED` | `false` | Feature flag. When false, chain skips the embedding strategy (keyword only). Default off until validated in production. |
| `MODEL_PATH` | `/app/models/model.onnx` | ONNX model file. |
| `TOKENIZER_PATH` | `/app/models/tokenizer.json` | HF tokenizer config. |
| `ANCHORS_PATH` | `/app/categorization/anchors.json` | Anchor data file. |
| `EMBED_THRESHOLD` | `0.45` | τ below which result is `General`. |
| `EMBED_TOPK` | `5` | k for kNN vote. |

The model loads **eagerly at boot** (singleton). The readiness/health check
passes only after the model is loaded (or after the chain has confirmed
keyword-only fallback when `EMBEDDING_ENABLED=false`).

## 6. Deployment (Docker + Railway)

**Multi-stage Dockerfile:**

- *Build stage:* `golang` base, `CGO_ENABLED=1`, ONNX Runtime dev headers/libs
  and build toolchain installed; build the API binary. Fetch the model and
  tokenizer files (pinned versions/checksums).
- *Runtime stage:* `debian-slim` (**not** distroless-static — CGO + the shared
  library require glibc). Copy: the binary, `libonnxruntime.so`, `model.onnx`,
  `tokenizer.json`, and `anchors.json`. Set `LD_LIBRARY_PATH` to where the
  shared library lives.

**Platform:** build for **linux/amd64** to match Railway. Build inside Docker
(don't cross-compile a CGO binary from the Mac arm64 host).

**Resource impact (key Railway constraints):**

- **Image size:** ~150–250 MB (slim base + ORT shared lib + quantized model).
- **RAM:** floor rises to ~512 MB–1 GB (ORT session + model). The current API
  is tiny; **verify the Railway plan has adequate memory before enabling.**
- **Cold start:** model load adds ~1–3 s at boot; configure the Railway
  healthcheck timeout to tolerate it.
- **No persistent volume** needed — model ships in the image.

**Railway specifics:** ensure the service uses the **Dockerfile builder** (not
nixpacks). Set healthcheck path/timeout to allow startup model load. Set
`EMBEDDING_ENABLED`, `EMBED_THRESHOLD`, `EMBED_TOPK` as service variables.

**Rollout / graceful degradation:**

- Ship with `EMBEDDING_ENABLED=false`; validate accuracy, latency, and memory,
  then flip to `true`.
- If the model fails to load at boot, log the error and serve with the keyword
  fallback (the chain handles this) — no hard failure.
- Optional, deferred: a one-off command to re-categorize existing `General`
  items once the model is validated.

## 7. Testing

- **Accuracy benchmark:** reuse the 97 existing cases in
  `categorization_test.go` as a regression suite; assert that ≥ a target
  fraction (e.g. 95%) of items land in their expected category with the
  embedding path enabled. Deterministic given the pinned model.
- **kNN/cosine unit tests:** synthetic vectors, no model — fast and pure.
- **Chain/fallback tests:** fakes for each `Categorizer` to verify ordering and
  graceful degradation when the embedding strategy errors.
- **Model integration test:** loads the real model; gated behind a build tag
  and skipped in `-short` mode (model load is slow for unit runs).

## 8. Future Extensions (not in this scope)

- Learn-from-corrections: persist user category edits as new anchors so the
  system improves without code changes.
- Build-time precomputation of anchor embeddings.
- Multilingual model as default if non-English coverage demands it.
