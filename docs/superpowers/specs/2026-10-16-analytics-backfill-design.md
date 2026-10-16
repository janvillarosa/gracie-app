# Analytics backfill — design

## Context

Behavior analytics (`2026-10-16-behavior-analytics-design.md`) started recording on the
day it shipped. Everything people did before that is invisible to it: a house that has
shopped every Saturday for a year has no rhythm, no `due_at`, and an empty year review
until new events build up.

This change rebuilds what it can from the domain documents that already exist and feeds
it through the **existing** pipeline. Jan chose a one-off CLI command
(`cmd/analytics-backfill`) on top of a shared `analytics.Backfill` service, so an HTTP
wrapper can be added later without moving logic.

## Approach: synthesize events, let the worker fold them

The rollup worker selects events by `ingested_at` (`event_repo.go:68`); every aggregate
after that keys on `occurred_at` and the stored local time. So a backfill only has to:

1. Read domain documents and derive the events they imply, with `occurred_at` in the past.
2. Stamp them with `ingested_at = now` and insert them through `EventRepository.InsertMany`.
3. Let `FoldOnce` / `ProfilePass` turn them into `period_stats`, `key_stats` and
   `behavior_profiles`. No aggregate code changes.

The fold's exactly-once guarantee (watermark + aggregates in one transaction) and the
`event_id` unique index carry over unchanged.

## What can be recovered

| Source document | Event | `occurred_at` | Actor | Quality |
|---|---|---|---|---|
| `User` | `user.signed_up` | `created_at` | the user | good |
| `Room` | `house.created` | `created_at` | see *Attribution* | time only |
| `List` (incl. soft-deleted) | `list.created` | `created_at` | see *Attribution* | time only |
| `ListItem` (live + archived) | `item.added` (key, category) | `created_at` | `created_by`, else *Attribution* | good |
| `ListItem` with `completed` or `is_archived` | `item.checked` | `updated_at` (proxy) | `completed_by`, else *Attribution* | weak, see below |
| `Trip` | `trip.created` (+ `days_to_start`) | `created_at` | `created_by` | good |
| `Trip` with `deleted_at` | `trip.deleted` | `deleted_at` | `deleted_by` | good |
| `TripTodo` with `done_at` | `todo.checked` (category, `days_to_start`) | `done_at` | `done_by` | good |

**Not recoverable** (no timestamps or never stored): check/uncheck cycles before the last
one, hard-deleted items, list deletes, todo/booking creation and edits, packing-list
creation, house joins, and every client event (opens, views, suggestions). Open-time
histograms and engagement stay empty until live data accrues. Items in a solo house that
was dissolved on join are gone.

**The `item.checked` proxy.** Pre-feature items have no `completed_at`. `updated_at` is the
best we have: for a still-checked item it is roughly the check time (unless edited later);
for an archived item it is the moment the list was cleared (`ArchiveCompletedByList`
stamps all of them at once). A clear usually ends a shopping trip, so a clear of ≥ 3 items
reads as one run at clear time. That is the right shape for run rhythm, but hour-of-week
is the clear hour, not the shopping hour. Accepted; the per-key `interval_days` already
falls back to request-to-request intervals, which are exact.

## Avoiding double counting with live events

Live and backfilled events have different `event_id`s, so dedupe can't catch overlap.
Two guards, both applied:

1. **Cutoff.** Only occurrences strictly before `--before` are emitted. Default: the
   `occurred_at` of the earliest `source: "server"` event in `events` (the moment
   analytics went live), via a new `EventRepository.EarliestOccurred(ctx, source)`. The CLI
   prints the resolved cutoff and refuses to run if `events` is empty and no `--before`
   was given.
2. **Per-record markers.** An item with `created_by` set was created by the instrumented
   code, so its `item.added` already exists → skip. Same for `completed_at` → skip its
   `item.checked`. (Trips already had `created_by`/`done_at`, so they rely on the cutoff.)

## Retention

`ExpireAt = occurred_at + retention`. An event older than the retention window would be
TTL-deleted, possibly before it is folded, and it is outside the 13-month policy anyway.
Occurrences older than `retention − 1 day` are skipped. The one-day margin guarantees the
fold sees them before the TTL monitor does.

## Attribution

Lists, rooms and pre-feature items don't record who acted.

- If the house has **exactly one member** today, attribute to that member.
- Otherwise use actor `system:backfill`. `isRealUser` already excludes `system:*`, so the
  event counts toward house totals, key stats and container rhythm, but not toward any
  person's profile or per-member totals. Better nothing than a wrong person.

Single-member attribution is wrong only if a member has since left; that's rare and
the alternative (no personal history for solo users, most of the base) is worse.

## Timezone

`Local` is computed once at stamp time, so the zone choice is permanent for these events.
Order of preference:

1. the actor's `User.TZ`;
2. for `system:backfill`, the house members' `TZ` if they all agree;
3. for trip events, the trip's `tz`;
4. UTC.

The dry-run report counts how many events fell through to UTC so we can see the skew
before committing.

## Event identity and source

- `event_id = "bf1:<name>:<subject id>"` (e.g. `bf1:item.checked:it_123`). Deterministic,
  so re-runs are no-ops. The `bf1` prefix is a version: if derivation logic is fixed later,
  a `bf2` run would need the `bf1` events and their aggregates removed first (see
  *Rollback*).
- New `analytics.SourceBackfill = "backfill"`. This makes backfilled events findable and
  deletable as a set.
- **One behavior change:** `profile.go:123` counts only `SourceServer` toward `act_how`.
  It becomes `e.Source != SourceClient`, so backfilled actions shape the hour-of-week
  habit. Client events are still excluded exactly as today.

## Package shape

`analytics` must not learn about lists or trips (open/closed, same as the registry). Each
domain contributes a **source**; the service only orchestrates.

```go
// analytics/backfill.go
type BackfillEnv struct {
    Before    time.Time // exclusive cutoff
    Retention time.Duration
    Now       time.Time
    TZ        func(ctx context.Context, actorID, roomID string) string // resolution above
}

// A BackfillSource walks one domain and emits the events its documents imply.
// Implementations are pure derivation over a read-only cursor; they never write.
type BackfillSource interface {
    Name() string // "users", "rooms", "lists", "items", "trips"
    Each(ctx context.Context, env BackfillEnv, emit func(Event) error) error
}

type BackfillOptions struct {
    RoomID string // limit to one house (for a trial run); "" = everything
    DryRun bool
    Fold   bool   // drive FoldOnce + ProfilePass until drained after inserting
}

type BackfillReport struct {
    Cutoff         time.Time
    ByName         map[string]int // emitted per event name
    Skipped        map[string]int // reason -> count: "after_cutoff", "live_marker", "retention", "empty_key"
    UTCFallback    int
    Inserted       int            // new rows (duplicates from a re-run excluded)
    Folded         int
}

func NewBackfill(events EventRepository, reg *Registry, worker *Worker, sources ...BackfillSource) *Backfill
func (b *Backfill) Run(ctx context.Context, env BackfillEnv, opt BackfillOptions) (*BackfillReport, error)
```

`Run`:
1. Resolves the cutoff, then streams each source.
2. For each emitted event, applies the cutoff/retention guards and checks the name against
   the registry. Unknown names are a programming error, so `Run` fails.
3. Sets `Source = SourceBackfill` and the deterministic id, then stamps through the
   existing `Stamp` (with the resolved tz).
4. Inserts in batches of 500.
5. With `Fold`, loops `FoldOnce` until it returns 0, then `ProfilePass` until 0. The lease
   means this is safe while the server's own worker is running; whichever holds the lease
   folds. Without `Fold`, the server picks them up at 5,000 events per 15-minute tick.

Sources live with their domain and use their own derivation helpers, so event shapes match
live emission exactly:

- `services.UserBackfill`, `services.RoomBackfill`, `services.ListBackfill`,
  `services.ItemBackfill` reuse `parse.NormalizeKey`, `listRef`, and the same Subject/Container
  as `emitItem`.
- `trips.TripBackfill` reuses `DaysToStart` and the `todo` subject/container shape from
  `EventsFor`.
- Derivation is split into pure functions (`deriveItemEvents(it, room) []Event`, etc.) that
  are unit-tested directly; `Each` is just cursor + derive.

**Reads.** The current repositories have no "iterate everything" methods. Rather than
widen `UserRepository`/`RoomRepository` (used by request paths), add one narrow read-only
interface in `store`:

```go
type BackfillReader interface {
    EachUser(ctx context.Context, fn func(models.User) error) error
    EachRoom(ctx context.Context, roomID string, fn func(models.Room) error) error // "" = all
    EachList(ctx context.Context, roomID string, fn func(models.List) error) error
    EachItem(ctx context.Context, roomID string, fn func(models.ListItem) error) error
    EachTrip(ctx context.Context, roomID string, fn func(models.Trip) error) error
}
```

Implemented with batched cursors in `store/mongo/backfill_reader.go` (projection excludes
fields we never read, e.g. password/api-key fields) and in memstore for tests.

## CLI — `cmd/analytics-backfill`

```
analytics-backfill [--apply [--fold]] [--room <room_id>] [--before <RFC3339>]
```

- Reads the same env as the server (`MONGODB_URI`, `MONGODB_DB`,
  `ANALYTICS_RETENTION_DAYS`) via `config.Load`, so it can run as a one-off on the deployed
  image with no extra secrets.
- **Dry run is the default.** Writing requires `--apply` (a typo can't write). `--dry-run` is
  accepted as an explicit synonym for the default.
- Prints the `BackfillReport` as JSON (and a short human summary to stderr). Exit code
  non-zero on any error; partial progress is safe because a re-run skips what was inserted.
- Refuses to run if `ANALYTICS_ENABLED=false`, because a backfill into a disabled system
  would fold nothing and surprise later.
- Built into the server image next to `gracie-server` (both `Dockerfile*`) so it can be
  run as a Railway one-off command.

Recommended operator flow: dry run on everything → `--apply --room <a real house>` →
check `GET /rooms/{id}/insights` → `--apply --fold` for everything.

## Consistency, security, rollback

- **ACID.** Inserts are not transactional with each other; they don't need to be. Each
  event is independently idempotent, and the fold applies any window exactly once. A crash
  mid-run leaves a prefix inserted; a re-run completes it. (Exactly-once folding needs the
  replica set, the same caveat as live analytics.)
- **CAP.** Single primary, CP, as before. Backfill runs only add load; inserts batch at 500
  and the fold is capped per pass.
- **Privacy.** Same rules as live events: normalized keys only, no item text, notes,
  places or codes. The reader's projections never load credential fields.
- **Deletion.** Backfilled events carry the same `actor_id`/`room_id`, so the existing
  `Purger` erases them with the account or house. Nothing new to do.
- **Auth surface.** None. No route is added; access is whoever can run a command against
  the database.
- **Rollback.** Raw events are easy: `deleteMany({source: "backfill"})`. Aggregates
  aren't, because they are `$inc` counters. There is no `Rebuild` yet (the analytics spec
  names it, but it wasn't built). So rollback means dropping `period_stats`/`key_stats`/
  `behavior_profiles` and refolding from raw events by resetting the watermark. That is
  possible because rollups are derived from events, but it's out of scope here. Mitigation:
  dry run plus a one-house trial before the full apply. **Flagged for review.**

## Testing

- **Unit (`make test-unit`), table-driven:**
  - Per-domain derivation: item with/without `created_by`, completed vs archived vs open,
    `completed_at` present → no check, empty normalized key → skipped, trip with and
    without start date (`days_to_start`), soft-deleted trip, done todo.
  - Guards: cutoff boundary (equal to cutoff is excluded), retention boundary with the
    1-day margin.
  - Attribution: one-member house → member; multi-member → `system:backfill`.
  - TZ resolution order, including UTC fallback counting.
  - Deterministic ids; a second `Run` inserts 0 and leaves folded counts unchanged
    (memstore + `MemRecorder`-style fakes).
  - Field parity: a derived `item.added` equals what `emitItem` produces for the same item,
    apart from id/source/time. This keeps backfill and live shapes from drifting.
  - `act_how` now includes `SourceBackfill` and still excludes `SourceClient`.
- **Integration (`make test-integration`):** Mongo `BackfillReader` cursors (room filter,
  projection), `EarliestOccurred`, and an end-to-end run: seed old items/trips → backfill
  with `--fold` → `period_stats` and `key_stats.interval_days` populated → second run
  changes nothing.
- **Manual:** dry run against a copy of production data; check the UTC-fallback count and
  per-name totals look plausible before applying.

## Files

New:
- `backend/internal/analytics/backfill.go` (+ `_test.go`)
- `backend/internal/services/analytics_backfill.go` (+ `_test.go`)
- `backend/internal/trips/analytics_backfill.go` (+ `_test.go`)
- `backend/internal/store/mongo/backfill_reader.go` (+ integration test)
- `backend/internal/testutil/memstore/backfill_reader.go`
- `backend/cmd/analytics-backfill/main.go`

Modified:
- `analytics/event.go` (`SourceBackfill`), `analytics/profile.go` (act source check),
  `analytics/repo.go` + `store/mongo/event_repo.go` + memstore (`EarliestOccurred`)
- `store/repo.go` (`BackfillReader`)
- `backend/Dockerfile*` (build the second binary)
- Docs: `backend/CLAUDE.md` (analytics section), analytics spec follow-ups

## Build order (each step passes `make check` before its commit)

1. `SourceBackfill`, the `act_how` change, `EarliestOccurred` (repo + memstore + mongo).
2. `BackfillReader` (interface, memstore, mongo + integration test).
3. `analytics.Backfill` service with guards, ids, batching, fold loop, report.
4. Domain sources: services (users, rooms, lists, items), then trips, with parity tests.
5. CLI + Dockerfiles + docs.

## Calls I made (for review)
- `item.checked` uses `updated_at` as a stand-in for check time, so archived items read
  as one run at clear time.
- Multi-member houses get `system:backfill`, which means house-level history only for
  their unattributed events.
- Events older than retention minus 1 day are skipped, not kept.
- Dry run is the default, and writes need `--apply`.
- `act_how` will count backfilled actions.
- No rollback tooling in this change. The guard against a bad apply is the one-house trial.
