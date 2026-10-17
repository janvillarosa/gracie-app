# Behavior analytics

What people and Houses do, recorded as events and folded into aggregates. Feeds smart suggestions and the year review.

## Backend (events, rollups, backfill)

_Backend paths are relative to `backend/`; packages live under `backend/internal/`._

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
- **Run shape:** each `ContainerRhythm` also stores `run_minutes`, `run_items` and `run_gap_sec` (medians over
  `predict.RunSpans`), which the run hint scales its thresholds by.
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

## Frontend (`lib/analytics/` tracker)

_Frontend paths are relative to `frontend/src/`._

- `tracker.ts` is a small injectable queue (`Tracker`); `index.ts` binds it to the API and `localStorage`.
  `AuthProvider` turns it on for the signed-in key and off (queue cleared) on sign-out. It is best
  effort: `track()` never throws, the queue is capped (200), mirrored to `localStorage` inside
  try/catch, flushed every 10s, on `visibilitychange` -> hidden (`keepalive`) and when back online.
  Event ids are client-made, so a retried batch is deduped by the server.
- Events go to `POST /events` on **our** API (no third-party SDK). They carry no identity: the server
  takes the user and house from the API key. Allowed names are the `Client: true` registrations in
  the backend; the subject type must equal the name's prefix. Never put typed text in an event: `key`
  is a normalized item name, nothing else is free text.
- `apiFetch` sends `X-Timezone` on every call; the server buckets behavior in local time with it.
- Call sites: `app.open` / `app.resume` (`startAppTracking`), `list.view` (`ListPage`),
  `item.delete_undone`, `add_bar.suggestion_accepted` (`AddItemBar`, needs `listId`), `trip.view`.
  Tests need the default `POST /api/events` handler in `testServer.ts` (MSW errors on unhandled requests).
