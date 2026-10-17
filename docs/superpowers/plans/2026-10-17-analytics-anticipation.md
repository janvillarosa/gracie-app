# Analytics anticipation upgrade Implementation Plan

**Goal:** Teach the analytics engine what it needs to anticipate a household rather than just describe it: when the house is away, whether a thing will be needed before the next shop, which things follow the calendar (bin day), whose turn something probably is, and how much is bought.

**Why:** The autopilot engine decides and acts; this plan is the learning half it reads from. Every task also stands alone: tasks 1–4 make today's smart suggestions more accurate before any autopilot code exists.

**Architecture:** `internal/analytics` stays feature-agnostic ("knows no feature"). New knowledge enters through a generic port (an away calendar) and generic event flags, never through imports of `trips` or `services`. All new math lives in `analytics/predict` (pure, no I/O). Forecast changes bump `analytics.ForecastVersion`, so stored forecasts rebuild from history.

## Global Constraints

- `internal/analytics` and `analytics/predict` import nothing from `trips`, `services` or `models` beyond what they import today. Trips reach analytics only through the `AwayCalendar` port (Task 3) and registered events.
- **Away time is not time.** A gap between two buys is measured in *home time*: wall-clock time minus the overlap with the house's away spans. Due dates are projected in home time too (a 7-day rhythm with a 5-day trip in the middle is due 12 days later).
- **The house is away** on a date when every current member is away. A trip with no travellers set means the whole house goes (today's trips keep their meaning). A member is away on a trip's dates from `start_date` 00:00 to `end_date` 24:00 in the trip's `tz` (house tz if empty).
- `ForecastVersion` goes 2 → 3 in Task 4 (one bump for all forecast changes in this plan). `RefreshStale` rebuilds every key; no backfill run is needed.
- New stored fields are additive and `omitempty`. No raw item text, free-text quantities, notes, places or IPs in events (quantity is a parsed number plus a unit enum, Task 8).
- Tune with `suggest-eval`, not by feel. A task that changes forecasts shows the `backtest` report before/after in its commit body; the overall hit rate may not drop.
- Commits: Conventional style with a scope, e.g. `feat(analytics): …`, `feat(trips): …`.

## Review Focus

- A house that never travels gets byte-identical forecasts before and after. → `TestHomeClockNoAwayIsIdentity`, `TestPredictNoAwayUnchanged`.
- A 2-week holiday must not stretch a weekly item's rhythm, and the first week back must not show a burst of "overdue" suggestions. → `TestHolidayDoesNotStretchRhythm`, `TestDueShiftsPastTrip`.
- A solo trip (one of two members) must **not** count as the house being away. → `TestSoloTripIsNotHouseAway`.
- Editing a trip's dates re-learns that house's forecasts within one fold tick, and only that house's. → `TestAwayChangeRequeuesOnlyThatRoom`.
- `NeedBy` never claims certainty from thin history. → `TestDueByThinHistory`.

### Task 1: Who's going on a trip (Mongo)

**Files:** `backend/internal/models/trip.go` (`TripFields`), `backend/internal/trips/patch.go` (`TripPatch`), `validate.go`, `apply.go`, `delta.go` if fields are enumerated there; frontend trip types and `frontend/src/pages/TripSettings.tsx`. Tests: `trips/apply_trip_test.go`, `validate_test.go`, a TripSettings test.

**Interfaces:** `TripFields.Travellers []string \`bson:"travellers,omitempty" json:"travellers,omitempty"\`` (user IDs; nil/empty = whole house). `TripPatch.Travellers Opt[[]string]`.

- [ ] Failing tests: a patch sets travellers; `null` clears to whole house; >20 entries or duplicates → invalid op; unknown IDs accepted by the pure engine (membership is checked in the service) but filtered at read time (Task 2).
- [ ] Implement through patch → validate → apply (`change{"travellers", …}`), following `stops` (replaced as a whole list). `TripService` rejects IDs that aren't current members (400). Never bypass `ApplyOp` + `ReplaceCAS`.
- [ ] Frontend: TripSettings gets "Who's going": Everyone (default) or a member multi-select from existing UI primitives (follow `DESIGN.md` and `frontend/CLAUDE.md`; tokens only). The offline outbox carries it like any trip field. Check it in the mock dev server.
- [ ] `make check`, `make test-integration`. Commit `feat(trips): record who's going on a trip`.

### Task 2: Presence and the home clock (pure)

**Files:** create `backend/internal/analytics/predict/away.go` (+ test), `backend/internal/trips/presence.go` (+ test).

**Interfaces:**
```go
// predict: generic
type Away []Span // sorted, non-overlapping
func (a Away) Normalize() Away
func (a Away) HomeBetween(from, to time.Time) time.Duration
func (a Away) AddHome(t time.Time, d time.Duration) time.Time
func (a Away) Contains(t time.Time) bool
// trips: domain
func HouseAway(trips []models.Trip, members []string, houseTZ string) predict.Away
func MemberAway(trips []models.Trip, member string, houseTZ string) predict.Away
```
Soft-deleted trips and trips without both dates are ignored.

- [ ] Failing tests: identity with no away; `HomeBetween` across one span, two spans, a span covering `from`; `AddHome` landing inside a span jumps to its end; solo trip isn't house away but is member away; nil travellers = whole house; trip tz differs from house tz → span edges at the trip's local midnights; deleted/dateless trips ignored; members who left ignored.
- [ ] Implement (O(n) over a normalized slice). `make check`. Commit `feat(analytics): home clock and household presence from trips`.

### Task 3: The away-calendar port and invalidation (Mongo)

**Files:** `analytics/rollup.go` (`Worker`), `registry.go` (`EventDef`), `aggregate.go` (`AggregateRepository`), `profile_worker.go`; the Mongo aggregate repo and `testutil/memstore/analytics_agg.go`; create `services/away_calendar.go` (adapter: rooms + trips → `predict.Away`); `trips/analytics_events.go`; wiring in `cmd/gracie-server/main.go`.

**Interfaces:**
```go
type AwayCalendar interface {
    HouseAway(ctx context.Context, roomID string) (predict.Away, error)
    MemberAway(ctx context.Context, roomID, userID string) (predict.Away, error)
}
func (w *Worker) WithAway(c AwayCalendar) *Worker // nil = nobody is ever away (today's behaviour)
// EventDef gains RequeueRoom bool: folding the event marks every key of its room stale.
// AggregateRepository gains RequeueRoomKeys(ctx, roomID string) (int, error): sets v=0 on the room's key_stats.
```
New event `trip.away_changed` (`RequeueRoom: true`), emitted by `trips.EventsFor` when `start_date`, `end_date`, `travellers` or `tz` change, and on delete/restore of a dated trip.

- [ ] Failing tests: two rooms, one event → only room A's keys get `v=0`; `EventsFor` emits `trip.away_changed` exactly on those fields; the adapter returns `HouseAway` for the room's current members and zone.
- [ ] Implement: the fold collects `RequeueRoom` rooms into the batch; `ApplyBatch` requeues in the same transaction. Cache per room for one fold tick only (no global cache).
- [ ] `make check`, `make test-integration`. Commit `feat(analytics): away calendar port, re-learn a house when its trips move`.

### Task 4: Away-aware forecasts

**Files:** `analytics/predict/forecast.go` (`cadence`, `windows`, `Backtest`, `Predict`), `interval.go`, `rhythm.go` (`NextWindow`); `analytics/rollup.go` (`recomputeKey` passes `HouseAway`), `profile.go` (`BuildProfile` takes away spans for run rhythm), `aggregate.go` (`ForecastVersion = 3`); `analytics/eval/eval.go`, `cmd/suggest-eval/main.go` (`--away-from-trips`).

**Interfaces:** `func (p Params) PredictAway(added, checked, ignores []time.Time, away Away) (Forecast, bool)`; `Predict` becomes `PredictAway(…, nil)`. Also `IntervalsAway(times, away)` and `NextWindowAway(…, away)`. Gaps use `HomeBetween`; due dates and window edges use `AddHome`; a window that would open while the house is away opens at the end of the away span. Backtest cycles whose occurrence falls inside an away span are skipped (no trial).

- [ ] Failing tests: `TestPredictNoAwayUnchanged` (golden on existing fixtures with `away=nil`); `TestHolidayDoesNotStretchRhythm` (weekly adds, 14-day trip → median gap 7, CV unchanged); `TestDueShiftsPastTrip`; backtest skips a cycle bought while away; run rhythm with a holiday keeps its 7-day interval.
- [ ] Implement; bump `ForecastVersion` to 3 with a comment naming this change.
- [ ] Eval: `suggest-eval backtest --away-from-trips` on the dev dataset; paste before/after in the commit body. The hit rate must not drop.
- [ ] `make check`. Commit `feat(analytics): forecasts measure home time, not wall time`.

### Task 5: "Needed by" probability

**Files:** create `analytics/predict/needby.go` (+ test); modify `analytics/reader.go` (+ test).

**Interfaces:**
```go
// Probability the next occurrence comes before t: log-normal over the cadence
// (median = EWMADays, spread from CV), in home time. 0 without a forecast.
func NeedBy(f Forecast, t time.Time, away Away) float64
type RunPlan struct{ Next, After NextWindow; Confidence float64 }
func (r *Reader) RunPlan(ctx context.Context, roomID, containerKey string, now time.Time) (*RunPlan, error)
func (r *Reader) NeedsBefore(ctx context.Context, roomID, containerKey string, by time.Time, away predict.Away, limit int) ([]KeyNeed, error)
type KeyNeed struct{ Stat KeyStat; P float64 }
```
- [ ] Failing tests: `NeedBy` at `DueAt` ≈ 0.5; far past due ≥ 0.95; at `LastAt` ~0; CV 0 is a step; thin history (no forecast → 0; not `Confident` → capped at 0.5, so it can never pass an assist bar); `RunPlan.After = Next + IntervalDay` in home time; `NeedsBefore` only returns keys whose `KeyStat.Containers` include the list.
- [ ] Implement (math only in `predict`; the reader does point lookups plus one indexed query, never raw events). `make check`. Commit `feat(analytics): probability a thing is needed before a time`.

### Task 6: Calendar patterns per key

**Files:** `analytics/predict/rhythm.go`, `aggregate.go` (`KeyIntervals`), `rollup.go`.

**Interfaces:**
```go
type Weekly struct {
    EveryWeeks int     `bson:"every_weeks" json:"every_weeks"` // 1 or 2
    Weekday    int     `bson:"weekday" json:"weekday"`         // 0 = Sunday, local
    Hour       int     `bson:"hour" json:"hour"`
    Share      float64 `bson:"share" json:"share"`
}
func DetectWeekly(occ []Occurrence, away Away) (Weekly, bool)
// KeyIntervals gains Weekly *Weekly `bson:"weekly,omitempty" json:"weekly,omitempty"`
```
Rule: ≥ 4 occurrences, ≥ 80% on one local weekday, median home-time gap within ±1 day of 7 or 14. Use `Event.Local.HOW`.
- [ ] Tests: bins every other Tuesday ~20:00 for 10 cycles → `{2, Tue, 20}`; weekly Saturday → `{1, Sat}`; every 9 days → false; 3 occurrences → false; a 2-week trip doesn't break detection. Commit `feat(analytics): detect things that follow the calendar`.

### Task 7: Whose turn

**Files:** `analytics/aggregate.go`, `rollup.go`; create `analytics/predict/turns.go` (+ test).

**Interfaces:** `KeyIntervals` gains `LastBy string` (`last_by,omitempty`) and `Turns []string` (`turns,omitempty`, completers newest first, max 8). `func NextTurn(turns []string, members []string) string`: strict alternation if the last 4 alternate, else the member with the fewest completions in the last 8 (ties: longest since their last); "" when unsure. Only real users count; `system:*` actors are skipped.
- [ ] Tests: A,B,A,B → A after B; A,A,A,B with {A,B} → B; one member → ""; a member who left is never returned; `system:autopilot` ignored. Commit `feat(analytics): remember who did it last and guess whose turn it is`.

### Task 8: Start collecting quantity

**Files:** `services/analytics_events.go` (`item.added` props), `services/list_service.go` (`emitItem` on create), reuse the parser in `internal/parse/`. Test: `services/list_analytics_test.go`.

`item.added` gains optional `qty` (`PropInt`, milli-units, 0–1,000,000) and `unit` (`PropEnum`: the parser's units plus `"count"`). Unparseable quantities are omitted, never sent as text. Nothing reads them yet; this only starts the history.
- [ ] Tests: `"2"` → 2000 count; `"1.5 kg"` → 1500 kg; `"a few"` → no props; the key is unchanged. Commit `feat(analytics): record parsed quantity on adds`.

### Task 9: Docs

Update `docs/features/analytics.md`, `docs/features/suggestions.md` (away-aware, `ForecastVersion` 3), `docs/features/trips.md` (travellers) and `backend/CLAUDE.md` (the "knows no feature" rule names the port). Commit `docs(analytics): anticipation upgrade`.

## Out of scope

- Yearly patterns (birthdays, seasons): `ProfileWindow` is 180 days.
- Chores as a subject type: the registry already generalizes; it ships with the chore feature.
- Consumption-rate forecasting from quantity: it needs the history Task 8 starts collecting.

## Done

All tasks committed; `make check` and `make test-integration` green (read the output for SKIP); the PR is open to `main` with the eval before/after numbers from Task 4 in its description, and Auto-fix is on.
