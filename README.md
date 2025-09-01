# Gracie (Backend + Frontend)

Gracie is a minimal grocery/shopping list app designed for couples to share a single House (UI term) backed by a Room (backend model). The repo includes the backend API in Go + DynamoDB (Local) and a React/Vite frontend. Authentication supports API keys and email/password.

For now, Rooms are empty containers; the core flows implemented are user signup, room sharing via invite links (tokens), joining rooms, and two-party room deletion.

## Quick Start

Prereqs
- Go 1.22+
- Docker (for DynamoDB Local and Compose)
- Node 18+ (for local frontend)

1) Start DynamoDB Local

```
docker run -d --name ddb-local -p 8000:8000 amazon/dynamodb-local
```

2) Set environment (optional; sensible defaults are used)

```
export DDB_ENDPOINT=http://localhost:8000
export AWS_REGION=us-east-1      # SDK requires a region; arbitrary for local
export AWS_ACCESS_KEY_ID=local   # dummy creds for DynamoDB Local
export AWS_SECRET_ACCESS_KEY=local
export USERS_TABLE=Users
export ROOMS_TABLE=Rooms
export PORT=8080
```

3) Create tables

Use the included helper which creates `Users` with a GSI and `Rooms`:

```
cd backend
go run ./cmd/setup-ddb
```

4) Run the server

```
cd backend
go run ./cmd/gracie-server
```

Server listens on `:8080` by default.

### One command (Docker Compose)

Start DynamoDB Local, API, and frontend (Nginx) together:

```
docker compose up --build
```

URLs:
- Frontend: http://localhost:3000 (proxies `/api` to API, no CORS)
- API: http://localhost:8080
- DynamoDB Local: http://localhost:8000

If you wiped `.dynamodb`, ensure tables are created:

```
docker compose run --rm api /usr/local/bin/setup-ddb
```

## API Overview (highlights)

Auth
- API keys: returned once at signup or login. Send `Authorization: Bearer <api_key>` on all endpoints except `/users`, `/auth/*`.
- Email/Password: `/auth/register` and `/auth/login` supported; passwords are bcrypt‑hashed and encrypted-at-rest.

Endpoints
- POST `/users` (public): Create a user with name; also creates a solo room. Returns `{ user, api_key }`.
- POST `/auth/register` (public): `{ username(email), password, name? }` → 201.
- POST `/auth/login` (public): `{ username, password }` → `{ user, api_key }`.
- GET `/me`: Get current user.
- PUT `/me`: Update name.
- GET `/rooms/me`: Get current room view (sanitized; no internal IDs; includes display name, description, member names).
- POST `/rooms`: Create a solo room if user has none (409 if exists).
- POST `/rooms/share`: Rotate share token and return `{ token }`.
- POST `/rooms/join`: Body `{ token }` to join as second member using code only.
- PUT `/rooms/settings`: `{ display_name?, description? }` update.
- POST `/rooms/deletion/vote`: Record deletion vote; when both members vote, the room is deleted and both users’ `room_id` is cleared.
- POST `/rooms/deletion/cancel`: Remove caller’s vote.

Example flow (abbreviated)
1) Signup
```
curl -s -X POST http://localhost:8080/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Alice"}'
```
Response includes `api_key` and `user.room_id`.

2) Share
```
curl -s -X POST http://localhost:8080/rooms/share \
  -H 'Authorization: Bearer <ALICE_API_KEY>'
```
Response: `{ "token": "ABCDE" }`.

3) Join (Bob)
```
# Bob registers/logs in and receives <BOB_API_KEY>
curl -s -X POST http://localhost:8080/rooms/join \
  -H 'Authorization: Bearer <BOB_API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"token":"<ABCDE>"}'
```

4) Two‑party deletion
```
# Alice votes
curl -s -X POST http://localhost:8080/rooms/deletion/vote \
  -H 'Authorization: Bearer <ALICE_API_KEY>'
# Bob votes (this deletes the room)
curl -s -X POST http://localhost:8080/rooms/deletion/vote \
  -H 'Authorization: Bearer <BOB_API_KEY>'
```

## Important Notes
- API key is returned only once on signup; store it securely on the client.
- Only two users can be members of a room; joining a full room returns 409.
- Share token rotation invalidates previous tokens; share code is 5 chars (no I/O/L).
- After room deletion, both users are left without a room (must create a new solo room to continue).
- DynamoDB Local requires dummy credentials and any region value; defaults are provided.
- When updating local tables, `setup-ddb` ensures GSIs exist (`api_key_lookup_index`, `username_index`, `share_token_index`); if you wiped `.dynamodb`, rerun setup.

## Project Layout
- `backend/cmd/gracie-server`: HTTP server entrypoint
- `backend/cmd/setup-ddb`: Helper to create local DynamoDB tables
- `backend/internal/...`: Core packages (auth, config, http handlers/middleware/router, services, store/dynamo)
- `backend/pkg/ids`: ID and token generation helpers
- `frontend/`: React + Vite app (UI refers to “House”) served via Nginx in Docker

## Tests
- Unit and integration tests are under `backend/internal/...`.
- Integration tests require DynamoDB Local and auto-skip if not reachable.

Run all tests
```
cd backend
go test ./...
```

Unit-only (no DDB)
```
cd backend
go test ./internal/config ./internal/auth ./internal/http/...
```

## License
TBD for now (private/internal usage during development).
