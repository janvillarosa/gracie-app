# DB-backed Category Index + Backend Quantity Normalization — Design

**Date:** 2026-06-28
**Status:** Approved (design); pending implementation plan

## Problem

Every `ListService.CreateItem` with an empty category runs the categorizer chain.
Today the chain is: in-memory anchor exact-map → embedding ML model (local ONNX
MiniLM, hugot, cosine kNN) → keyword → "General". The embedding model inference
is the expensive step and runs for any description not covered by the in-memory
anchor map.

We want a persistent, database-level index so repeated descriptions skip the ML
model. We also want quantity/unit parsing to exist on the backend (it currently
lives only in the frontend `parseInput`) so categorization keys are clean and the
API can normalize legacy records.

## Decisions (from brainstorming)

- **Cache-hit definition:** exact match on a normalized description key.
- **Scope:** single global shared index (grocery categories are a fixed global
  taxonomy; a learned entry benefits all rooms).
- **Population:** write-through (confident embedding results only) **and** pre-seed
  the 452 existing `GroceryAnchors`.
- **Layering:** **remove the in-memory exact-match map.** The DB index is the only
  cache layer. Order: `NormalizeKey → DB lookup → embedding model → keyword → General`.
- **Normalization:** one shared Go normalizer reused by every read layer; strips
  quantity/unit, ported from the frontend `parseInput` (same allowlist). The
  embedding model also receives the normalized text.
- **Storage:** MongoDB only. Clean interface so DynamoDB can be added later.
- **Backwards compatibility:** read-time, non-destructive normalization of legacy
  records on the API response path. No data migration.

## Architecture

### Component 1 — Shared quantity parser (`backend/internal/parse`)

New standalone package (no import cycle with `categorization` or the list service).

- `ParseInput(input string) (description, quantity, unit string)` — Go port of the
  frontend `frontend/src/lib/parseInput.ts`. Same leading-quantity regex
  (`^([\d.]+)\s*([a-zA-Z]+)\s+(.+)$`) and the same `QUANTITY_UNITS` allowlist
  ported verbatim into a Go set. Strips only a **leading** quantity + recognized
  unit, identical semantics to the TS version (an unrecognized first word is kept
  as part of the description; a number with no recognized unit, e.g. "2 bell
  peppers", yields empty unit and description "bell peppers").
- `NormalizeKey(description string) string` — the canonical categorization key:
  lowercase → collapse internal whitespace + trim → strip leading quantity/unit via
  `ParseInput`. This single function produces the key used by every read layer.

Test cases are ported from `parseInput.test.ts`.

**Note on duplication:** the frontend `parseInput` stays as-is. The Go port is an
intentional second source of truth, kept in sync by shared test cases. Documented
as intentional.

### Component 2 — Mongo category index

New collection `category_index`:

```json
{ "key": "chicken breast", "category": "Meat & Seafood", "updated_at": "<ts>" }
```

- Unique index on `key`.
- Repo interface (Mongo-only implementation; interface allows future Dynamo):
  - `Lookup(ctx, key string) (category string, found bool, err error)`
  - `Upsert(ctx, key, category string) error`

### Component 3 — Caching decorator around the embedding categorizer

`CachingCategorizer` wraps **only the `EmbeddingCategorizer`** (not the whole
chain). The chain becomes `[CachingCategorizer(embedding) → keyword → General]`.
Because the wrapper sits on the embedding member only, keyword and General results
are never written to the index — satisfying "cache only confident embedding
results."

- **Read:** `key = NormalizeKey(desc)` → `repo.Lookup(key)`. Hit → return
  `(category, 1.0, nil)` and skip the model. Miss → call the inner embedding
  categorizer with the **normalized text**.
- **Write-through:** after the model returns, if
  `err == nil && cat != "" && cat != General && conf >= cacheThreshold` →
  `repo.Upsert(key, cat)`. Default `cacheThreshold` = the existing embedding
  threshold (0.45).
- **Graceful degradation (CAP):** a `Lookup` error is treated as a cache miss
  (log + fall through to the model); an `Upsert` error is logged and ignored. The
  cache can never break categorization.

The embedding categorizer's internal exact-match map is **removed**. The 452
anchors remain as the embedding kNN targets (`anchorVec`/`anchorCat`) and as
keyword-fallback anchors; they are also pre-seeded into the DB index (Component 5).

### Component 4 — Read-time backwards-compat normalization (non-destructive)

In the list **read** path, before serializing items to the API response: for each
item, **if `quantity == ""`**, run `ParseInput(description)`; if a leading
quantity/unit is found, set the response `description` = stripped value, and
populate response `quantity` / `unit` from the parse. If `quantity` is already
populated, leave the item untouched (no double-strip). **Database rows are never
modified** — purely response-shaping.

### Component 5 — Wiring & config

- On startup (or a one-shot idempotent seed), upsert the 452
  `NormalizeKey(anchor.Term) → anchor.Category` pairs into `category_index`.
- `buildCategorizers` (main.go) constructs the Mongo `CategoryIndexRepo` and wraps
  the embedding categorizer with `CachingCategorizer`.
- Optional `CATEGORY_INDEX_ENABLED` env (default `true`). When `false` or when the
  data store is not Mongo, the wrapper and seed are skipped and behavior matches
  today minus the removed in-memory map.

## Data flow (create item)

```
desc → NormalizeKey → DB category_index lookup   (hit → return, skip model)
                    → embedding model → write-through upsert
                    → keyword → General
```

## Testing

- **Go parser:** port the TS test table (`2 lbs chicken` → `chicken`,
  `2 bell peppers` → unit empty / desc "bell peppers", `bell peppers` → unchanged,
  etc.).
- **`CachingCategorizer`:** hit skips the model; miss + confident → upsert; General
  or decline → no upsert; repo `Lookup` error → falls through to the model;
  `Upsert` error → swallowed.
- **Read-time normalization:** legacy `"2 lbs chicken"` + empty-quantity row →
  returns split; already-split row untouched.
- **Repo:** lookup/upsert against Mongo (or a fake), unique-key behavior.
- **Seed:** anchors present in the index after seeding; idempotent on re-run.

## Trade-offs / explicitly deferred (YAGNI)

- No data migration (read-time normalization only).
- No DynamoDB implementation (interface-ready, not built).
- No semantic/vector caching; exact normalized-key match only.
- Index is last-writer-wins idempotent upsert; concurrent first-time creates of the
  same novel description are harmless.
