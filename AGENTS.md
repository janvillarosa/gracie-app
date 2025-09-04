# Gracie Backend – Agent Notes

This document captures how to develop, test, and extend the Gracie backend, plus key design decisions made during implementation so future agents can continue the work smoothly.

## Branding / Rebrand Note
- External brand: Bauhouse. All user‑facing copy (UI text, page titles, marketing) should use “Bauhouse”.
- Internal system name: Gracie. Keep internal identifiers as-is (package/module names, service names, repository paths, database name `gracie`, environment variables, Docker compose service names, etc.). Do not rename internal code or infrastructure solely for branding.
- Deployment routing: Existing domains or rewrites that point to `gracie-*` backends are acceptable until infra changes; only update targets when backend domains actually change.
- Frontend storage: If keys or identifiers previously used the "gracie" prefix, add non‑breaking migrations when changing them (e.g., migrate `gracie_api_key` → `bauhouse_api_key`).

## Tech Stack
- Language: Go 1.22+ (backend), React 18 + Vite + TypeScript (frontend)
- HTTP Router: `go-chi/chi`
- Database: MongoDB (single-node replica set for local; managed replica set in prod)
- Mongo Driver: `go.mongodb.org/mongo-driver`
- Auth: API keys (Bearer token). Keys are bcrypt-hashed; a deterministic SHA‑256 lookup value is stored for efficient user lookup via a UNIQUE PARTIAL index. Email/password login also available; passwords are bcrypt‑hashed and then encrypted-at-rest with AES‑256‑GCM using a local key file.

## Architecture
Layered packages under `backend/internal/`:
- `config`: Environment configuration with sensible local defaults.
- `auth`: API key generation/verification, bearer extraction, and lookup derivation.
- `models`: Data models (`User`, `Room`, `List`, `ListItem`) with `bson` tags.
- `store/mongo`: Mongo client, transaction helper, and repositories (Users/Rooms/Lists/Items). Uses sessions/transactions when available.
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
    store/mongo/
    testutil/
  pkg/ids/
```

## Data Model (Mongo Collections)
User (`users`)
- `user_id` (unique)
- `name`
- `username` (unique)
- `password_enc` (AES‑GCM of bcrypt hash)
- `api_key_hash` (bcrypt, optional)
- `api_key_lookup` (SHA‑256 hex, optional) — unique PARTIAL index where type is string
- `room_id` (nullable)
- `created_at`, `updated_at` (time.Time)

Room (`rooms`)
- `room_id` (unique)
- `member_ids` (array)
- `display_name` (optional; alphanumeric + spaces)
- `description` (optional)
- `share_token` (indexed)
- `deletion_votes` (map: `user_id` -> timestamp string)
- `created_at`, `updated_at`

List (`lists`)
- `list_id` (unique), `room_id` (indexed), `name`, `description?`, `icon?` (enum: HOUSE|CAR|PLANE|PENCIL|APPLE|BROCCOLI|TV|SUNFLOWER), `deletion_votes`, `is_deleted`, timestamps

ListItems (`list_items`)
- `item_id` (unique), `list_id` (indexed), `room_id`, `description`, `completed`, timestamps

## Core Flows
- Signup (API‑key): Create user + API key (hash + lookup) and a solo room; set `room_id` on the user. Transactional.
- Register/Login (email/password): Register creates user with encrypted bcrypt; Login verifies and rotates API key, returning it to the client.
- Share: Rotate a 5‑char share code (URL‑safe, excluding I/O/L) for the current room.
- Join: Validate share code and add the joiner to the room; set `room_id` for the joiner. If the joiner has a solo room, delete it in the same transaction. Users can belong to only one room at a time.
- Deletion by consensus: Each member votes; when all current members have voted, transactionally delete the room and clear `room_id` on all users. Prefer conditional Delete on the room over ConditionCheck to avoid multiple ops on one item in a transaction.

## Key Design Decisions
- API keys: Only returned once at signup or login. Hash stored via bcrypt; separate SHA‑256 hex `api_key_lookup` used for GSI lookup to avoid scans.
- Passwords: Bcrypt‑hashed and encrypted-at-rest with AES‑256‑GCM. Encryption key stored in a local file (`ENC_KEY_FILE`), persisted via a bind‑mount (`./.secrets/enc.key`) and never committed.
- Mongo transactions: Used for signup, join, and finalize deletion to maintain invariants (1 room per user, atomic cleanup on deletion). Requires a replica set (single-node RS locally).
- Tx fallback in dev: If transactions aren’t available (standalone), the Tx runner falls back to non-transactional execution to keep local dev unblocked.
- Router package split: `internal/http/router` separated from HTTP helpers to avoid import cycles.
- Error mapping: Minimal mapping to HTTP codes (401, 403, 404, 409).
- Sanitized responses: Do not expose internal IDs on room views; handlers return display data (display name, description, member display names, timestamps).

## Local Development
- `docker compose up --build` starts MongoDB (single-node replica set), API, and frontend (Nginx) on ports 27017/8080/3000.
- The compose file includes a one-shot init job that runs `rs.initiate` and blocks API start until PRIMARY is ready.
- Backend env used in compose:
  - `DATA_STORE=mongo`
  - `MONGODB_URI=mongodb://mongo:27017/?replicaSet=rs0&retryWrites=true&w=majority`
  - `MONGODB_DB=gracie`
  - `ENC_KEY_FILE=/app/secrets/enc.key` (bind-mounted)

## Testing
Run all tests (integration tests auto‑skip if Mongo is unreachable or transactions unsupported):
```
cd backend
go test ./...
```

Unit‑only tests (no DB):
```
cd backend
go test ./internal/config ./internal/auth ./internal/http/...
```

How integration tests work (to be updated for Mongo)
- Tests cover CRUD and the main business flows using the Mongo repositories.
- Where transactions are required, tests assume a replica set; otherwise they’re skipped.

## Known Limitations / Future Work
- No OpenAPI/Swagger spec yet.
- Share tokens do not expire; consider adding TTL/expiry mechanics.
- No rate limiting or request tracing; logs are minimal via `chi` middleware.
- No pagination or complex queries (not needed in current scope).
- CORS/config hardening for production is not included.
- Secrets/config management for production (env/SSM/Secrets Manager) not wired.

## Tips & Pitfalls Learned
- Mongo transactions require a replica set; for local dev we run a single-node RS and gate API startup on a successful `rs.initiate`.
- Use UNIQUE PARTIAL index for `api_key_lookup` to avoid duplicate-key errors on null/missing values during email/password registrations.
- Add `bson` tags to models to ensure field names in Mongo match expectations (e.g., `user_id`, not `userid`).
- Store timestamps as `time.Time` in Mongo to avoid decoding issues (not strings).
- The Tx runner falls back to non-transactional execution when sessions/transactions are unavailable (keeps dev unblocked).
- Vercel frontend proxies `/api/*` to Railway via `vercel.json` rewrite; do not set a relative `VITE_API_BASE_URL` in Vercel.
- For Railway, persist the AES key at `/data/enc.key` using a Volume; backend runs as root in the image to write the file safely.

## Extending the System
- Add actual Room content (lists/items) under a new package `internal/lists` or `internal/items`, with clear ownership by `room_id`.
- Consider adding S3 pre‑signed upload flows later if avatars are reinstated.
- Introduce OpenAPI for contract clarity and client generation.
- Add e2e tests and load testing scripts as scope grows.

## Frontend Notes (UI uses “House” terminology)
- The UI refers to rooms as “House” only (copy change). Backend endpoints remain `/rooms/*`.
- Branding: All visible UI should say “Bauhouse”; internal references can remain “Gracie”.
- Pages:
  - Dashboard: Shows House (display name, description, members).
  - House Settings: Edit display name/description, rotate share code, vote/cancel deletion.
  - Join/Create: Join via 5‑char code only; create solo house.
- Share modal: Dismissible with persistent backdrop; “Get new code” regenerates a code.

## Docker Compose
- `docker compose up --build` starts Mongo (RS), API, and frontend (Nginx) on ports 27017/8080/3000.
- A one-shot init job brings up the replica set (`rs0`) and the API waits until it completes.
- Persist the encryption key under `./.secrets/enc.key` (mounted at `/app/secrets/enc.key`).
