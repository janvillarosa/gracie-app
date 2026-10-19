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
- `trips.coords_expire_at` — earliest expiry of any stored Google coordinate; **partial
  index** (only trips that have it) serving the daily 30-day purge. The `place_cache`
  collection no longer exists (Photon was removed); drop it manually from old databases.

- **Analytics** (see [docs/features/analytics.md](../../../docs/features/analytics.md)): `events` (raw, unique `event_id`, TTL on
  `expire_at`, generic indexes by actor/target/room/container/key), `period_stats`
  (`<u|h>:<id>:<day|month|year>`, nested counts by `<subject>.<verb>`), `key_stats`
  (`<room>:<subject type>:<key>` with `intervals.due_at` indexed), `behavior_profiles`
  (`u:<user>` / `h:<room>`, replaced whole), `analytics_dirty` (subjects awaiting a profile
  recompute) and `analytics_state` (`_id: "rollup"`: lease + watermark). Field paths are nested
  (`counts.item.checked`), and path segments built from user text go through `pathSafe`
  (`.` and `$` become `_`). `ApplyBatch` writes aggregates, the dirty set and the watermark in one
  transaction; the watermark compares `ingested_at`, which Mongo keeps to the millisecond.

- **Autopilot** (see [docs/features/autopilot.md](../../../docs/features/autopilot.md)): `autopilot_actions`
  holds only applied (assist) actions: unique `action_id`; **unique `(room_id, kind, key, cycle)`** (one
  action per thing per forecast cycle, however many instances tick); sparse `item_id`; `(list_id, created_at)`;
  `(room_id, state)`; TTL `purge_at_ttl` (`purge_at` = resolution + 180 days). `Resolve` is a conditional
  update on the expected state. `autopilot_state` (`_id: "tick"`) is the ticker lease. `rooms.autopilot_mode`
  has a sparse index (`ListIDsByAutopilotMode`). A house's actions are deleted with it.

- **Push** (see [docs/features/notifications.md](../../../docs/features/notifications.md)): `push_subscriptions`
  (unique `endpoint`; keys encrypted at rest) and the `push_jobs` outbox: unique `job_id`, a **partial unique
  index on `coalesce_key` where `status` is pending** (one pending job per key; later adds merge into it),
  `(status, send_after)` for `Claim`, TTL `expire_at_ttl`. `Claim` is a `findOneAndUpdate` with a lease.
  `users.preferences.notify_*` are the per-kind switches (nil = on).

- `store.BackfillReader` (`store/mongo/backfill_reader.go`) is a read-only, batched walk over users,
  rooms, lists, items and trips for the analytics backfill. It uses **allow-list projections**, so
  credential fields and trip text (titles, notes, places) are never loaded; keep it that way when adding fields.

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
- Inside a transaction, guard writes with a filter on the expected state (e.g. a
  conditional `DeleteOne`/`UpdateOne` and check the matched count) rather than a separate
  read-then-write.

## Testing this layer

`mongo_integration_test.go` carries `//go:build integration` and is **excluded from
the fast `go test ./...`**. It runs only via **`make test-integration`**, which needs
a Mongo RS (`MONGODB_URI`); it self-skips if Mongo is unreachable (so a "pass" with no
Mongo running proves nothing; check the output for skips). Recipe in the root
[CLAUDE.md](../../../CLAUDE.md), "Integration tests". A bare
`go test ./...` covers none of this package — always run `make test-integration` when
you change repositories, indexes, or transaction logic.
