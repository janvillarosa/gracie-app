# Persistence Layer — Agent Guide

MongoDB is the only datastore. `store/` holds the repository interfaces; `store/mongo`
is the only implementation (uses `go.mongodb.org/mongo-driver`). See
[../../CLAUDE.md](../../CLAUDE.md) (backend) and the root guide for context.

## Collections & data model

- **`users`** — `user_id` (unique), `name`, `username` (unique), `password_enc`
  (AES-GCM of the bcrypt hash), `api_key_hash` (bcrypt, optional), `api_key_lookup`
  (SHA-256 hex, optional — **unique PARTIAL index**, only where the field is a
  string), `room_id` (nullable), `created_at`, `updated_at`.
- **`rooms`** — `room_id` (unique), `member_ids[]`, `display_name?`, `description?`,
  `share_token` (indexed), `deletion_votes` (map user_id→timestamp), timestamps.
- **`lists`** — `list_id` (unique), `room_id` (indexed), `name`, `description?`,
  `icon?` (enum HOUSE|CAR|PLANE|PENCIL|APPLE|BROCCOLI|TV|SUNFLOWER), `deletion_votes`,
  `is_deleted`, timestamps.
- **`list_items`** — `item_id` (unique), `list_id` (indexed), `room_id`, `description`,
  `completed`, `order`, timestamps.
- **`trips`** — one document per trip with embedded todos/bookings. Indexes: unique
  `trip_id`; `(room_id, deleted_at, trip_id, version, deleted_by)` so the sync manifest
  is served from the index; TTL `purge_at_ttl` (`purge_at`, expireAfterSeconds 0).
  Writes go only through `ReplaceCAS` / `Insert` / `LinkPackingList`.
- **`place_cache`** — geocoder results; unique `key`; 30-day TTL on `created_at`.

## Rules & pitfalls (learned the hard way)

- **Transactions require a replica set.** Signup, join, and finalize-deletion run in
  transactions to keep invariants (1 room per user; atomic cleanup). Locally we run a
  single-node RS; the compose stack gates API startup on a successful `rs.initiate`.
- **Dev fallback:** if sessions/transactions are unavailable (standalone Mongo), the
  Tx runner falls back to non-transactional execution so local dev isn't blocked.
- Use the **unique PARTIAL index** for `api_key_lookup` to avoid duplicate-key errors
  on null/missing values during email/password registration.
- Always add **`bson` tags** to model fields (e.g. `user_id`, not `userid`).
- Store timestamps as **`time.Time`**, not strings, to avoid decode issues.
- Prefer a conditional Delete over ConditionCheck inside a transaction (avoids
  multiple ops on one item).

## Testing this layer

`mongo_integration_test.go` carries `//go:build integration` and is **excluded from
the fast `go test ./...`**. It runs only via **`make test-integration`**, which needs
a Mongo RS (`MONGODB_URI`); it self-skips if Mongo is unreachable. A bare
`go test ./...` covers none of this package — always run `make test-integration` when
you change repositories, indexes, or transaction logic.
