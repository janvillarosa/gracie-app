# Trips — API & Persistence Design

Date: 2026-10-14 · Status: approved design, pending implementation plan · Scope: API + persistence only (UI spec follows)

## Goal

**Trips** let a Bauhouse house plan holidays and day trips: a trip has a where, a when and notes; checkbox todos each have a place, time, notes, category and an "open in maps" link; there is a map view and a map timeline. v1 extras: **bookings vault**, **unscheduled ideas**, and a **packing list** that links a normal List.

The defining requirement is that it is very fast and works with weak or no internet while travelling. The repo has no offline support today: no versioning, idempotency, tombstones or delta sync; writes are last-write-wins `$set` with server-generated IDs.

## Decisions

- **Offline-first.** The client keeps a full local copy, generates IDs, keeps an outbox of ops and syncs by delta.
- **Places** come from a backend proxy to an OSM geocoder (Photon API), cached in Mongo. Each todo stores a self-contained place snapshot.
- **House-scoped** like Lists: every member reads and writes.
- **Packing** links a normal List. It is online-only; that is accepted.
- **Trip delete** is a soft delete, restorable for 30 days by any member.
- **Booking fields are not encrypted** in v1. The data is already plaintext on every member's device, and a lost key would make every code unreadable without any error. Accepted risk.

## Core approach: trip aggregate + Go apply function + compare-and-swap

- One Mongo document per trip, with todos and bookings embedded.
- **Writes:** the server groups incoming ops by trip and loads the trip. A pure Go `ApplyOp(trip, op, now) OpResult` applies each op in memory. The trip is written back once with `ReplaceOne({trip_id, version: v})`. On a version mismatch it reloads and retries up to 3 times, then returns a per-op `retry` result.
- Why: each op gets its own result; validation and caps run against current state; one write per trip per batch; no transactions, so standalone Mongo works; memstore and Mongo share all apply logic and differ only in the compare-and-swap.
- **Reads:** delta sync with per-entity versions plus tombstones, so a partner's single tick sends one todo, not the whole trip.

## Data model (collection `trips`)

```
Trip {
  trip_id      "trip_<32hex>"  (client-generated; unique index)
  room_id
  title ≤120   destination *Place   notes ≤16KB
  start_date, end_date  *"YYYY-MM-DD"   (end ≥ start; equal for a day trip; both nil = draft)
  tz           IANA. Taken from destination on create, then only changed by an explicit edit
  stops    []Place  (cap 12; ordered route shown as "Lisbon → Porto"; display only)
  days     map["YYYY-MM-DD"]string  (day labels ≤40 chars; cap 60 entries)
  packing_list_id *string
  todos    []TripTodo   (cap 150)
  bookings []Booking    (cap 50)
  version  int64              +1 for each batch write that changed something
  v        int64              version when the trip's own fields last changed
  field_at map[field]int64    last-change clock per trip field
  acked    map[client_id]int64  highest op seq applied, per device (idempotency)
  tombstones []{id, v, at}    deleted todo/booking IDs (pruned after 30d)
  tomb_floor int64            versions below this have pruned tombstones; a client that far behind gets a full copy
  deleted_at, deleted_by  *   soft delete; purge_at set on delete, Mongo TTL index purges it 30d later
  created_by, created_at, updated_at
}

TripTodo { todo_id "ttd_<32hex>", title ≤200, done, done_by, done_at,
  day *"YYYY-MM-DD" (nil ⇒ Ideas), start_time *"HH:MM", duration_min *int,
  tz *IANA (worked out at write time: place.tz ?? trip.tz; stored, never derived on read),
  order float64, category enum{food,sight,activity,transport,stay,shopping,other},
  notes ≤2KB, place *Place, created_by, updated_by, v int64, field_at map }

Booking { booking_id "tbk_<32hex>", kind enum{flight,stay,train,car,ticket,other},
  title ≤200, confirmation_code ≤64, starts_at/ends_at *"YYYY-MM-DDTHH:MM",
  start_tz/end_tz *IANA (two zones, so a flight lands in its own zone), place *Place,
  notes ≤2KB, created_by, updated_by, v int64, field_at map }

Place { name ≤200, address ≤300, locality? ≤120, lat, lng, tz, osm_ref?, source: photon|pin|manual }
```

Behavior:
- **Size:** worst case at the caps is about 0.6MB; a typical trip is about 30KB raw, about 6KB gzipped. An integration test measures both.
- **Times** are stored as wall-clock time plus an IANA zone (the source of truth, DST-safe). Clients sort a day by absolute time computed from those (nulls last), then `order`, then `todo_id`. Ideas sort by `order` then id.
- A `day` outside the trip dates is allowed; the UI shows it as "outside trip dates", so changing dates never drops data.
- **Reordering** uses midpoint `order`; when a gap falls below 1e-7, `ApplyOp` renumbers that day's todos in the same write.
- **"Open in maps"** is built on the client from lat/lng. No API.

## Ops (the only write path)

`{v:1, op_id, client_id, seq, at, type, trip_id, entity_id?, patch?}`

- `client_id`: one random ID per installed device. `seq`: strictly increasing per device across all trips. `at`: client clock in ms, offset-corrected using `server_time` from the last sync.
- Types: `trip.create`, `trip.update`, `trip.delete`, `trip.restore`, `todo.create`, `todo.update`, `todo.delete`, `booking.create`, `booking.update`, `booking.delete`.
- Each type decodes `patch` into its own typed struct with pointer fields, and only those fields are mapped onto the model, so `room_id`, `version`, `acked` and the arrays cannot be set from a patch. Unknown patch fields or an unknown `v` give a per-op `unsupported`.

| Result | When |
|---|---|
| `applied` | Normal case. |
| `duplicate` | `seq ≤ acked[client_id]`. Nothing changes. |
| `conflicted` | Some fields were skipped because a newer `field_at` exists; the rest still apply. UI: "B changed this after your offline edit". |
| `rejected` / `gone` | Trip or entity is tombstoned or deleted. Creates never revive a tombstoned ID. |
| `rejected` / `invalid` | Bad values or format. |
| `rejected` / `cap` | A per-trip cap would be exceeded. |
| `rejected` / `forbidden_or_unknown` | Wrong room or unknown trip. One code so it does not reveal whether the trip exists. |
| `rejected` / `unsupported` | Unknown op type, patch field or `v`. |
| `retry` | Compare-and-swap kept losing. The op stays in the outbox. |

**Client rule:** drop `rejected`/`unsupported` ops and revert their optimistic state; retry `retry` ops.

**Creates:** `trip.create` uses `InsertOne`. On a duplicate key the server reads the trip: same room and `acked[client_id] ≥ seq` ⇒ `duplicate`; otherwise `forbidden_or_unknown`. A child create whose ID already exists is `duplicate` if it is the same device's acked seq, else `invalid`.

**Conflicts (field-level, by clock):** a field is written only if `op.at ≥ field_at[field]`. `at` is clamped to at most server now, so a phone with its clock set ahead cannot win forever. This handles an offline phone replaying a stale edit hours later, without CRDTs.

## API

All endpoints sit behind the auth middleware and use the `ensureRoomMembership` pattern; a trip must have `room_id == user.RoomID`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/rooms/{room_id}/trips/sync` | Body `{known:{trip_id: version}}` (≤500 entries, 64KB). Returns `{server_time, trips:[TripDelta], removed:[trip_id]}`. |
| POST | `/rooms/{room_id}/trips/ops` | Body `{ops:[Op]}` (≤200 ops, 1MB). Strict envelope; each op decoded on its own from `json.RawMessage`. Returns `{server_time, results:[{op_id, status, code?, skipped_fields?}], trips:[TripDelta for touched trips]}`. Whole-batch failure only for 401/403 and malformed JSON (400). |
| POST | `/rooms/{room_id}/trips/{trip_id}/packing-list` | Online only, idempotent. Creates the List "Packing · <title>" and sets `packing_list_id` only if still null (compare-and-swap). If it loses the race it deletes the List it created and returns the winner's. A link to a deleted List reads back as null. |
| GET | `/places/search?q&lat&lng&lang&limit` | Photon proxy. |
| GET | `/places/reverse?lat&lng` | Drop-a-pin returns a Place; same proxy and caching. |

**Sync response:** an unknown trip comes back as a full copy; so does any trip whose known version is below `tomb_floor`. Otherwise a delta: trip fields if `v > known`, children with `v > known`, tombstones with `v > known`. `removed` lists soft-deleted trips (with `deleted_by`, for "Restore") and purged ones. No GET-by-ID/ETag endpoint (sync with one known entry does the job) and no pagination.

**Places proxy (`internal/services/places`):**
- `PHOTON_BASE_URL` from env, fixed host: self-hosted Photon or a commercial OSM provider with a Photon-compatible endpoint (public Photon is fair-use only). Queries built with `url.Values`, responses capped at 256KB (`io.LimitReader`), 2s timeout, real `User-Agent`.
- Degrades gracefully: on failure returns `200 {results:[], degraded:true}`; the client falls back to a manual place or dropped pin.
- Abuse limits: `q` ≥ 3 chars, client debounce ≥ 300ms, token-bucket rate limit per user and server-wide.
- Privacy: bias coordinates rounded to 1 decimal before forwarding or caching.
- `place_cache`: unique key `sha256(lower(trim(q)) | rounded lat,lng | lang)`, 30-day TTL on `created_at`.
- `tz` per result from an embedded offline zone lookup (`github.com/ringsaturn/tzf`); measure RAM and binary size.
- The UI must show OSM/ODbL attribution (for the frontend spec).

**Transport:** `middleware.Compress(5)` for JSON; `http.MaxBytesReader` on the new endpoints; per-user rate limit on `/ops` and `/sync`; the new handlers use their own error mapper that defaults to **500** (`statusFromErr` in `list.go` defaults to 400 and is not reused).

## Room lifecycle changes (existing code)

- `room_service.go` `cleanupRoomResources`: also delete the room's trips.
- `JoinRoom`: inside the existing transaction, **move** the joiner's solo-room trips to the new room (`room_id` update, `version++`) before deleting the solo room. Outbox ops target `trip_id`, so they keep working; the client rewrites the room in the URL after `/me` refreshes. Any op that still fails returns `forbidden_or_unknown` and is dropped.

## Indexes

- `trips`: unique `trip_id`; `(room_id, deleted_at, trip_id, version)` so the sync manifest is served from the index; TTL on `purge_at`.
- `place_cache`: unique `key`; TTL on `created_at`.

## Backend files (follow the Lists layering)

- **Refactor commit first, separate from the feature:** `memstore.Compose()` returns a struct instead of a positional tuple (11 callers); `NewRouter` takes a `Handlers` struct (3 callers).
- `internal/models/trip.go`: entities, `Place`, `Op`, typed patches, `OpResult`, `TripDelta`.
- `internal/trips/apply.go`: pure `ApplyOp` and `DeltaSince(trip, known)`. No I/O.
- `internal/store/repo.go`: `TripRepository` — `Get`, `Insert`, `ReplaceCAS(trip, expectVersion)`, `Manifest(roomID)`, `GetMany`, `DeleteByRoom`, `MoveRoom`, `EnsureIndexes`.
- `internal/store/mongo/trip_repo.go`, `place_cache_repo.go`; memstore `TripRepo`, `PlaceCacheRepo`.
- `internal/services/trip_service.go`: membership, grouping by trip, CAS retry loop, sync, packing-list linking via `ListService`.
- `internal/services/places/`: `Geocoder` interface, `PhotonGeocoder`, `TZResolver`, rate limiter.
- `internal/http/handlers/trip.go`, `places.go`; routes/middleware in `router.go`; wiring and `EnsureIndexes` in `cmd/gracie-server/main.go`.
- Docs: a Trips section in `backend/CLAUDE.md` (sync contract, client rules for results); `PHOTON_BASE_URL` and rate-limit env vars in `.env.example`.

## Client contract (for the frontend spec; not built now)

- IndexedDB holds `trips` (server snapshots) and `outbox` (ops in seq order). The UI renders the snapshot with pending ops replayed on top, so every tap is instant.
- Flush on `online`, on visibility, and on a backoff timer. Apply returned deltas, drop acked ops, handle each result per the table above. Clock offset comes from `server_time`.
- Map tiles: one allowlisted tile origin whose terms permit prefetching the trip's bounding box via a service worker (OSM public tiles do not). Provider choice belongs to the frontend spec, and `frontend/CLAUDE.md`'s no-third-party-origin rule needs an explicit exception for it.

## Verification

- `ApplyOp`/`DeltaSince` table tests: every op type; duplicate seq; replay after a lost response with 1000+ intervening ops by others (no double-apply); stale offline edit ⇒ `conflicted`; future clock clamped; edit to a deleted child ⇒ `gone`; create on a tombstoned ID not revived; caps; non-allowlisted patch field ⇒ `unsupported`; order renumbering; delta vs full copy across `tomb_floor`.
- Service tests (memstore): CAS retry under a simulated concurrent writer; cross-room access; `trip.create` retry ⇒ `duplicate`; JoinRoom moves trips; room cleanup deletes trips; packing-link race leaves one List.
- Handler tests (httptest + full router): per-op results in one batch; 413 on oversized body; gzip response; 500 mapping; places degrades on a fake server that times out or errors.
- `make test-integration` (real Mongo): `ReplaceCAS` version guard; duplicate key on insert; TTL indexes exist; measured document size for a typical trip and one at the caps.
- `make check` passes and the coverage ratchet holds.

## Amendment 2026-10-15 (from the UI brief)

Decided while shaping the UI (`2026-10-15-trips-ui-brief.md`, section 7):

- **`created_by` / `updated_by`** on `TripTodo` and `Booking`. The server sets both from the
  authenticated user in `ApplyOp`; neither is a patch field. `updated_by` changes on every
  applied update that changed at least one field.
- **`Place.locality`** (town or city, ≤120). Filled from Photon's `city`/`town`/`village`
  (or `reverse`); empty for manual places. Used to suggest day labels.
- **`stops []Place`** on the trip: a hand-entered, ordered route (cap 12). Set as a whole list
  through `trip.update` (one field clock, `field_at["stops"]`). Display only: it never moves
  todos or changes `tz`.
- **`days` map** (date → label ≤40 chars, cap 60): set through `trip.update` with a
  `days: {"2026-10-24": "Sintra"}` patch, where an empty string removes the label. Each date
  has its own clock, `field_at["days.2026-10-24"]`, so two members labelling different days
  never conflict. Labels for dates outside the trip are kept, the same as todos.
- Tests: add `ApplyOp` cases for the per-date clock, the stops cap, and `created_by` not being
  settable from a patch.

## Skeptic review → resolution

| # | Issue | Resolution |
|---|---|---|
| B1 | BulkWrite cannot report per-op results and stops on first error | Go `ApplyOp` + compare-and-swap `ReplaceOne` |
| B2 | Upsert creates misreport retries; deleted trips come back | `InsertOne` + duplicate-key read; tombstones |
| B3 | Update on a deleted todo reports `applied` | Explicit `gone` |
| M4 | Idempotency ring can evict and allow replay | Per-device `acked[client_id]` seq |
| M5 | Last-arrival-wins loses newer edits | Per-field `at` clocks + `conflicted` |
| M6 | Patch field injection | Typed patch structs |
| M7 | Schema change freezes the outbox | `op.v` + per-op `unsupported` |
| M8 | Size / full-copy sync | Smaller caps + per-entity deltas |
| M9 | Room lifecycle ignores trips | Cleanup + move on join |
| M10 | Single-member delete | Soft delete + restore |
| M11 | Packing list race | CAS link (online-only kept) |
| M12 | Geocoder policy and privacy | Self-host/provider, limits, rounding, attribution |
| M13 | No body limits | `MaxBytesReader` + caps |
| M14 | Time zones | Stored per-todo tz, start/end tz on bookings |
| minor | Encryption, indexes, existence oracle, float order, ETag, error default, `server_time`, refactor scope, tzf size | See sections above |

## Implementation notes (precision amendments)

1. The manifest index also carries `deleted_by`: `(room_id, deleted_at, trip_id, version, deleted_by)`.
2. Each `TripDelta` returned from `/ops` and `/sync` includes `base_version`, plus `deleted` / `deleted_by` flags.
3. A stale packing-list link is repaired by `POST .../packing-list`; the sync payload returns the stored id and does not check that the List still exists.
4. Reverse-geocode results are deliberately not cached (exact pin coordinates are not stored).
5. Wire shapes as built: `removed` is `[{trip_id, deleted_by?, purged?}]`; a `TripDelta` is `{trip_id, full, base_version, version, deleted?, deleted_by?, trip?, todos?, bookings?, removed_ids?}` with child deletions in `removed_ids`; nullable fields use `omitempty`, so a missing key means null.
