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

- **Preferences:** `User.Preferences.TripsShowNextStop *bool` (nil = default true). `GET /me`
  always returns `preferences.trips_show_next_stop` as a concrete bool. `PUT /me` takes
  optional `name` and/or `preferences: {trips_show_next_stop?}` (4 KB body cap, unknown keys
  at any level -> 400, at least one field required). Mongo uses a nested
  `$set preferences.trips_show_next_stop`, so partial updates never clobber each other.

## Trips (offline-first sync)

Spec: `docs/superpowers/specs/2026-10-14-trips-api-persistence-design.md`.

- One aggregate document per trip (todos and bookings embedded).
- **All writes** go through `POST /rooms/{id}/trips/ops`: typed patches, per-device `seq`
  idempotency (`acked[client_id]`), per-field `at` clocks, tombstones, soft delete +
  restore. `ApplyOp` is pure; the service persists with a compare-and-swap `ReplaceCAS`.
- **Reads** go through `POST /rooms/{id}/trips/sync` with `known: {trip_id: version}`. It
  returns per-entity deltas, `removed`, and a `base_version` on each delta that the client
  must match; otherwise it resyncs.
- **Client rules for op results:** drop ops that come back `rejected`/`unsupported` and
  revert their optimistic state; keep `retry` ops in the outbox; treat `duplicate` as
  acked; surface `conflicted` with its `skipped_fields`.
- Invariants: never add a write path to `trips` that bypasses `ApplyOp` + `ReplaceCAS`;
  trip handlers use `tripStatus` (500 default), not `statusFromErr` (400 default).
- **Amendment 2026-10-15:** `TripTodo`/`Booking` carry server-set `created_by`/`updated_by`
  (never patch fields; a patch naming them is `unsupported`). `Place.locality` is user-typed
  content (the server never fills it). The trip has `stops` (ordered `[]Place`, cap 12, replaced
  whole via `trip.update`, clock `field_at["stops"]`) and `days` (date -> label <=40 chars,
  cap 60; `""` removes; clock `field_at["days.<date>"]`, so labelling different days never
  conflicts). Over-cap patches are rejected with code `cap`. `field_at` keys with dots are
  fine because trips are only ever written as whole documents (`ReplaceCAS`).
- **Attribution:** todos and bookings also carry server-set `updated_at` (UTC), stamped with
  `created_by`/`updated_by` on every applied change (create, update, and the booking-delete
  cascade); duplicate and fully-conflicted ops leave it alone. `GET /rooms/me` `members_meta`
  entries include `user_id` so clients can resolve `created_by`/`updated_by`/`done_by`.
- **Booking end_place:** `Booking.end_place` (optional, `null` clears; same Place validation
  and strict nested decoding) is the arrival / drop-off, `place` the departure / pick-up /
  only place. Own clock `field_at["end_place"]`. If a patch sets `end_place` with a tz and
  does not name `end_tz`, `end_tz` is derived from it (own clock); `start_tz` is never
  derived from `place`.
- **Trip icon:** `icon` (omitempty) on the trip fields, set via trip.create/update, clock
  `field_at["icon"]`; one of SUITCASE, PLANE, BEACH, MOUNTAIN, CITY, TRAIN, ROAD_TRIP,
  CAMPING, MAP, LANDMARK, WINE, SKI; `""` clears; anything else is `invalid`.
- **Todo -> booking link:** `TripTodo.booking_id` (optional, `null` clears) is set through
  todo.create/update. It must name a live booking of the same trip, else `invalid`; it has
  the normal clock `field_at["booking_id"]`. `booking.delete` clears the link on every todo
  that references it in the same write (todo `v` bumped, `updated_by` set), so those todos
  appear in the delta.
- **Batch semantics:** ops are grouped per trip and applied in `seq` order per `client_id`
  (array order across clients is kept). **Only one flusher may run per `client_id`**: seqs
  are a per-device total order, and a lower seq arriving after a higher one is `duplicate`.
  A storage error on one trip turns that trip's ops into `retry` and the rest of the batch
  proceeds; only a dead request context fails the whole call.
- **Bounded documents:** `acked` entries carry a last-seen time and are pruned after 30 days
  idle; at most 3 new `client_id`s per trip per batch and 200 per trip (else `cap`, seq not
  consumed). A `days` patch has at most 60 keys; `days.*` clocks are capped at 240 per trip
  and pruned for unlabelled dates after 30 days. Pruning an old `acked` entry means a replay
  older than 30 days could re-apply, the same horizon as tombstones.
- Packing-list link is stale (and relinked) only for not-found, soft-deleted, or a list in
  another room (e.g. left behind in a deleted solo room after a join); other lookup errors
  surface. Lists are not moved on join.
- **Places (Google Maps Platform, spec `2026-10-15-google-maps-migration.md`):** the server has
  no geocoder and no `/places/*` routes (they 404); search, autocomplete and maps run in the
  browser. `Place.source` is `google | pin | manual` (`photon` and `osm_ref` are gone; no migration).
  - `google`: `place_id` required (<= 256). `name` and `address` must be empty (Google content
    may not be stored; `invalid` otherwise). `lat`/`lng` come as a pair and only with
    `coords_fetched_at` no older than 30 days and not in the future (`invalid` otherwise);
    `tz` is always allowed; `locality` is allowed as user-typed content. A purged place is just
    `place_id` (+ `tz`, `locality`).
  - `pin` / `manual`: `name` and `lat`/`lng` required, `address`/`tz`/`locality` optional; no
    `place_id`, no `coords_fetched_at`.
  - A todo may have a blank title only when it has a Google place (the title is user content
    and stays blank by design); any other todo still needs a non-blank title.
  - **tz decision:** clients send `tz`. When a google place has coordinates but no tz, `ApplyOp`
    derives it from lat/lng with tzf (`Ctx.TZ`, wired by `TripService.UseTZ`). tzf therefore
    stays, but loads lazily on the first such place (~34 MB heap, ~150 ms), never at startup.
    Photon removal saved no tzf cost; it removed the proxy, `place_cache`, `PHOTON_BASE_URL`
    and the places rate limiters. `time/tzdata` stays for validating zone names.
  - **30-day purge:** `Trip.coords_expire_at` (server-only, partial index) is the earliest
    moment a stored Google coordinate turns 30 days old, recomputed on every write.
    `TripService.PurgeStaleCoords` reads only trips due by that index (soft-deleted ones
    included), nulls `lat`, `lng`, `coords_fetched_at` on stale places (keeps `place_id`, `tz`),
    sets `v` on touched todos/bookings (and the trip fields when destination/stops changed),
    bumps `version`, and writes with the usual CAS, so clients receive a normal delta.
    Touched todos/bookings get `updated_by = "system:coords-purge"` (not a user id: render it
    as "Bauhouse" or nothing) and a fresh `updated_at`. It is idempotent and runs at startup
    and every 24h plus up to 1h jitter (`RunCoordsPurge`); a lost CAS race is retried next run.
  - Rate limiter burst is `ratelimit.Burst(rps)` (>= 1). All trip endpoints, including
    packing-list, share the per-user trips limiter.

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
