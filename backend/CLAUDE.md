# Backend — Agent Guide

Go 1.26 + `go-chi/chi` HTTP API over MongoDB. See the root [CLAUDE.md](../CLAUDE.md)
for the command surface and canonical facts, and
[internal/store/CLAUDE.md](internal/store/CLAUDE.md) for the persistence layer.

## Architecture

Layered packages under `internal/`:

- `config` — env configuration with local defaults (Mongo-only).
- `auth` — API-key generation/verification, bearer extraction, lookup derivation.
- `crypto` — AES-256-GCM at-rest encryption; key loaded from `ENC_KEY_FILE`.
- `models` — `User`, `Room`, `List`, `ListItem`, and the `Trip` aggregate (`TripTodo`,
  `Booking`, `Place`, `Op`, `OpResult`, `TripDelta`) with `bson` tags.
- `store` — repository interfaces; `store/mongo` is the only implementation.
- `services` — business logic orchestrating repositories and enforcing rules.
- `trips` — pure op engine: typed patches, validators, `ApplyOp`, `DeltaSince`. No I/O.
- `ratelimit` — in-process token-bucket limiter keyed per user.
- `tzlookup` — lazy offline coordinates -> IANA zone (tzf), used for Google places sent without a tz.
- `services/categorization` — grocery categorization (keyword + vector + in-process
  ONNX MiniLM embeddings, chained).
- `http/handlers`, `http/middleware` (auth → user in context), `http/router`
  (separate package to avoid import cycles).
- `pkg/ids` — ID/token/avatar-key generation.

`cmd/gracie-server` is the entrypoint (wired to Mongo). `cmd/fetch-model` bakes the
embedding model into the image at build time. `cmd/analytics-backfill` is a one-off
operator command (see [analytics.md](../docs/features/analytics.md), Backfill); both Dockerfiles ship it next to the
server. `cmd/suggest-eval` backtests and shadow-checks the suggestion forecast.

## Core flows

- **Signup (API key):** create user + API key (bcrypt hash + SHA-256 lookup) and a
  solo room; set `room_id`. Transactional.
- **Register/Login (email+password):** password is bcrypt-hashed then AES-encrypted
  at rest; login rotates and returns the API key.
- **Share:** `GET /rooms/share` returns the current 5-char code (URL-safe, excludes I/O/L), minting one only if none exists (atomic set-if-absent); `POST` rotates it. Joining clears it (single use).
- **Join:** validate share code, add joiner to the room, set their `room_id`; if the
  joiner had a solo room, delete it in the same transaction.
- **Deletion by consensus:** each member votes; when all current members have voted,
  transactionally delete and clear `room_id` on all members.

## Key design decisions

- API keys are returned only once (signup/login). A separate SHA-256 `api_key_lookup`
  enables indexed lookup without scanning; the key itself is bcrypt-hashed.
- Error mapping is minimal (401/403/404/409). Room views are sanitized — internal IDs
  are not exposed.
- Categorization failures degrade to `General` rather than failing item creation.
- **Fast startup:** the Railway service has a volume (it holds `enc.key`, which must never
  leave it), so deploys cannot overlap and startup time is downtime. The server listens
  before the embedding model loads (`categorization.Swappable` starts keyword-only and swaps
  in the embedding chain). Keep slow work off the path to `ListenAndServe`. `GET /healthz`
  is the deploy healthcheck.

- **Preferences:** `User.Preferences.TripsShowNextStop *bool` (nil = default true). `GET /me`
  always returns `preferences.trips_show_next_stop` as a concrete bool. `PUT /me` takes
  optional `name` and/or `preferences: {trips_show_next_stop?}` (4 KB body cap, unknown keys
  at any level -> 400, at least one field required). Mongo uses a nested
  `$set preferences.trips_show_next_stop`, so partial updates never clobber each other.

## Feature notes (read before changing a feature)

Full behavior lives in [docs/features/](../docs/features/README.md). The rules you must not break:

- **Trips** ([trips.md](../docs/features/trips.md)): never add a write path to `trips` that bypasses
  `ApplyOp` + `ReplaceCAS`; trip handlers use `tripStatus` (500 default), not `statusFromErr` (400
  default). Google places never store `name`/`address`; coordinates expire after 30 days.
- **Analytics** ([analytics.md](../docs/features/analytics.md)): emit **after** the domain write
  succeeded, only on a real state change; the recorder never slows or fails a user write. No raw item
  text, notes, places or IPs in events. A rename is an `Alias`, never an edit of stored events.
- **Suggestions** ([suggestions.md](../docs/features/suggestions.md)): no suggestion state that is not
  derivable from events and aggregates; bump `analytics.ForecastVersion` when forecast logic changes.

## Testing

The fast path is in-process and honest:

- **`go test ./...`** (via `make test-unit`) runs unit + service + full HTTP-flow
  tests over the in-memory fakes in `internal/testutil/memstore` — no DB, ~3s.
- **Mongo tests and the real-model embedding test carry `//go:build integration`.**
  They are excluded from the fast path and run only via
  **`make test-integration`** (`go test -tags=integration ./...`), which needs a
  Mongo replica set (and `TEST_MODEL_PATH` for the model test, else it skips).
- Write/extend tests for every change. A green `go test ./...` does **not** cover the
  Mongo layer — run `make test-integration` when you touch it.

## Lint & format

- `make lint` runs golangci-lint (v2 config in `.golangci.yml`:
  errcheck/govet/ineffassign/staticcheck/unused/misspell + gofmt; the opinionated
  `QF` quickfix suggestions are excluded).
- `make fmt` runs `gofmt`. The tree is tab-indented (gofmt standard) — keep it that way.
