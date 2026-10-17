# Autopilot Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Bauhouse take the next in-app step for a house by itself (put the usual things on a list before the shop), with three house modes: `off`, `suggest` (today's suggestions, the default) and `assist` (reversible in-app actions, each with a reason and Undo). Full autopilot (buying, booking, messaging) is not a mode.

**Architecture:** A new pure package `internal/autopilot` holds the mode rules, the planner (`Plan(snapshot, policy) []Proposal`) and the policy (`Decide(mode, proposal, policy) Disposition`). It reads the world through a narrow `Signals` port that services implement (a temporary adapter over today's `analytics.Reader` now, the anticipation API from `claude/analytics-anticipation` in Task 10). `services/autopilot_service.go` does the I/O: it gathers a snapshot, applies `Apply` proposals through `ListService` with an exact, durable action log (`autopilot_actions`, unique per house × kind × key × cycle), records outcomes from list hooks, and runs on a lease-based ticker. Suggest-mode proposals stay stateless, derived from events and aggregates as today. Analytics stays feature-agnostic: autopilot adds are a new generic `RoleAutomated` event role that never counts as a request.

**Tech Stack:** Go 1.26 + chi + MongoDB (memstore fakes for unit tests); React + Vite + TypeScript + React Query + Vitest + MSW.

**Spec:** this plan (the brief from Jan, 2026-10-17). Sibling: `docs/superpowers/plans/2026-10-17-analytics-anticipation.md` on `claude/analytics-anticipation`.

## Global Constraints

- **Modes:** `off | suggest | assist`. Effective mode = the lower of the house setting `Room.AutopilotMode` (absent = `suggest`; legacy `Room.SuggestionsOff = true` reads as `off`) and the server ceiling `AUTOPILOT_MODE` (default `assist`; `SUGGESTIONS_MODE=off` forces the ceiling to `off`). No data migration: read-time mapping; writing a mode clears `suggestions_off`. API responses keep `suggestions_off` for one release, derived from the house mode.
- **Never external:** `autopilot.Effect` has only in-app values (`EffectAddToList`). The executor refuses anything else. External effects need a new mode and explicit consent (comment at the type and the executor).
- **Autopilot adds are never human requests.** `item.autopilot_added`: `Skip: true`, `Role: RoleAutomated`, actor `system:autopilot`. `recomputeKey` forecasts a key from checks (`predict.SeriesChecked`) when an automated add falls in its recent cycles. Removing an autopilot item emits `item.autopilot_removed` (`RoleDismiss`, a real miss). Checking it off is a normal `item.checked`.
- **Stateless suggestions, durable actions:** suggest-mode proposals are derived from events and aggregates only. Only applied (assist) actions are stored, because the recorder may drop events and "did we already add this?" must be exact.
- **Bars by intrusiveness** (`autopilot.Policy`, tuned by Task 9's eval, not by feel): suggest = `Forecast.Confident` (MinScore 0.65, MaxCV 0.5); assist = score ≥ 0.80 **and** need-before-the-run-after-next ≥ 0.70. Between the bars, assist falls back to a suggestion.
- `ForecastVersion` → **4** (the analytics branch takes 3).
- `internal/autopilot` imports `analytics/predict` and `parse` (pure); it never imports `store`, `services` or Mongo. `internal/analytics` never imports `autopilot`.
- UI: tokens and primitives only (`Paper`, `Button`, `Sheet`, slips). A new mark goes into the system first (token block, `pnpm design:sync`, reference page, DESIGN.md). Voice: plain, warm, short ("Added 4 for Saturday").
- `make check` before each commit; `make test-integration` for Mongo tasks (1, 4). Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Autopilot adds never count as requests; a house on assist for 10 cycles keeps a stable rhythm. → `TestAutomatedAddsKeepRhythm` (analytics), `TestAssistTenCyclesStableRhythm` (services).
- `off` produces nothing, `suggest` never writes, `assist` writes only in-app and only above the assist bar; between the bars it falls back to a suggestion. → `TestDecideModesByBand`, `TestTickWritesOnlyInAssist`, `TestExecutorRefusesExternalEffects`.
- Two instances ticking at once add an item once. → `TestConcurrentTicksAddOnce` (service), `TestAutopilotActionUniqueKey` (Mongo).
- Undo and swipe-delete both mark the action removed and feed a dismiss; the item does not come back in the same cycle. → `TestUndoMarksUndoneAndDismisses`, `TestDeleteAutopilotItemMarksRemoved`, `TestRemovedNotReaddedSameCycle`.
- An item already on the list (or a look-alike, `parse.Similarity`) is never added again. → `TestPlanSkipsOnListAndLookAlikes`.
- A house away gets no assist adds for the away period. → `TestPlanAwayNoAdds` (fake away calendar until Task 10).
- Suggest mode behaves exactly like today's suggestions. → `TestForListParityAcrossModes`.

---

### Task 1: Modes

**Files:**
- Create: `backend/internal/autopilot/mode.go`, `mode_test.go`
- Modify: `backend/internal/models/room.go`, `backend/internal/store/repo.go` (`RoomRepository.SetAutopilotMode`, `ListIDsByAutopilotMode`), `backend/internal/store/mongo/room_repo.go` (+ index), `backend/internal/testutil/memstore/memstore.go`, `backend/internal/services/room_service.go`, `backend/internal/http/handlers/room.go`, `backend/internal/config/config.go`, `backend/cmd/gracie-server/main.go`, `.env.example`
- Test: `autopilot/mode_test.go`, `handlers/room` tests, `store/mongo/mongo_integration_test.go`

**Interfaces:**
```go
type Mode string // ModeOff, ModeSuggest, ModeAssist
func ParseMode(s string) (Mode, bool)
func Effective(house, ceiling Mode) Mode
func HouseMode(stored string, legacyOff bool) Mode
func Ceiling(autopilotEnv, suggestionsEnv string) Mode
// models.Room: AutopilotMode string `bson:"autopilot_mode,omitempty" json:"-"`
// RoomRepository: SetAutopilotMode(ctx, roomID, userID, mode string, at time.Time) error  (clears suggestions_off)
//                 ListIDsByAutopilotMode(ctx, mode string, limit int) ([]string, error)
```
- [ ] Failing tests: `ParseMode` table (case/space tolerant; unknown → false); `Effective` all 9 pairs; `HouseMode("", true)` = off, `("", false)` = suggest, `("assist", true)` = assist; `Ceiling("", "off")` = off, `("", "on")` = assist, `("suggest", "on")` = suggest. Handler: `PUT /rooms/settings {autopilot_mode:"bogus"}` → 400; `{autopilot_mode:"assist"}` → 204, then `GET /rooms/me` → `autopilot_mode:"assist", suggestions_off:false`; `{suggestions_off:true}` still works and reads back `autopilot_mode:"off"`. Mongo: setting a mode unsets `suggestions_off`; `ListIDsByAutopilotMode("assist")`.
- [ ] Implement; `house.settings_updated` lists `autopilot_mode`. Config `AUTOPILOT_MODE` (default `assist`).
- [ ] `make check`, `make test-integration`. Commit `feat(rooms): autopilot mode setting with a server ceiling`.

### Task 2: Gate today's suggestions through the mode

**Files:** `services/suggestion_service.go`, `services/run_hint.go`, `cmd/gracie-server/main.go`; tests in `services/suggestion_service_test.go`.

**Interfaces:** `NewSuggestionService(..., mode SuggestionMode)` keeps its signature; `UseAutopilotCeiling(autopilot.Mode)`; `effectiveMode(room) autopilot.Mode`.
- [ ] Failing tests: `TestForListParityAcrossModes` (the same fixture returns identical suggestions for absent mode, `suggest`, `assist`; nothing for `off`, legacy `suggestions_off`, or ceiling `off`); run hint falls back to the default under `off`.
- [ ] Replace `room.SuggestionsOff` checks with `effectiveMode(room) == ModeOff`.
- [ ] `make check`. Commit `feat(suggestions): gate suggestions and the run hint by autopilot mode`.

### Task 3: Planner core (pure)

**Files:** create `autopilot/proposal.go`, `policy.go`, `plan.go`, `signals.go`, `need.go` (+ tests), `autopilot/autopilottest/fake.go`.

**Interfaces:**
```go
type Kind string    // KindRestock; KindHoldBack, KindWelcomeHome, KindOverdue declared, unimplemented
type Effect string  // EffectAddToList only (in-app)
type Disposition int // Drop, Suggest, Apply
type Reason struct{ Code string; Params map[string]any }
type Proposal struct{ Kind; ListID, Key, Display, Quantity, Unit string; Confidence, Need float64; Reason; Cycle string; RunAt time.Time; Effect }
type Policy struct{ SuggestMinScore, SuggestMaxCV, AssistMinScore, AssistMinNeed, MinRunConfidence float64; MaxPerRun int }
var DefaultPolicy = Policy{0.65, 0.5, 0.80, 0.70, 0.5, 8}
type Window struct{ Start, End time.Time }
type RunPlan struct{ Next, After Window; Confidence float64 }
type Need struct{ Key, Category string; Score, CV, NeedBy, EveryDays float64; LastAt time.Time }
type Usual struct{ Display, Quantity, Unit string }
type Signals interface {
    RunPlan(ctx, roomID, listID string, now time.Time) (*RunPlan, error)
    Away(ctx, roomID string) ([]Window, error)
    NeedsBefore(ctx, roomID, listID string, by time.Time, away []Window, limit int) ([]Need, error)
    OnList(ctx, listID string) ([]string, error)
    Usual(ctx, roomID string, keys []string) (map[string]Usual, error)
}
type Snapshot struct{ ListID string; Now time.Time; Run *RunPlan; Away []Window; Needs []Need; OnList []string; Usual map[string]Usual }
func Gather(ctx, s Signals, roomID, listID string, now time.Time, p Policy) (Snapshot, error)
func Plan(s Snapshot, p Policy) []Proposal
func Decide(m Mode, pr Proposal, p Policy) Disposition
func ApproxNeedBy(lastAt, dueAt time.Time, everyDays, cv float64, confident bool, by time.Time) float64 // until predict.NeedBy lands
```
Restock rule: no run plan (or below `MinRunConfidence`) → nothing; the next run starts inside an away span → nothing; per need: below the suggest bar → skip; on the list or a look-alike of it (`parse.Similar`) → skip; a look-alike of a key already proposed → skip; quantity = usual; `Cycle` = `LastAt` UTC date; reason `every_days {days}`; most confident first, capped at `MaxPerRun`.
- [ ] Failing table tests: `TestDecideModesByBand` (off/suggest/assist × below-suggest / between / above-assist / high score but low need); `TestPlanSkipsOnListAndLookAlikes`; `TestPlanAwayNoAdds`; `TestPlanCycleIsLastAtDate`; `TestPlanNoRunNoProposals`; `TestApproxNeedBy` (≈0.5 at due, ≥0.95 far past, ~0 at last, step at CV 0, ≤0.5 when not confident).
- [ ] `make check`. Commit `feat(autopilot): pure planner, policy and signals port`.

### Task 4: Action log store (Mongo)

**Files:** create `models/autopilot_action.go`, `store/mongo/autopilot_repo.go`, `testutil/memstore/autopilot.go`, integration test in `store/mongo/autopilot_integration_test.go`; modify `store/repo.go`, `services/room_service.go`, `services/user_service.go` (delete with the house).

**Interfaces:**
```go
type AutopilotAction struct{ ActionID, RoomID, ListID, Kind, Key, Cycle, ItemID, State string; Confidence float64; Reason AutopilotReason; RunAt, CreatedAt time.Time; ResolvedAt, PurgeAt *time.Time }
type AutopilotActionRepository interface {
    Insert(ctx, a *models.AutopilotAction) error // derr.ErrConflict on (room_id, kind, key, cycle)
    SetItem(ctx, actionID, itemID string) error
    Delete(ctx, actionID string) error
    GetByID(ctx, actionID string) (*models.AutopilotAction, error)
    GetByItem(ctx, itemID string) (*models.AutopilotAction, error)
    ListByList(ctx, listID string, since time.Time) ([]models.AutopilotAction, error)
    ListOpen(ctx, roomID string) ([]models.AutopilotAction, error) // state applied
    Resolve(ctx, actionID string, from []string, to string, at time.Time) (bool, error) // conditional; sets purge_at = at + 180d
    DeleteByRoom(ctx, roomID string) error
    AcquireLease(ctx, owner string, ttl time.Duration, now time.Time) (bool, error) // autopilot_state {_id:"tick"}
}
```
- [ ] Failing integration tests: unique key (second insert → `ErrConflict`); conditional resolve (applied→confirmed true; confirmed→removed false); TTL index exists on `purge_at`; `DeleteByRoom`; lease exclusive between two owners. Memstore mirrors every rule (shared contract test in `services`).
- [ ] `make check`, `make test-integration`. Commit `feat(autopilot): durable action log with a unique action key`.

### Task 5: Executor and outcomes

**Files:** create `services/autopilot_service.go` (+ test); modify `models/list_item.go` (`Source string json:"source,omitempty"`), `services/list_service.go` (system create + hooks), `services/analytics_events.go`, `analytics/registry.go` (`RoleAutomated`), `analytics/rollup.go`, `analytics/predict/forecast.go` (`PredictChecked`), `analytics/aggregate.go` (`ForecastVersion = 4`).

**Interfaces:**
```go
func (s *AutopilotService) Apply(ctx, roomID string, p autopilot.Proposal) (*models.AutopilotAction, error) // insert first; duplicate → nil, nil
func (s *ListService) CreateSystemItem(ctx, actorID, source, roomID, listID, desc, qty, unit string) (*models.ListItem, error)
type ItemHooks interface{ ItemChecked(ctx, it *models.ListItem); ItemDeleted(ctx, it *models.ListItem) }
func (s *ListService) UseItemHooks(h ItemHooks)
```
- [ ] Failing tests: `TestExecutorRefusesExternalEffects`; `TestApplyInsertsThenCreatesItem` (source `autopilot`, actor `system:autopilot`, `item.autopilot_added` only, no `item.added`); `TestApplyDuplicateIsNoop`; check → confirmed; `TestDeleteAutopilotItemMarksRemoved` (+ `item.autopilot_removed`); `TestRemovedNotReaddedSameCycle`; `TestAutomatedAddsKeepRhythm` (rollup: weekly checks, adds replaced by automated adds → series checked, confident) and `TestAssistTenCyclesStableRhythm`.
- [ ] `make check`. Commits `feat(analytics): automated role, forecast from checks for automated keys` and `feat(autopilot): executor and outcome hooks`.

### Task 6: When it runs

**Files:** `services/autopilot_service.go` (ticker, read view, undo), `http/handlers/autopilot.go` (+ test), `http/router/router.go`, `config/config.go` (`AUTOPILOT_TICK_EVERY` 15m, `AUTOPILOT_LEAD` 18h), `cmd/gracie-server/main.go`, `.env.example`.

**Interfaces:**
```go
func (s *AutopilotService) TickOnce(ctx context.Context) (applied int, err error)
func (s *AutopilotService) RunTicker(ctx context.Context, every, jitter time.Duration)
func (s *AutopilotService) View(ctx, user, roomID, listID string) (*AutopilotView, error) // never applies
func (s *AutopilotService) Undo(ctx, user, roomID, listID, actionID string) error
// GET  /rooms/{room_id}/lists/{list_id}/autopilot → {mode, applied: [...], suggestions: [...]}
// POST /rooms/{room_id}/lists/{list_id}/autopilot/{action_id}/undo → 204
```
Tick: lease (`autopilot_state`), ceiling below assist → nothing; houses with stored `assist` whose effective mode is assist; per live list: run plan confident and the next run opens within the lead → plan, `Decide`, apply; expire applied actions whose run ended more than a day ago and whose item is still unchecked.
- [ ] Failing tests: `TestTickWritesOnlyInAssist`; `TestTickOutsideLeadDoesNothing`; `TestConcurrentTicksAddOnce` (two services, one store, parallel ticks); `TestTickExpiresStaleActions`; `TestViewNeverApplies`; `TestUndoMarksUndoneAndDismisses`; handler auth (403 other house, 404 unknown action).
- [ ] `make check`. Commit `feat(autopilot): lease-based ticker, read view and undo`.

### Task 7: Frontend settings

**Files:** `frontend/src/pages/RoomSettings.tsx` (+ test), `api/types.ts`, `api/endpoints.ts`; a `Segmented` primitive in `components/ui/` if none exists (reference page + DESIGN.md + `/dev/ui`).
- [ ] Failing test: the three options render as a radio group; picking Assist PUTs `{autopilot_mode:"assist"}` and shows "Adds things to your lists before you shop. You can always undo. It never buys or books anything."
- [ ] `make check`. Commit `feat(settings): three-way autopilot control`.

### Task 8: Frontend list

**Files:** `components/ItemRow.tsx`, `pages/ListPage.tsx`, a new `AutopilotSlip`, `styles.css` token(s) for the autopilot mark, `docs/design-system/index.html`, `DESIGN.md`, the MSW mock (autopilot items + endpoint).
- [ ] Failing tests: an item with `source:"autopilot"` shows the mark; tapping it shows the reason ("You buy it about every 9 days"); the slip reads "Added 4 for Saturday" once per run and Undo all posts one undo per action and removes the rows; suggest mode keeps today's slip.
- [ ] Check it in `VITE_MOCK_TRIPS=1 pnpm dev`. `make check`. Commit `feat(lists): autopilot mark, reason and the added-for slip`.

### Task 9: Eval

**Files:** create `autopilot/replay.go` (+ test); modify `cmd/suggest-eval/main.go` (`autopilot` subcommand).

**Interfaces:** `func Replay(events []analytics.Event, p Policy, lead time.Duration) ReplayReport` with `Precision()`, `Recall()`, `RemovalsPerWeek()`.
- [ ] Failing test on a synthetic weekly house (precision 1, recall 1, 0 removals) and a noisy one.
- [ ] Run on the dev dataset; set the assist bar from the numbers. Gate: assist is the ceiling default only if precision ≥ 0.85 and removals ≤ 1/week; otherwise lower the `AUTOPILOT_MODE` default to `suggest` and say so in the PR.
- [ ] `make check`. Commit `feat(autopilot): suggest-eval autopilot replay`.

### Task 10: Wire the real analytics (follow-up PR, after `claude/analytics-anticipation` merges)

Rebase onto `main`; implement `Signals` with `Reader.RunPlan`, `Reader.NeedsBefore`, `predict.NeedBy` and the `AwayCalendar`; delete the temporary adapter and `ApproxNeedBy`; keep the test fakes. Commit `feat(autopilot): read anticipation signals from analytics`.

### Task 11: Docs

`docs/features/autopilot.md` (modes table, invariants, eval gate) + a row in `docs/features/README.md`; update `suggestions.md`, `lists.md`, `backend/CLAUDE.md` (the stateless-suggestions invariant now names the action log). Commit `docs(autopilot): feature note and invariants`.

## Out of scope

Holding perishables back before a trip, the welcome-home shop, overdue chores (kinds declared only), push notifications, and any external effect.
