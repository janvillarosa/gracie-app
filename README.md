# Gracie (Backend)

Gracie is a minimal grocery/shopping list backend designed for couples to share a single Room. This repo currently contains the backend API implemented in Go and DynamoDB (Local), with a simple authentication model using API keys.

For now, Rooms are empty containers; the core flows implemented are user signup, room sharing via invite links (tokens), joining rooms, and two-party room deletion.

## Quick Start

Prereqs
- Go 1.22+
- Docker (for DynamoDB Local)

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

## API Overview

Auth
- API keys are created at signup and returned once.
- Send `Authorization: Bearer <api_key>` on all endpoints except `POST /users`.

Endpoints
- POST `/users` (public): Create a user with name; also creates a solo room. Returns `{ user, api_key }`.
- GET `/me`: Get current user.
- PUT `/me`: Update name.
- GET `/rooms/me`: Get current room (404 if none).
- POST `/rooms`: Create a solo room if user has none (409 if exists).
- POST `/rooms/share`: Rotate share token and return `{ room_id, token }`.
- POST `/rooms/{room_id}/join`: Body `{ token }` to join as second member.
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
Response: `{ "room_id": "...", "token": "..." }`.

3) Join (Bob)
```
# Bob signs up and receives <BOB_API_KEY>
curl -s -X POST http://localhost:8080/rooms/<room_id>/join \
  -H 'Authorization: Bearer <BOB_API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"token":"<token>"}'
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
- Share token rotation invalidates previous tokens.
- After room deletion, both users are left without a room (must create a new solo room to continue).
- DynamoDB Local requires dummy credentials and any region value; defaults are provided.

## Project Layout
- `backend/cmd/gracie-server`: HTTP server entrypoint
- `backend/cmd/setup-ddb`: Helper to create local DynamoDB tables
- `backend/internal/...`: Core packages (auth, config, http handlers/middleware/router, services, store/dynamo)
- `backend/pkg/ids`: ID and token generation helpers

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

