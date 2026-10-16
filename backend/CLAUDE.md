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
embedding model into the image at build time. `cmd/analytics-backfill` is a one-off
operator command (see Behavior analytics > Backfill); both Dockerfiles ship it next to the server.

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

## Behavior analytics

Spec: `docs/superpowers/specs/2026-10-16-behavior-analytics-design.md`. It records what people
and houses do so Bauhouse can suggest, nudge and write a year review. Package
`internal/analytics` knows no feature: lists, trips and any future feature **register** their
own events.

- **Event envelope:** `subject` (what was acted on), optional `container` (what it lives in:
  item -> list, todo -> trip), `key` (stable identity across instances, the normalized text,
  never raw text), `targets` (other people the event is about: assignees), `props` (schema
  checked per event), and the actor's local time computed once at write time from
  `X-Timezone`. Names are `<subject type>.<verb>`.
- **Adding a feature:** register `analytics.EventDef`s (see `services/analytics_events.go`,
  `trips/analytics_events.go`), set `Role` (`RoleRequest` / `RoleComplete`) on the verbs that
  mean "asked for" and "done" and the generic projections give you per-period counts, per-key
  rhythm and due dates, per-container run rhythm and per-member totals for free. A rename is an
  `Alias`, never an edit of stored events.
- **Capture:** services embed `emitter` (`UseRecorder`) and emit **after** the domain write
  succeeded and only on a real state change. The recorder is buffered and non-blocking: a
  full buffer drops events (counted), it never slows or fails a user write. Trip events are
  derived per op in `trips.EventsFor` and emitted only once the compare-and-swap persists, so
  replays and retries never double-count. Client events come through `POST /events` (allow-listed
  names, `Client: true`); identity always comes from auth.
- **Rollups:** `analytics.Worker`. `FoldOnce` (every `ANALYTICS_FOLD_EVERY`) takes a lease,
  folds events with `ingested_at` in `[watermark, now-2m)` and applies the aggregates and the new
  watermark in **one transaction**, so a window is applied exactly once. `ProfilePass` (every
  `ANALYTICS_PROFILE_EVERY`) recomputes profiles for subjects the fold marked dirty. Both are safe
  to run on every instance. **Standalone Mongo has no transactions** (the Tx runner falls back to
  running without one), so exactly-once only holds on a replica set.
- **Reads:** `analytics.Reader` and `GET /me/insights`, `GET /rooms/{id}/insights`,
  `GET /rooms/{id}/insights/periods/{period}`. All point lookups; no endpoint returns raw events.
  The house review includes per-member totals; nudges and profiles stay personal. A nil profile
  means "nothing learned yet": callers fall back to non-personalized behavior.
- **Freshness:** aggregates lag by up to ~15 minutes (+ the 2 minute ingest lag). Consumers must
  filter suggestions against the live list they already hold (don't suggest what is on the list).
- **Privacy:** no raw item text, notes, places, confirmation codes or IPs. Deleting an account
  erases that person's events, personal stats and profile (`analytics.Purger`, with a second sweep
  for events still buffered); deleting a house erases its events and house-level aggregates.
  Joining a house dissolves the solo house's aggregates but keeps the person's own history.
  Raw events expire by TTL after `ANALYTICS_RETENTION_DAYS`.
- **Backfill:** `cmd/analytics-backfill` (spec `2026-10-16-analytics-backfill-design.md`) rebuilds
  events for records that predate analytics (sign-ups, houses, lists, items, trips, done todos)
  and lets the normal rollup fold them. Rules to keep:
  - **Dry run by default**; writes need `--apply`, and `--fold` drains the rollup instead of
    waiting for the next tick. Try one house first: `--room <id>`. The production entrypoint
    starts the server, so run it with `--entrypoint /usr/local/bin/analytics-backfill`.
  - Events have `source: "backfill"` and deterministic ids (`bf1:<name>:<subject id>`), so a
    re-run inserts nothing. Raw ones can be removed with `deleteMany({source: "backfill"})`, but the
    aggregates are `$inc` counters with no rebuild tool yet: that is why you trial one house first.
  - Only things **before the cutoff** (default: the earliest live server event) and inside
    retention (minus a day) are emitted. A record carrying `created_by` / `completed_at` was written by
    instrumented code, so its live event already exists and it is skipped.
  - Unrecorded actors: the house's only member, else `system:backfill` (house history, no one's
    profile). `item.checked` uses `updated_at` as the check time (a clear reads as one run).
  - Each source lives with its domain (`services/analytics_backfill.go`,
    `trips/analytics_backfill.go`) and a parity test compares its output with what the live code
    emits; change a live event's shape and that test tells you to change the backfill.
  - Ingest time is stamped per insert batch, not at start, so a long run cannot land behind the
    fold watermark.
- **Known limitations / follow-ups:** a user-facing opt-out; re-homing a solo house's key history
  when its owner joins another house (suggestions start fresh there); packing-list item events
  carry no trip link (the trip lead-time model uses `trip.packing_list_created` instead);
  `GetPantry` still scans history and can move to `key_stats`.

## Smart suggestions

Spec: `docs/superpowers/specs/2026-10-16-smart-suggestions-design.md`. A suggestion is a pure function of
the analytics aggregates and the live list; the only state is `Room.SuggestionsOff` and the events.

- **Forecast** (`analytics/predict/forecast.go`, pure): `Params.Predict` forecasts the next add and
  scores it by **backtesting** its own history (Wilson lower bound of hits/trials). The fold stores it as
  `KeyIntervals.Add`; `Reader.Upcoming` reads keys whose window is open now. Tune `DefaultParams` with
  `suggest-eval`, not by feel. Adds are preferred; checks are the fallback; no profile is required.
- **Service** (`services/suggestion_service.go`): `ForList` (home list, not already on the list, not ignored
  this cycle, raw events newer than the rollup win) and `Ignore` (emits `item.suggestion_ignored`, a
  `RoleDismiss` event that counts against the forecast). Routes: `GET .../lists/{id}/suggestions`,
  `POST .../suggestions/ignore {key}`.
- **Mode** `SUGGESTIONS_MODE=off|shadow|on` (default shadow). Shadow records `item.suggestion_predicted`
  (`Skip: true`, never rolled up; deterministic id per house, item and cycle) and returns nothing.
- **`cmd/suggest-eval`** `backtest | shadow | backfill [-apply]`, backed by `analytics/eval` (pure, shared
  with the tests). Go-live gate: shadow precision >= 70% over >= 50 settled predictions across >= 2 weeks.
- **House setting:** `PUT /rooms/settings {suggestions_off}`; `GET /rooms/me` returns it.
- Invariants: never add suggestion state that is not derivable from events and aggregates; an ignore must
  stay an event so the forecast sees it.

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
