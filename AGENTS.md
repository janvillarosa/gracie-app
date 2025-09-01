# Gracie Backend – Agent Notes

This document captures how to develop, test, and extend the Gracie backend, plus key design decisions made during implementation so future agents can continue the work smoothly.

## Tech Stack
- Language: Go 1.22+ (backend), React 18 + Vite + TypeScript (frontend)
- HTTP Router: `go-chi/chi`
- Database: DynamoDB (use DynamoDB Local during development)
- AWS SDK: `aws-sdk-go-v2`
- Auth: API keys (Bearer token). Keys are bcrypt-hashed; a deterministic SHA‑256 lookup value is stored for efficient user lookup via GSI. Email/password login also available; passwords are bcrypt‑hashed and then encrypted-at-rest with AES‑256‑GCM using a local key file.

## Architecture
Layered packages under `backend/internal/`:
- `config`: Environment configuration with sensible local defaults.
- `auth`: API key generation/verification, bearer extraction, and lookup derivation.
- `models`: Data models (`User`, `Room`). No tests here per request.
- `store/dynamo`: DynamoDB client and repositories (`UserRepo`, `RoomRepo`). Uses conditional writes and transactions for invariants.
- `services`: Business logic orchestrating repositories and enforcing rules.
- `http/handlers`: Request/response handling for users and rooms.
- `http/middleware`: Auth middleware that injects the user into request context.
- `http/router`: Route wiring (separate package to avoid import cycles).
- `pkg/ids`: ID and token generation helpers.

Directory layout (partial)
```
backend/
  cmd/
    gracie-server/        # server main
    setup-ddb/            # local table creation helper
  internal/
    auth/
    config/
    errors/
    http/
      handlers/
      middleware/
      router/
    models/
    services/
    store/dynamo/
    testutil/
  pkg/ids/
```

## Data Model
User
- `user_id` (PK)
- `name`
- `username` (email, unique via GSI)
- `password_enc` (AES‑GCM of bcrypt hash)
- `api_key_hash` (bcrypt, optional)
- `api_key_lookup` (SHA‑256 hex for GSI, optional)
- `room_id` (nullable, omit if empty)
- `created_at`, `updated_at` (RFC3339)

Room
- `room_id` (PK)
- `member_ids` (list, max 2)
- `display_name` (optional; alphanumeric + spaces)
- `description` (optional)
- `share_token` (nullable; GSI)
- `deletion_votes` (map: `user_id` -> timestamp string)
- `created_at`, `updated_at`

Tables
- `Users`: PK `user_id`, GSIs: `api_key_lookup_index` on `api_key_lookup`, `username_index` on `username`.
- `Rooms`: PK `room_id`, GSI: `share_token_index` on `share_token`.

## Core Flows
- Signup (API‑key): Create user + API key (hash + lookup) and a solo room; set `room_id` on the user. Transactional.
- Register/Login (email/password): Register creates user with encrypted bcrypt; Login verifies and rotates API key, returning it to the client.
- Share: Rotate a 5‑char share code (URL‑safe, excluding I/O/L) for the current room.
- Join: Validate share code, ensure target room has exactly one member; add joiner as second member and set `room_id`. If joiner has a solo room, delete it in the same transaction.
- Two‑party deletion: Each member votes; when both votes exist, transactionally delete the room and clear `room_id` on both users. Prefer conditional Delete on the room over ConditionCheck to avoid multiple ops on one item in a transaction.

## Key Design Decisions
- API keys: Only returned once at signup or login. Hash stored via bcrypt; separate SHA‑256 hex `api_key_lookup` used for GSI lookup to avoid scans.
- Passwords: Bcrypt‑hashed and encrypted-at-rest with AES‑256‑GCM. Encryption key stored in a local file (`ENC_KEY_FILE`), persisted via a bind‑mount (`./.secrets/enc.key`) and never committed.
- DynamoDB Local: Requires region and creds even locally; defaults apply. Endpoint is configurable via `DDB_ENDPOINT`.
- Transactions: Used for signup, join, and finalize deletion to maintain invariants (1 room per user, <= 2 members per room, atomic cleanup on deletion).
- Router package split: `internal/http/router` separated from HTTP helpers to avoid import cycles.
- Error mapping: Minimal mapping to HTTP codes (401, 403, 404, 409).
- Sanitized responses: Do not expose internal IDs on room views; handlers return display data (display name, description, member display names, timestamps).

## Local Development
Start DynamoDB Local
```
docker run -d --name ddb-local -p 8000:8000 amazon/dynamodb-local
```

Environment (optional)
```
export DDB_ENDPOINT=http://localhost:8000
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=local
export AWS_SECRET_ACCESS_KEY=local
export USERS_TABLE=Users
export ROOMS_TABLE=Rooms
export PORT=8080
```

Create tables
```
cd backend
go run ./cmd/setup-ddb
```

Run server
```
cd backend
go run ./cmd/gracie-server
```

## Testing
Run all tests (integration tests auto‑skip if DynamoDB Local is unreachable):
```
cd backend
go test ./...
```

Unit‑only tests (no DynamoDB):
```
cd backend
go test ./internal/config ./internal/auth ./internal/http/...
```

How integration tests work
- `internal/testutil/ddbtest.go` creates ephemeral tables (e.g., `Users_test_<rand>`, `Rooms_test_<rand>`) and tears them down.
- Repository tests cover CRUD and conditional updates.
- Service tests cover end‑to‑end flows: signup → share → join → two‑party deletion.
- Handler tests use `httptest.Server` with real middleware/services/repos against test tables.

## Known Limitations / Future Work
- No OpenAPI/Swagger spec yet.
- Share tokens do not expire; consider adding TTL/expiry mechanics.
- No rate limiting or request tracing; logs are minimal via `chi` middleware.
- No pagination or complex queries (not needed in current scope).
- CORS/config hardening for production is not included.
- Secrets/config management for production (env/SSM/Secrets Manager) not wired.

## Tips & Pitfalls Learned
- DynamoDB Local still requires a region and credentials; defaults avoid friction.
- When adding GSIs to an existing table, include `AttributeDefinitions` for any new index key attributes in the same `UpdateTable` call; DynamoDB Local otherwise errors with “No Attribute Schema Defined”.
- DynamoDB rejects empty strings for key attributes and often for attributes in general. Use `dynamodbav:",omitempty"` on struct tags to avoid writing empty/null attributes (e.g., `room_id`, `share_token`, `description`).
- Using a conditional Delete inside a transaction is preferable to a separate ConditionCheck on the same item (avoids “multiple operations on one item”).
- Keep router separate from HTTP helpers to avoid import cycles with handlers during testing.
- For auth, avoid DB scans: store a deterministic lookup (SHA‑256) as a GSI key and still verify with bcrypt to prevent false positives.
- Frontend Vite aliasing must be configured (see `vite.config.ts`) to resolve `@api/*`, `@auth/*`, etc.
- pnpm in CI/Docker requires a semver in `packageManager` (e.g., `pnpm@9.0.0`) and disabling offline install if no lockfile is present.

## Extending the System
- Add actual Room content (lists/items) under a new package `internal/lists` or `internal/items`, with clear ownership by `room_id`.
- Consider adding S3 pre‑signed upload flows later if avatars are reinstated.
- Introduce OpenAPI for contract clarity and client generation.
- Add e2e tests and load testing scripts as scope grows.

## Frontend Notes (UI uses “House” terminology)
- The UI refers to rooms as “House” only (copy change). Backend endpoints remain `/rooms/*`.
- Pages:
  - Dashboard: Shows House (display name, description, members).
  - House Settings: Edit display name/description, rotate share code, vote/cancel deletion.
  - Join/Create: Join via 5‑char code only; create solo house.
- Share modal: Dismissible with persistent backdrop; “Get new code” regenerates a code.

## Docker Compose
- `docker compose up --build` starts DynamoDB Local, API, and frontend (Nginx) on ports 8000/8080/3000.
- The API entrypoint runs `setup-ddb` with retries; if you wipe `.dynamodb`, run `docker compose run --rm api /usr/local/bin/setup-ddb` before traffic.
- Persist the encryption key under `./.secrets/enc.key` (mounted at `/app/secrets/enc.key`).
