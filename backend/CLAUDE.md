# Backend — Agent Guide

Go 1.26 + `go-chi/chi` HTTP API over MongoDB. See the root [CLAUDE.md](../CLAUDE.md)
for the command surface and canonical facts, and
[internal/store/CLAUDE.md](internal/store/CLAUDE.md) for the persistence layer.

## Architecture

Layered packages under `internal/`:

- `config` — env configuration with local defaults (Mongo-only).
- `auth` — API-key generation/verification, bearer extraction, lookup derivation.
- `crypto` — AES-256-GCM at-rest encryption; key loaded from `ENC_KEY_FILE`.
- `models` — `User`, `Room`, `List`, `ListItem` with `bson` tags.
- `store` — repository interfaces; `store/mongo` is the only implementation.
- `services` — business logic orchestrating repositories and enforcing rules.
- `services/categorization` — grocery categorization (keyword + vector + in-process
  ONNX MiniLM embeddings, chained).
- `http/handlers`, `http/middleware` (auth → user in context), `http/router`
  (separate package to avoid import cycles).
- `pkg/ids` — ID/token/avatar-key generation.

`cmd/gracie-server` is the entrypoint (wired to Mongo). `cmd/fetch-model` bakes the
embedding model into the image at build time.

## Core flows

- **Signup (API key):** create user + API key (bcrypt hash + SHA-256 lookup) and a
  solo room; set `room_id`. Transactional.
- **Register/Login (email+password):** password is bcrypt-hashed then AES-encrypted
  at rest; login rotates and returns the API key.
- **Share:** rotate a 5-char share code (URL-safe, excludes I/O/L).
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
