# Gracie Backend (Go + DynamoDB)

Minimal HTTP API for Users and shared Rooms.

## Quick Start (Local)

Environment:

```
export DDB_ENDPOINT=http://localhost:8000
export AWS_REGION=us-east-1 # optional, defaults
export AWS_ACCESS_KEY_ID=local
export AWS_SECRET_ACCESS_KEY=local
export USERS_TABLE=Users
export ROOMS_TABLE=Rooms
export PORT=8080
```

Create tables in DynamoDB Local:

```
aws dynamodb create-table \
  --table-name Users \
  --attribute-definitions AttributeName=user_id,AttributeType=S AttributeName=api_key_lookup,AttributeType=S \
  --key-schema AttributeName=user_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes 'IndexName=api_key_lookup_index,KeySchema=[{AttributeName=api_key_lookup,KeyType=HASH}],Projection={ProjectionType=ALL}' \
  --endpoint-url $DDB_ENDPOINT --region $AWS_REGION

aws dynamodb create-table \
  --table-name Rooms \
  --attribute-definitions AttributeName=room_id,AttributeType=S \
  --key-schema AttributeName=room_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --endpoint-url $DDB_ENDPOINT --region $AWS_REGION
```

Run server:

```
go run ./backend/cmd/gracie-server
```

## Auth

Uses API key issued at signup. Send header `Authorization: Bearer <api_key>` on all endpoints except `POST /users`.

## Endpoints

- POST `/users` (public): `{ name }` → creates user and a solo room. Returns `{ user, api_key }` (key shown once).
- GET `/me`: returns the authenticated user.
- PUT `/me`: update `{ name }`.
- GET `/rooms/me`: returns current room; `404` if none.
- POST `/rooms`: create solo room if none; `409` if already in one.
- POST `/rooms/share`: rotate share token, returns `{ room_id, token }`.
- POST `/rooms/{room_id}/join`: body `{ token }` → join as second member. If joiner has a solo room, it is deleted atomically. Errors: `403` (bad token), `409` (room full, or joiner already in 2-person room).
- POST `/rooms/deletion/vote`: record vote; when both members have voted, deletes room and clears both users’ `room_id`. Response `{ deleted: true|false }`.
- POST `/rooms/deletion/cancel`: cancels caller’s vote.

## Notes

- After deletion, users are left without a room (must call `POST /rooms` to create a new solo room).
- API keys are stored as bcrypt hashes, and a deterministic SHA-256 lookup (`api_key_lookup`) is used via GSI to find the user.

