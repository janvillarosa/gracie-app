# Gracie Backend (Go + MongoDB)

Minimal HTTP API for Users and shared Rooms. MongoDB is the only datastore
(a single-node replica set locally, for transactions).

> How to develop and validate changes: see [CLAUDE.md](CLAUDE.md) and
> [internal/store/CLAUDE.md](internal/store/CLAUDE.md). All validation runs through
> the root `Makefile` (`make check`, `make test-integration`).

## Quick Start (Docker)

Starts Mongo (replica set), the API, and the frontend with one command:

```
docker compose up --build
```

- Mongo runs as a single-node replica set (`rs0`) on `27017`; a one-shot init job
  runs `rs.initiate` and the API waits for PRIMARY before starting.
- `api` builds the Go binary and serves on `8080`.
- `frontend` serves the React app via Nginx on `http://localhost:3000` and proxies
  `/api/*` to `api`, so no CORS is required.

Stop with `docker compose down`. Rebuild after code changes:

```
docker compose build api frontend && docker compose up api frontend
```

## Quick Start (local, without Docker)

Copy `../.env.example` to `../.env` (or export the vars). Transactions need a Mongo
replica set; the defaults expect one on `localhost:27017`:

```
export PORT=8080
export MONGODB_URI=mongodb://localhost:27017/?replicaSet=rs0
export MONGODB_DB=gracie
export ENC_KEY_FILE=./.secrets/enc.key
```

Run the server (from `backend/`):

```
go run ./cmd/gracie-server
```

## Auth

Uses an API key issued at signup. Send `Authorization: Bearer <api_key>` on all
endpoints except `POST /users` and the public `/auth/*` routes.

- POST `/auth/register` (public): `{ username(email), password, name? }` → 201.
- POST `/auth/login` (public): `{ username, password }` → `{ user, api_key }`. The
  API key is rotated on login.

## Endpoints

Users
- POST `/users` (public): `{ name }` → creates user and a solo room. Returns
  `{ user, api_key }` (key shown once).
- GET `/me`: returns the authenticated user.
- PUT `/me`: update `{ name }`.

Rooms
- GET `/rooms/me`: sanitized view `{ display_name, description, members, created_at,
  updated_at }` (no internal IDs); `404` if none.
- POST `/rooms`: create solo room if none; `409` if already in one.
- POST `/rooms/share`: rotate share token, returns `{ room_id, token }`.
- POST `/rooms/join`: `{ token }` → join by 5-char share code. If the joiner has a
  solo room, it is deleted atomically. Errors: `403` (bad token), `409` (already a member).
- PUT `/rooms/settings`: `{ display_name?, description? }`. Display name: alphanumeric
  + spaces, ≤ 64 chars. Description ≤ 512 chars; empty string removes it.
- POST `/rooms/deletion/vote`: record vote; when all current members have voted, the
  room is deleted and each member's `room_id` cleared. `{ deleted: true|false }`.
- POST `/rooms/deletion/cancel`: cancel caller's vote.

Share codes are 5-character, URL-safe, alphanumeric, excluding I/O/L
(`ids.NewShareToken5()`).

Lists (per Room)
- POST `/rooms/{room_id}/lists`: `{ name, description?, icon? }`. `icon` enum:
  HOUSE|CAR|PLANE|PENCIL|APPLE|BROCCOLI|TV|SUNFLOWER.
- GET `/rooms/{room_id}/lists`: all non-deleted lists for the room.
- PATCH `/rooms/{room_id}/lists/{list_id}`: `{ name?, description?, icon?, notes? }`.
  Send `icon: ""` to clear the icon, `notes: ""` to clear notes.
- POST `/rooms/{room_id}/lists/{list_id}/deletion/vote` and `/deletion/cancel`:
  consensus soft-delete of a list.

List Items
- POST `/rooms/{room_id}/lists/{list_id}/items`: `{ description }` → add item.
- GET `/rooms/{room_id}/lists/{list_id}/items?include_completed=false`: list items
  (hides completed by default).
- PATCH `.../items/{item_id}`: `{ description?, completed? }`.
- PATCH `.../items/{item_id}/position`: `{ prev_id?, next_id? }` → reorder relative to
  neighbors; the server computes a new order value.
- DELETE `.../items/{item_id}`: delete item (any member).

## MongoDB Collections / Indexes

- **users** — unique `user_id`, unique `username`, and a **unique PARTIAL** index on
  `api_key_lookup` (only where it is a string).
- **rooms** — unique `room_id`, indexed `share_token`.
- **lists** — unique `list_id`, indexed `room_id`.
- **list_items** — unique `item_id`, indexed `list_id`.

See [internal/store/CLAUDE.md](internal/store/CLAUDE.md) for the full data model and
transaction notes. Models use `omitempty` to avoid writing empty values.

## Categorization

Items added to lists are auto-assigned a category via a two-stage chain:

1. **Embedding (when enabled)** — a local `all-MiniLM-L6-v2` ONNX model embeds the
   description and finds nearest anchors by cosine similarity (kNN). Runs in-process,
   no external API; the model is baked into the Docker image at build time.
2. **Keyword fallback** — if the embedding declines (below threshold) or is disabled,
   the item is matched by substring against the anchor list.

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `EMBEDDING_ENABLED` | `false` | Enable the embedding layer. Off by default for safe rollout. |
| `EMBEDDING_MODEL_PATH` | `/app/models/minilm` | Path to the downloaded model dir inside the container. |
| `EMBED_THRESHOLD` | `0.45` | Cosine similarity floor; below this the embedding declines to keyword fallback. |
| `EMBED_TOPK` | `5` | Number of nearest anchors in the kNN vote. |

### Railway deployment

1. Build from `Dockerfile.railway` (not nixpacks).
2. Add the variables above to the service's **Variables** panel.
3. Provide **≥ 512 MB RAM** (1 GB recommended) — the ONNX model raises the floor.
4. Deploy with `EMBEDDING_ENABLED=false` first; confirm keyword categorization works.
5. Set `EMBEDDING_ENABLED=true` and redeploy; logs should show the model loaded.
6. To revert instantly: set `EMBEDDING_ENABLED=false` (no code redeploy needed).

## Notes

- After deletion, users are left without a room (call `POST /rooms` to create a new one).
- API keys are stored as bcrypt hashes; a deterministic SHA-256 lookup
  (`api_key_lookup`) with a unique partial index finds the user without scanning.
