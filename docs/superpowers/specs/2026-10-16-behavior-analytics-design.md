# Behavior analytics for Bauhouse — design + plan

## Context

Jan wants Bauhouse to learn how each person and each house behaves, so it can later
power: add-bar suggestions ("milk is due"), smart nudges ("you usually shop Saturday
mornings, 6 items waiting"; "trip in 5 days, last time you packed 3 days out"), and an
end-of-year review. The main job is **predicting when someone will act on a list or a
trip**. This work builds the data layer those features sit on. Each feature UI is a
separate, later piece of work.

What exists today: nothing. There are no events, audit log, or telemetry. List items
record no `completed_at`/`completed_by`/`created_by`. Users and houses have no
timezone. Item deletes are hard deletes. `GetPantry` rebuilds per-item history on
every call by scanning the whole house (`services/list_service.go:343`).

Decisions Jan made:
- **Capture views and changes.** The server records every change. The app also
  sends opens, views, and nudge/suggestion interactions to **our own API** (no
  third-party SDK, per `frontend/CLAUDE.md`).
- **A module in the existing API.** A new Go package in the same server and Mongo
  database, behind interfaces so it can be split out later.
- **Visibility: house totals plus per-person.** A house review can show per-member
  counts. Nudges stay personal. Raw events are never exposed over HTTP.
- **Retention: about 13 months of raw events**, with rollups kept for the life of
  the account. Everything is deleted with the account or house.

## Shape

```
service write ──► Recorder.Record(ev)  (non-blocking, buffered)
client batch ──► POST /events ─┘            │ batch InsertMany (dedupe on event_id)
                                            ▼
                                  events  (raw, TTL 400d)
                                            │ rollup worker: fold every 15 min, profiles hourly (leased)
                                            ▼  fold window + advance watermark in ONE txn
        period_stats ── key_stats ── behavior_profiles   ◄── Reader (point lookups)
```

Writes are cheap appends. Reads never scan events: every consumer reads one
precomputed document by `_id` (or a small indexed range).

### Consistency trade-offs (flagged per ACID/CAP)
- An event is recorded **after** its domain write succeeds and is **not** part of
  that transaction, so analytics is eventually consistent with domain data. If the
  process crashes, events still in the buffer are lost (counted in a dropped-events
  log). I chose this over an outbox because analytics must never slow down or fail
  a user write. Graceful degradation: when the buffer is full, events are dropped,
  not blocked.
- Folding is **exactly-once**. The worker folds events with
  `ingested_at ∈ [watermark, now-2m)` and applies `$inc` upserts and the watermark
  advance in **one Mongo transaction** (the replica set already supports this). A
  lease document makes sure only one instance folds at a time.
- CAP: a single Mongo primary, so CP. If Mongo is unreachable, recording degrades
  to dropping events, and reads return "no profile" so callers fall back to
  non-personalized behavior.

## 1. Event model — `backend/internal/analytics/event.go`

The envelope is **domain-agnostic**: no `ListID`/`TripID` columns. Every event
names *what* it is about and *what that sits in* with typed references, so a new
feature (recipes, chores, …) adds events without changing the envelope, indexes, or
rollup code.

```go
type Ref struct {
  Type string `bson:"type"` // "list" | "item" | "trip" | "todo" | "booking" | "house" | later "recipe", …
  ID   string `bson:"id"`
}

type Event struct {
  EventID    string         `bson:"event_id"`   // uuid; client-supplied for client events (idempotency)
  V          int            `bson:"v"`          // envelope schema version (starts at 1)
  Name       string         `bson:"name"`       // "<subject type>.<verb>": "item.checked", "recipe.cooked"
  Source     string         `bson:"source"`     // "server" | "client"
  ActorID    string         `bson:"actor_id"`   // who did it ("system:*" for jobs)
  RoomID     string         `bson:"room_id"`
  Subject    Ref            `bson:"subject"`              // the thing acted on
  Container  *Ref           `bson:"container,omitempty"`  // what it lives in: item→list, todo→trip, ingredient→recipe
  Key        string         `bson:"key,omitempty"`        // stable "thing" identity across instances, e.g. normalized item text; never raw text
  Category   string         `bson:"category,omitempty"`
  Targets    []string       `bson:"targets,omitempty"`    // other users the event is about: assignees, mentions
  Props      map[string]any `bson:"props,omitempty"`      // small, schema-checked per name
  OccurredAt time.Time      `bson:"occurred_at"`          // UTC
  Local      LocalTime      `bson:"local"`                // {tz, date "2026-10-16", dow 0-6, hour 0-23, how 0-167}
  IngestedAt time.Time      `bson:"ingested_at"`
  ClientID   string         `bson:"client_id,omitempty"`
  SessionID  string         `bson:"session_id,omitempty"`
  ExpireAt   time.Time      `bson:"expire_at"`            // OccurredAt + retention (TTL)
}
```

### Extending it: a registry, not a switch
SOLID's open/closed rule applies here. Each domain package **registers** its events at
startup. Nothing in `analytics/` names lists or trips.

```go
analytics.Register(analytics.EventDef{
  Name:   "item.assigned",
  Props:  schema{"via": enum("manual","rotation")},  // validation; unknown props dropped
  Client: false,                                      // may clients send it?
})
analytics.RegisterProjection(proj)  // optional: a reducer feeding an aggregate (see §4)
```

- **Generic projections work for any registered event with no extra code:**
  - per-period counts (`counts.<name>`)
  - hour-of-week activity
  - per-member totals
  - per-`Key` stats (times, last, interval, due)
  - per-`Container` rhythm (runs, next window)
- **Projections specific to a feature** (e.g. trip lead times) implement a small
  interface: `Consumes() []string`, `Fold(ev, *Batch)`, `Recompute(subject, events)`.
  Adding one never touches existing ones.
- **Example: recipes, and items with assignees.**
  - Register `recipe.created/cooked/ingredient_added`, with `Container{recipe}` and
    `Key` set to the normalized recipe name. "Cooks lasagna about every 3 weeks"
    comes from the generic per-Key interval with no new code.
  - Register `item.assigned/unassigned` with `Targets: [assignee]`.
  - The generic projections already count events where you are a target, so
    "assigned to you" totals and the time from assignment to check-off come for
    free. If you want an "assignee response time" model, that one is a new
    projection.
- **Evolution rules:**
  - Props are additive only.
  - Renaming an event means registering the new name and adding an alias entry, so
    old events still fold.
  - A breaking change to the envelope bumps `V`, and folds handle each version.
  - `Rebuild` (§5) replays raw events, so a new projection can be backfilled from
    the last 13 months.

Local time is computed **once at write time** from the user's timezone and stored
on the event. Rollups never redo timezone math, and an event keeps the local time it
happened in even if the user later moves.

**Timezone source.** The frontend sends `X-Timezone: <IANA>` on every request (in
`api/client.ts`). New middleware validates it with `time.LoadLocation` and puts it
in the request context. The user's last-seen zone is saved on `User.TZ`, written only
when it changes, so background jobs can use it. The fallback is UTC.

### Event catalog (server)

These are the v1 registrations. Each domain owns its own list:
`services/analytics_events.go` registers lists, items, houses, and accounts, and
`trips/analytics_events.go` registers trips. Mapping to the envelope:
- **Item events**: Subject `{item}`, Container `{list}`, Key = normalized text.
- **Todo/booking events**: Subject `{todo|booking}`, Container `{trip}`.
- **Trip events**: Subject `{trip}`, Container nil.

| Area | Events (props) | Hook |
|---|---|---|
| Lists | `list.created`, `list.updated {fields}`, `list.delete_voted`, `list.deleted` | `ListService` methods |
| Items | `item.added {key, category, qty?, via: typed\|suggestion}`, `item.checked`, `item.unchecked`, `item.edited {fields}`, `item.starred/unstarred`, `item.deleted`, `items.cleared {count}`, `item.reordered` (stored, not rolled up) | `CreateItem`, `UpdateItem`, `ArchiveCompletedItems`, `DeleteItem`, `UpdateItemPosition` |
| Trips | `trip.created`, `trip.updated {fields}`, `trip.deleted`, `trip.restored`, `todo.created/checked/unchecked/scheduled/unscheduled/deleted {category, day?}`, `booking.created/updated/deleted {kind}`, `packing_list.created` | `TripService.applyGroup` after a successful CAS, only for `OpApplied` results; name derived from op type + patch keys (`trips/apply.go:393-446`) |
| House | `house.created`, `house.joined`, `house.invite_rotated`, `house.delete_voted`, `house.deleted`, `house.settings_updated` | `RoomService` |
| Account | `user.signed_up`, `user.logged_in`, `user.profile_updated`, `account.deleted` | `AuthService`, `UserService` |

Every trip event also carries `props.days_to_start` (start_date minus local date),
the key feature for predicting lead time.

### Event catalog (client), sent to `POST /events`
`app.open`, `app.resume` (visibility returns after 30 min or more), `list.view {list_id}`,
`trip.view {trip_id, tab}`, `add_bar.suggestions_shown {count}`,
`add_bar.suggestion_accepted {rank, key}`, `nudge.shown/tapped/dismissed {nudge_id, kind}`,
`item.delete_undone`. The server allow-lists names and validates each name's props.
It stamps `actor_id`/`room_id` from auth, never from the body.

### Small domain fixes these need (useful outside analytics too)
- `ListItem`: add `created_by`, `completed_at`, `completed_by`. Set them in `CreateItem` and in `UpdateCompletion` (the repo signature gains the actor).
- `ArchiveCompletedByList` returns the modified count (for `items.cleared`).
- `User`: add `tz` (optional, `bson:"tz,omitempty"`).

## 2. Capture

- `analytics.Recorder` interface: `Record(ctx, Event)`. Implementations:
  - `BufferedRecorder`: a channel (cap `ANALYTICS_BUFFER`, default 4096) and a
    flusher goroutine that runs `InsertMany` unordered every 1s or at 200 events.
    Duplicate-key errors are ignored (idempotent). `Close(ctx)` drains on shutdown.
    `main.go` gets a proper shutdown sequence: server, then recorder, then worker.
  - `NopRecorder` (feature off / default in tests), `memRecorder` fake that captures events for assertions.
- Services get it through the existing setter pattern (`UseRecorder(r)`, like
  `UseTripRepo`), so constructors and existing tests don't change.
- `analytics.FromRequest(ctx)` builds the envelope base: user, room, local time
  from ctx tz, and `event_id = uuid`.
- `POST /events` (authenticated): up to 50 events per call, body ≤ 32 KB.
  `occurred_at` is clamped to [now − 7d, now + 5m] so offline trip batches still
  count. Rate-limited with the existing `ratelimit` package. Returns
  `{accepted, rejected}`.
- Frontend `src/lib/analytics/`: `track(name, props)` pushes to an in-memory queue
  that is mirrored to `localStorage` (capped at 200, inside try/catch). It flushes
  every 10s, on `visibilitychange→hidden` (`fetch` with `keepalive: true`, because
  `sendBeacon` can't send the auth header), and on `online`. A `session_id` rotates
  after 30 minutes idle. Call sites: app shell (open/resume), `ListPage` (view,
  suggestion accept, delete undo), trip pages (view/tab), and the add bar.

## 3. Raw store — `store/mongo/event_repo.go`, collection `events`

Indexes are generic, so new features need none:
- unique `event_id`
- `ingested_at`
- `(actor_id, occurred_at)`
- `(targets, occurred_at)` (multikey)
- `(room_id, occurred_at)`
- `(room_id, container.type, container.id, occurred_at)`
- partial `(room_id, subject.type, key, occurred_at)` where `key` exists
- TTL `expire_at` (expireAfterSeconds 0). Retention is
`ANALYTICS_RETENTION_DAYS`, default 400.

## 4. Fast-read aggregates

All three are upserted by the rollup worker. Each read is a point lookup.

**`period_stats`**: `_id = "<scope>:<id>:<period>"`. Scope is `u` (user) or `h`
(house). Period is `2026-10-16`, `2026-10`, or `2026`, all in local dates.
- `counts.<event_name>`: any registered event, automatically.
- `by_category.<subject_type>.<cat>`.
- `containers.<type>:<id>.<event_name>`.
- `active_days`: set by the existence of a per-day doc.
- `targeted.<event_name>`: counts of events where this user was a target (assignments).
- Feature projections add their own fields, e.g. trips adds `trips.{taken,…}`.
- House docs also hold `members.<user_id>.<event_name>` (per-person totals for the review).
- Top things: day docs store `key_counts.<subject_type>.<key>`. Month and year docs
  keep a capped top-50 per subject type, recomputed when the month closes.
- Year in review = 1 year doc + 12 month docs.

**`key_stats`** (generic; items today, recipes tomorrow): `_id = "<room_id>:<subject_type>:<key>"`
- `counts.<verb>`, `first_at`, `last_at.<verb>`, `category`, `containers` (top 3), `by_actor.<user_id>`.
- Each EventDef declares which verb **completes** the thing (`item.checked`,
  `recipe.cooked`) and which **requests** it (`item.added`).
- `interval_days`: EWMA of days between completions (α=0.3), with request-to-request
  as the fallback. `interval_cv` is the spread.
- `due_at = last completion + interval_days`, set only when there are ≥ 3 completions.
- Indexes: `(room_id, subject_type, due_at)` for "what's due"; `(room_id, subject_type, last_at.request)` for recency.
- Later, this replaces `GetPantry`'s full scan. The swap itself is not in scope here.

**`behavior_profiles`**: `_id = "u:<user_id>"` or `"h:<room_id>"`, with a
`computed_at` field. The worker recomputes these for every subject that had events
in the window, using the last 180 days of events (an indexed range query).
- `open_how[168]` and `act_how[168]`: hour-of-week histograms of opens and of
  actions, with exponential decay (half-life 28 days, so recent habits win).
- `containers.<type>:<id>` holds the rhythm of any container (a grocery list today,
  a recipe box or chore list later):
  - A **run** is ≥ 3 completions in that container within 45 minutes.
  - Fields: `runs_n`, `last_run_at`, `run_interval_days` (EWMA), `run_interval_cv`, `run_how[168]`.
  - `next_run: {start, end, confidence}`. The day comes from `last_run_at + interval`, the hour from the peak of `run_how` near that day, and confidence from n and cv (0 when n < 3).
- `assigned` (generic, from `targets`): open assignments, median time from
  assignment to completion, and completion rate.
- `trips` (a trip-specific projection) holds lead-time habits: medians of days-before-start for `trip.created`,
  first booking, `packing_list.created`, first packing check, packing ≥ 90% checked,
  first todo scheduled, plus `n_trips`.
- `engagement`: `last_open_at`, `active_days_28`, `streak_days`, `typical_session_min`.

All prediction math lives in pure functions in `analytics/predict/` (runs, EWMA,
decay, median lead, next window). The worker and the tests share them.

## 5. Rollup worker — `analytics/rollup.go`

Copies the `RunCoordsPurge` pattern (`services/trip_purge.go:52`), as goroutines
started in `main.go`, with jitter.

**Cadence. 1 minute was too eager.** Nothing downstream needs minute freshness:
- Nudges act on habits measured in days.
- The year review is read once a year.
- The one case that feels "live" is that milk shouldn't be suggested right after
  you add or check it. That is handled at **read time**: the suggestion consumer
  filters `key_stats` against the list's live items, which it has already loaded.

So the worker has two schedules:
- **Fold**: counters, `period_stats`, and `key_stats` incl. intervals. Every
  `ANALYTICS_FOLD_EVERY`, default **15m**. A pass with no new events costs one
  indexed query.
- **Profiles**: `behavior_profiles` for subjects marked dirty by folds. Every
  `ANALYTICS_PROFILE_EVERY`, default **1h**, plus a nightly full pass that refreshes
  decay for idle subjects.

Steps in the fold pass:
1. Acquire a lease (`analytics_state` doc `{_id:"rollup", lease_until, owner, watermark}`, `findOneAndUpdate` where `lease_until < now`).
2. Read events with `ingested_at ∈ [watermark, now-2m)`, at most 5,000 per pass.
3. Run every registered projection's `Fold` into one batch. In one transaction:
   bulk `$inc`/`$max`/`$min` upserts into `period_stats` and the `key_stats`
   counters, add the touched subjects to the `dirty` set, then advance the watermark.
4. Outside the transaction, recompute `key_stats` intervals for the keys it touched.
   This is deterministic, a full replace, so it is safe to redo.
5. The profile pass drains the `dirty` set and calls each projection's `Recompute`.
   Once a day it closes finished months and computes the capped top items.

`Rebuild(ctx, subject)` recomputes a subject's aggregates from raw events. It is used
by tests and for backfill or repair.

## 6. Reads — `analytics.Reader`

```go
Profile(ctx, userID) (*Profile, error)            // u:
HouseProfile(ctx, roomID) (*Profile, error)       // h:
KeyStats(ctx, roomID, subjectType string, keys []string) (map[string]KeyStat, error)
Due(ctx, roomID, subjectType string, before time.Time, limit int) ([]KeyStat, error)
Period(ctx, scope, id, period string) (*PeriodStats, error)
```

HTTP, read-only, all membership-checked through `ensureRoomMembership`:
- `GET /me/insights`: your own profile.
- `GET /rooms/{room_id}/insights`: the house profile plus due items.
- `GET /rooms/{room_id}/insights/periods/{period}`: house period stats, including per-member totals (the visibility rule Jan chose).
- No endpoint returns raw events.

## 7. Privacy, security, deletion
- No raw item text, notes, places, confirmation codes, IPs, or user agents. Item
  identity is only the normalized key. Platform is a coarse enum (`web|pwa`).
- `POST /events`: allow-listed names, a per-name prop schema (unknown props are
  dropped), size caps, and rate limiting. Identity comes from auth only.
- `DeleteAccount` deletes the user's events, `u:` profile, and `u:` period_stats.
- House deletion (`cleanupRoomResources`) deletes the house's events,
  `key_stats`, `h:` profile, and `h:` period_stats.
- Raw events expire through TTL after 400 days.
- Not in v1 (follow-up): a user-facing analytics opt-out. `Recorder` has a single
  check point where it would go.

## 8. Config (`internal/config/config.go`, `.env.example`)
`ANALYTICS_ENABLED` (default `true`; `false` → `NopRecorder` and no worker),
`ANALYTICS_BUFFER=4096`, `ANALYTICS_FOLD_EVERY=15m`, `ANALYTICS_PROFILE_EVERY=1h`, `ANALYTICS_RETENTION_DAYS=400`,
`ANALYTICS_EVENTS_RPS=2`.

## Files

New:
- `backend/internal/analytics/` with `event.go`, `catalog.go` (names + prop schemas), `recorder.go`, `context.go`, `rollup.go`, `fold.go`, `reader.go`, and `predict/` (pure functions)
- `backend/internal/store/mongo/{event_repo,analytics_agg_repo}.go`, plus their interfaces in `store/repo.go`
- `backend/internal/testutil/memstore/analytics.go` (fakes, added to `Repos`/`Compose`)
- `backend/internal/http/middleware/timezone.go`, `backend/internal/http/handlers/{events,insights}.go`
- `frontend/src/lib/analytics/{tracker.ts,tracker.test.ts}`

Modified:
- `models/{list_item,user}.go`
- `services/{list,room,user,auth,trip}_service.go`
- `store/mongo/list_item_repo.go` (actor and count)
- `router/router.go`, `cmd/gracie-server/main.go` (wiring + ordered shutdown), `config/config.go`
- `frontend/src/api/client.ts` (tz header), `ListPage.tsx`, trip pages, add bar, app shell
- Docs: `backend/CLAUDE.md`, `backend/internal/store/CLAUDE.md`, `frontend/CLAUDE.md`, `.env.example`
- Spec copy: `docs/superpowers/specs/2026-10-16-behavior-analytics-design.md`

## Build order (each phase passes `make check` before its commit)

1. **Foundation.** Commit the spec. Add the event model and catalog, the Recorder
   (buffered/nop/mem), the event repo (Mongo + memstore + indexes), the tz
   middleware and `User.TZ`, the `ListItem` actor/time fields, and config + wiring
   with ordered shutdown.
2. **Server instrumentation.** Lists, items, houses, and accounts emit events, then
   trips (`applyGroup`). Service tests assert the exact events through `memRecorder`.
3. **Client events.** `POST /events` handler + validation + rate limit, the
   frontend tracker, the tz header, and the call sites.
4. **Rollups.** The worker with lease + watermark transaction, plus `period_stats` and `key_stats` counters.
5. **Predictions + reads.** `predict/` pure functions, `behavior_profiles`, `key_stats` intervals, the Reader, and the insights endpoints.
6. **Deletion + retention hooks, docs.**

## Verification
- Unit (`make test-unit`), table-driven:
  - Event naming from op type + patch.
  - Prop validation and clamping.
  - Local-time bucketing, including DST transitions (America/New_York, Australia/Sydney) and a midnight-crossing run.
  - Run detection, EWMA, decay, median lead time, next-window, and confidence with n < 3.
  - Fold producing the expected `$inc` set.
  - The recorder dropping events when full without blocking.
  - The tracker's queue, flush, keepalive, and dedupe (Vitest).
- Integration (`make test-integration`):
  - The event repo dedupes on `event_id`.
  - The TTL index exists.
  - The rollup is exactly-once: run the same window twice and the counts don't change. Kill the run after the insert and before the commit, and the watermark has not advanced.
  - Two workers contend for the lease.
  - Account and house deletion remove analytics data.
- End to end: `docker compose up --build`. Sign up, create a list, add and check
  items over a few simulated days (a test helper seeds backdated events), then
  wait one rollup tick. Check that:
  - `GET /me/insights` and `GET /rooms/{id}/insights` show hour-of-week peaks, a `next_run` window, and `due_at` for a repeated item.
  - `GET /rooms/{id}/insights/periods/2026` shows per-member totals.
  - Offline: queue client events, go online, and they arrive once.
- `make check` green, and coverage floors held.

## Calls I made (for review)
- Events are recorded after the domain write and kept out of its transaction. A crash can lose up to about 1s of buffered events.
- Folds run every 15 minutes and profiles every hour. Live list state covers the
  freshness gap at read time. Both intervals are env-tunable.
- The envelope is domain-agnostic (subject/container/key/targets), with a
  registry plus projections. New features register events and get counts, rhythm,
  due dates, and assignment stats without touching `analytics/`.
- A "shopping run" is ≥ 3 check-offs within 45 minutes. The EWMA α is 0.3 and the decay half-life is 28 days. All are constants in `predict/` and easy to tune.
- Only normalized item keys are stored, never raw item text.
- The analytics opt-out and the `GetPantry` → `key_stats` swap are deferred to follow-ups.
