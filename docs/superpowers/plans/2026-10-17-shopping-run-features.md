# Shopping-run features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship run-mode suggestions, the run-done stamp and usual quantity, and drop suggestion shadow mode.

**Architecture:** The backend learns run shape per list (profile fields), serves a stateless `run-hint` and a widened `during=run` suggestion query. The frontend tracks live check-offs in a pure reducer that uses the hint's thresholds, swaps the slip to run mode, and lands a new `RubberStamp` primitive when a run finishes.

**Tech Stack:** Go 1.26 + chi + MongoDB (memstore fakes for unit tests); React + Vite + TypeScript + React Query + Vitest.

**Spec:** `docs/superpowers/specs/2026-10-17-shopping-run-features-design.md`

## Global Constraints

- `SUGGESTIONS_MODE` is `off | on`, default `on`; legacy `shadow` parses as `on` with a log line.
- Run rule defaults: `checks_to_start` 3, idle gap 45 min (`predict.RunGap`), `burst_sec` 15.
- Likelihood: `expected` → 2 checks, `unknown` → 3, `unlikely` → 4. Own rhythm at ≥ 3 runs, else house.
- `idle_end_min = clamp(4 × run_gap_sec, 15 min, 45 min)`; `burst_sec = clamp(run_gap_sec / 5, 5, 30)`.
- `typical` only with ≥ 5 runs. Run-mode lookahead = list run interval, capped at 14 days; no rhythm → no run suggestions.
- Stamp copy: `Run done · {n} items · {m} min` (drop minutes under 1); flourish `{d} min quicker than usual` only when ≥ 3 min quicker and `typical` present. Never "slower".
- Usual quantity: most common (quantity, unit) pair among the last 10 adds, ties to the most recent; empty pair counts.
- No raw hex/px/weights in app CSS: tokens in `frontend/src/styles.css` `:root`, then `pnpm design:sync`. No Ant Card/Button/Modal.
- Backend gate `make check` before each commit; `make test-integration` for the Mongo task. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A user checks 3 items within 10 s at home (unpacking): no run, no run slip, no stamp. → Task 7 test `burst does not start a run`.
- Unchecking an item mid-run must not count as a check or end the run early. → Task 7 test `uncheck is ignored`.
- The run hint request fails or is slow: the page behaves exactly as with the default rule. → Task 7 test `no hint uses defaults`; Task 8 uses the hint only when loaded.
- A run-mode ignore must not hide that item from normal suggestions when it is actually due. → Task 5 test `TestRunIgnoreDoesNotBlockNormalMode`.
- The list is empty when the run is detected (only checks, nothing left): stamp fires once, not again on Clear done. → Task 9 test `stamp lands once per run`.

---

### Task 1: Drop shadow mode

**Files:**
- Modify: `backend/internal/services/suggestion_service.go` (mode consts, `ParseSuggestionMode`, the two `SuggestionsShadow` branches in `ForList`)
- Modify: `backend/internal/config/config.go:34,67`, `backend/cmd/gracie-server/main.go:113-114`, `.env.example:69-72`
- Modify: `backend/CLAUDE.md` (Smart suggestions → Mode bullet and go-live gate line)
- Test: `backend/internal/services/suggestion_service_test.go`

**Interfaces:**
- Produces: `ParseSuggestionMode(s string) (SuggestionMode, bool)`; the bool is true when a legacy `shadow` was mapped. Modes: `SuggestionsOff`, `SuggestionsOn`.

- [ ] **Step 1: Write failing tests** `TestParseSuggestionMode` table: `"off"→(off,false)`, `"on"→(on,false)`, `""→(on,false)`, `"shadow"→(on,true)`, `" ON "→(on,false)`, `"junk"→(on,false)`. Update existing tests that construct the service with `SuggestionsShadow` to `SuggestionsOn`, and delete tests asserting shadow returns nothing.
- [ ] **Step 2: Run** `cd backend && go test ./internal/services/ -run Suggest` — expect compile failure / FAIL.
- [ ] **Step 3: Implement.** Remove `SuggestionsShadow` and both shadow branches; config default `"on"`; `main.go` logs `suggestions: SUGGESTIONS_MODE=shadow is retired, running as on` when the bool is true. Keep `"shadow"` in `predictedProps["mode"]` enum (old events). `.env.example`: `off | on`, default on, gate = forecast confidence. CLAUDE.md: replace the go-live-gate sentence with "The gate is `Forecast.Confident` (MinScore, MaxCV); `suggest-eval shadow` scores live `item.suggestion_predicted` records."
- [ ] **Step 4: Run** `make check` from repo root — PASS.
- [ ] **Step 5: Commit** `feat(suggestions): drop shadow mode, confidence is the only gate`.

### Task 2: Usual quantity

**Files:**
- Modify: `backend/internal/services/list_service.go` (`pantryByKey`)
- Test: `backend/internal/services/list_service_test.go`

**Interfaces:**
- Produces: `PantryItem.Quantity/Unit` now = usual pair. Signature of `pantryByKey` unchanged.

- [ ] **Step 1: Write failing tests** `TestPantryUsualQuantity` (items newest first, same key):
  - `[2, 2, 6, 2]` (qty, unit "") → `"2"`.
  - `[6, 2, 6, 2]` tie → `"6"` (most recent).
  - `["", "", "2"]` → `""` (no pre-fill).
  - 12 adds: newest 10 are `"1 kg"`, oldest 2 are `"5 kg"` → `"1 kg"`; and 3 × `"1 l"` newest then 9 × `"2 l"` → only last 10 counted: `"2 l"` (7 vs 3).
  - Description/category still from the newest add.
- [ ] **Step 2: Run** `go test ./internal/services/ -run Pantry` — FAIL.
- [ ] **Step 3: Implement** in `pantryByKey`: keep per key up to 10 `qty+"\x00"+unit` pairs in newest-first order; after the loop pick max count, earliest index wins ties.
- [ ] **Step 4: Run** `make check` — PASS.
- [ ] **Step 5: Commit** `feat(pantry): pre-fill the usual quantity, not the last one`.

### Task 3: Learned run shape on profiles

**Files:**
- Modify: `backend/internal/analytics/predict/rhythm.go` (add `RunSpans`), `backend/internal/analytics/profile.go` (`ContainerRhythm`, `BuildProfile`)
- Test: `backend/internal/analytics/predict/rhythm_test.go`, `backend/internal/analytics/profile_test.go`

**Interfaces:**
- Produces:
  - `type RunSpan struct { Start, End time.Time; Count int; Gaps []time.Duration }`
  - `func RunSpans(times []time.Time) []RunSpan` (same grouping as `Runs`; `Runs` becomes a thin wrapper returning starts).
  - `ContainerRhythm` gains `RunMinutes float64 \`bson:"run_minutes,omitempty" json:"run_minutes,omitempty"\``, `RunItems float64 \`bson:"run_items,omitempty" json:"run_items,omitempty"\``, `RunGapSec float64 \`bson:"run_gap_sec,omitempty" json:"run_gap_sec,omitempty"\`` — medians via `predict.Median`.

- [ ] **Step 1: Write failing tests.** `TestRunSpans`: times at 0, 5, 12 min, then 2 h later 0, 1 min → one span `{Count 3, End-Start 12m, Gaps [5m, 7m]}`, second group dropped (2 < RunMin). A span crossing local midnight (23:50, 23:58, 00:06) stays one span. `TestRunsMatchesRunSpans` on random input. `TestBuildProfileRunShape`: three runs of (4 checks, 2-min gaps), (3 checks, 4-min gaps), (5 checks, 3-min gaps) → `RunItems 4`, `RunGapSec` = median of all in-run gaps in seconds (180), `RunMinutes` = median of 6, 8, 12 = 8.
- [ ] **Step 2: Run** `go test ./internal/analytics/...` — FAIL.
- [ ] **Step 3: Implement** as specified; `RunGapSec` is the median over all gaps of all runs.
- [ ] **Step 4: Run** `make check` — PASS.
- [ ] **Step 5: Commit** `feat(analytics): learn run length, size and check gap per container`.

### Task 4: Run hint endpoint

**Files:**
- Create: `backend/internal/services/run_hint.go`, `backend/internal/services/run_hint_test.go`
- Modify: `backend/internal/http/handlers/suggestions.go` (add `RunHint` handler), `backend/internal/http/router/router.go:109-112`
- Test: `backend/internal/http/handlers/suggestions_test.go`

**Interfaces:**
- Consumes: Task 3 `ContainerRhythm` fields; `analytics.Reader.Profile/HouseProfile`.
- Produces:
  ```go
  type RunTypical struct { Minutes int `json:"minutes"`; Items int `json:"items"` }
  type RunHint struct {
      Likely        string      `json:"likely"` // "expected" | "unknown" | "unlikely"
      ChecksToStart int         `json:"checks_to_start"`
      IdleEndMin    int         `json:"idle_end_min"`
      BurstSec      int         `json:"burst_sec"`
      Typical       *RunTypical `json:"typical,omitempty"`
  }
  func DefaultRunHint() RunHint // unknown, 3, 45, 15
  func ComputeRunHint(own, house *analytics.Profile, listID string, now time.Time) RunHint // pure
  func (s *SuggestionService) RunHintFor(ctx context.Context, user *models.User, roomID, listID string) (RunHint, error)
  ```
  Route `GET /rooms/{room_id}/lists/{list_id}/run-hint` → `200 {run_hint: RunHint}`.

- [ ] **Step 1: Write failing tests** `TestComputeRunHint` table (all with a fixed `now`, `loc` from profile TZ):
  - nil/nil → `DefaultRunHint()`.
  - own 2 runs, house 6 runs → uses house.
  - now inside `NextRun` ±1 h, confidence 0.6 → `expected`, 2.
  - outside window, `run_how[now HOW]` = 0.5 × peak (or a neighbour hour ±1 is) → `expected`, 2.
  - ≥ 3 runs, outside window, current hour ±1 < 0.1 × peak → `unlikely`, 4.
  - `RunGapSec` 60 → idle 15 (clamped), burst 12; `RunGapSec` 1200 → idle 45 (clamped), burst 30; 0 → 45/15.
  - 4 runs → `Typical` nil; 5 runs with `RunMinutes 22.4, RunItems 11.6` → `{22, 12}`.
  - `RunHintFor`: non-member → `ErrForbidden`; reader nil or `room.SuggestionsOff` → `DefaultRunHint()`.
  - Handler test: 200 body shape; 401 without user.
- [ ] **Step 2: Run** `go test ./internal/services/ ./internal/http/... -run RunHint` — FAIL.
- [ ] **Step 3: Implement.** Rhythm source key `"list:"+listID`; HOW of now = `weekday*24+hour` in the profile's TZ (UTC fallback). Hour share = max of HOW−1..HOW+1 (wrapping 0–167) ÷ peak.
- [ ] **Step 4: Run** `make check` — PASS.
- [ ] **Step 5: Commit** `feat(suggestions): run hint from learned shopping habits`.

### Task 5: Run-mode suggestions and run-mode ignore

**Files:**
- Modify: `backend/internal/analytics/reader.go` (`Upcoming`), `backend/internal/store/mongo/analytics_agg_repo.go:331` and its interface in `analytics` (repo interface), `backend/internal/testutil/memstore/analytics_read.go:172`
- Modify: `backend/internal/services/suggestion_service.go`, `backend/internal/services/analytics_events.go`, `backend/internal/analytics/rollup.go:209` (dismiss classification), `backend/internal/http/handlers/suggestions.go`
- Test: `backend/internal/services/suggestion_service_test.go`, `backend/internal/analytics/rollup_test.go`, `backend/internal/store/mongo/analytics_read_integration_test.go`, `backend/internal/http/handlers/suggestions_test.go`

**Interfaces:**
- Produces:
  - `UpcomingKeys(ctx, roomID, subjectType string, now, opensBefore time.Time, minScore, maxCV float64, limit int)`: a window qualifies if `opens ≤ opensBefore && closes ≥ now` (first window or any in `windows`). `Reader.Upcoming(ctx, roomID, subjectType, now, opensBefore, limit)`; normal callers pass `opensBefore = now`.
  - `const DuringRun = "run"`; `ForList(ctx, user, roomID, listID string, limit int, during string)`; `Ignore(ctx, user, roomID, listID, key, during string)`.
  - `Suggestion.DueInDays int \`json:"due_in_days"\`` (0 when open now; else ceil days until the first window opens).
  - `item.suggestion_ignored` and `item.suggestion_predicted` gain prop `"during": {Kind: PropEnum, Values: []string{"run"}}`.
  - Event `list.run_stamped` `{Client: true, Props: items PropInt, minutes PropInt}`.
  - Query `?during=run`; ignore body `{key, during?}`; any other `during` value → 400.

- [ ] **Step 1: Write failing tests.**
  - `TestForListRunModeIncludesSoonDue`: forecast window opens in 3 days, list run interval 7 → returned in run mode with `DueInDays 3`, not returned in normal mode.
  - `TestForListRunModeCap`: interval 30 days, window opens in 20 → not returned (cap 14).
  - `TestForListRunModeNeedsRhythm`: no house profile container for the list → empty.
  - Ordering: open-now item before a due-in-2 item before a due-in-5 item; equal due → higher score first.
  - `TestRunIgnoreCountsForPause`: two run-mode ignores → next normal `ForList` paused.
  - `TestRunIgnoreDoesNotBlockNormalMode`: run ignore of "eggs", then clock moves into the open window → normal mode returns eggs; run mode in the same cycle does not.
  - `TestRollupSkipsRunIgnores` (rollup_test): an ignore with `props.during="run"` doesn't enter `wIgnored` (forecast score equals the no-ignore case).
  - Integration `TestMongoUpcomingOpensBefore`: window opening in 2 days found with `opensBefore = now+3d`, not with `now`.
  - Handler: `?during=bogus` → 400; ignore body `during:"x"` → 400.
- [ ] **Step 2: Run** `go test ./internal/... -run 'RunMode|RunIgnore|Rollup'` — FAIL.
- [ ] **Step 3: Implement.** Lookahead from `reader.HouseProfile(roomID).Containers["list:"+listID].IntervalDay` (Runs ≥ `predict.MinOccurrences`), `min(interval, 14d)`. In `currentCycleIsOpen`, a `suggestion_ignored` with `props.during == "run"` blocks only when the request is run mode. `recordPrediction` adds `during` when set.
- [ ] **Step 4: Run** `make check` and `make test-integration` — PASS.
- [ ] **Step 5: Commit** `feat(suggestions): run mode suggests what comes due before the next shop`.

### Task 6: Frontend API

**Files:**
- Modify: `frontend/src/api/endpoints.ts:231-255`, `frontend/src/api/types.ts:76-85`, `frontend/src/testServer.ts` (handlers for the new route)
- Test: covered by Tasks 7–9.

**Interfaces:**
- Produces:
  - `type RunHint = { likely: 'expected'|'unknown'|'unlikely'; checks_to_start: number; idle_end_min: number; burst_sec: number; typical?: { minutes: number; items: number } }`
  - `ListSuggestion.due_in_days?: number`
  - `getRunHint(apiKey, roomId, listId): Promise<RunHint>`
  - `getListSuggestions(apiKey, roomId, listId, during?: 'run')`
  - `ignoreListSuggestion(apiKey, roomId, listId, key, during?: 'run')`

- [ ] **Step 1: Implement** and run `pnpm typecheck` in `frontend/` — PASS. Commit with Task 7.

### Task 7: `useShoppingRun` (pure reducer + hook)

**Files:**
- Create: `frontend/src/lib/shoppingRun.ts`, `frontend/src/__tests__/shoppingRun.test.ts`

**Interfaces:**
- Consumes: `RunHint` (Task 6).
- Produces:
  ```ts
  export const DEFAULT_RUN_HINT: RunHint // unknown, 3, 45, 15 — comment: mirrors predict.RunMin / RunGap
  export type RunState = { checks: number[]; active: boolean; startedAt?: number; runChecks: number; stamped: boolean }
  export type RunEvent = { type: 'check'; at: number } | { type: 'tick'; at: number } | { type: 'stamped' }
  export function runReducer(hint: RunHint): (s: RunState, e: RunEvent) => RunState
  export function useShoppingRun(hint: RunHint | undefined): { active: boolean; runChecks: number; minutes: number; stamped: boolean; check(): void; markStamped(): void }
  ```
  Only checks (not unchecks) are dispatched. The hook ticks every 30 s while active to apply the idle end.

- [ ] **Step 1: Write failing tests** (Vitest, fake `at` values):
  - default hint: 2 checks 1 min apart → inactive; 3rd → active, `startedAt` = first.
  - `checks_to_start: 2` → active on 2nd; `4` → inactive on 3rd, active on 4th.
  - `burst does not start a run`: 3 checks within 10 s, burst 15 → inactive; a 4th 2 min later → active only if the last k checks are not all burst gaps.
  - checks more than `idle_end_min` apart don't chain.
  - `tick` after `idle_end_min` since last check → inactive, `stamped` reset, `runChecks` 0.
  - `uncheck is ignored`: the hook's API has no uncheck, so assert `check()` count only increments on check calls from the page (Task 9 test covers the page wiring).
  - `no hint uses defaults`: `useShoppingRun(undefined)` behaves as default.
  - `minutes` = round((last − startedAt)/60000).
- [ ] **Step 2: Run** `pnpm vitest run src/__tests__/shoppingRun.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `make check` — PASS.
- [ ] **Step 5: Commit** `feat(list): detect shopping runs from live check-offs and learned habits`.

### Task 8: Run-mode slip on the List page

**Files:**
- Modify: `frontend/src/pages/ListPage.tsx` (hint query, `useShoppingRun`, suggestions query key + `during`, ignore `during`, `check()` in `onToggleComplete` when `next === true`), `frontend/src/components/SuggestionSlip.tsx` (prop `during?: 'run'`)
- Test: `frontend/src/__tests__/ListPage.suggestions.test.tsx`

**Interfaces:**
- Consumes: Tasks 6–7.
- Produces: `SuggestionStack`/`SuggestionSlip` accept `during?: 'run'`. Run copy line replaces `cadence()`: `due_in_days ≤ 0` → "Due now"; `1` → "Usually due tomorrow"; else `Usually due in ${n} days`. Ignore label in run mode: "Not this time".

- [ ] **Step 1: Write failing tests:** after 3 checks the page refetches `suggestions?limit=1&during=run` and shows "Usually due in 3 days"; ignoring posts `{key, during:'run'}`; unchecking an item does not advance the run; with the hint returning `checks_to_start: 2` the run starts on the 2nd check; with the hint endpoint 500ing the 3rd check still starts it.
- [ ] **Step 2: Run** `pnpm vitest run src/__tests__/ListPage.suggestions.test.tsx` — FAIL.
- [ ] **Step 3: Implement.** Hint query: key `['run-hint', roomId, listId]`, `staleTime: 600_000`, `retry: false`. Suggestions query key includes `run ? 'run' : 'normal'`.
- [ ] **Step 4: Run** `make check` — PASS.
- [ ] **Step 5: Commit** `feat(list): grab-it-while-you're-there slip during a run`.

### Task 9: RubberStamp primitive and run-done stamp

**Files:**
- Create: `frontend/src/components/ui/RubberStamp.tsx`, `frontend/src/__tests__/ui.rubberStamp.test.tsx`
- Modify: `frontend/src/components/ui/index.ts`, `frontend/src/components/ui/ui.css`, `frontend/src/styles.css` (`:root` tokens, e.g. `--stamp-ink`, `--stamp-rotate`, `--stamp-press-ms`), `frontend/src/pages/ListPage.tsx`, `DESIGN.md`, `docs/design-system/index.html` (via `pnpm design:sync` + a RubberStamp section)
- Test: `frontend/src/__tests__/ListPage.runStamp.test.tsx`

**Interfaces:**
- Consumes: Task 7 `useShoppingRun` (`active`, `runChecks`, `minutes`, `stamped`, `markStamped`), hint `typical`, `track` from `@lib/analytics`.
- Produces: `RubberStamp({ title: string; lines: string[]; onDone: () => void; holdMs?: number /* 2500 */ })`, `role="status"`, tap/click dismisses, honours `prefers-reduced-motion` (no press animation, fade only).
- Pure helper in `shoppingRun.ts`: `stampLines(runChecks: number, minutes: number, typical?: {minutes:number}): string[]` → `["Run done", "14 items · 22 min", "4 min quicker than usual"?]`.

- [ ] **Step 1: Write failing tests:**
  - `stampLines(14, 22)` → `['Run done', '14 items · 22 min']`; `stampLines(5, 0)` → `['Run done', '5 items']`; `stampLines(14, 18, {minutes: 22})` adds `'4 min quicker than usual'`; `stampLines(14, 20, {minutes: 22})` (2 min) and `stampLines(14, 30, {minutes: 22})` add nothing.
  - RubberStamp: renders `role="status"`, calls `onDone` after `holdMs`, click dismisses, reduced motion adds `is-still` class.
  - Page: `stamp lands once per run` — 3 checks clear the list → stamp; Clear done afterwards → no second stamp. Checking the last item outside a run → no stamp. Clear done during a run with items left → stamp. `track('list.run_stamped', {subject:{type:'list',id}, container:{type:'list',id}, props:{items, minutes}})` called once.
- [ ] **Step 2: Run** `pnpm vitest run src/__tests__/ui.rubberStamp.test.tsx src/__tests__/ListPage.runStamp.test.tsx` — FAIL.
- [ ] **Step 3: Implement.** Stamp sits absolutely over the list sheet (`pointer-events: none` except itself), never blocks the add bar. Add tokens to `:root`, then `pnpm design:sync`; add the reference section and a DESIGN.md entry.
- [ ] **Step 4: Run** `make check` — PASS (includes the token/Ant lint tests).
- [ ] **Step 5: Commit** `feat(list): run-done rubber stamp`.

### Task 10: Docs and final gate

**Files:**
- Modify: `backend/CLAUDE.md` (Smart suggestions: run mode, run hint, run-ignore rule; Behavior analytics: new `ContainerRhythm` fields), `frontend/CLAUDE.md` (shopping run hook, RubberStamp primitive)

- [ ] **Step 1: Update docs.**
- [ ] **Step 2: Run** `make check` and `make test-integration` — both PASS.
- [ ] **Step 3: Check** the production Railway service does not pin `SUGGESTIONS_MODE` (read-only `list-variables`); note the result in the PR.
- [ ] **Step 4: Commit** `docs: shopping-run features`.
