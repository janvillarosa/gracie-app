# Autopilot

Bauhouse takes the next in-app step for a house by itself, from what the house already does. Built on
[analytics](analytics.md); today's [smart suggestions](suggestions.md) are its Suggest mode.

Plan: `docs/superpowers/plans/2026-10-17-autopilot-engine.md` (v4, with diagrams). Benchmark:
`docs/superpowers/qa/autopilot-benchmark-2026-10-17.md`.

## Modes (a house setting)

| Mode | What it does |
|---|---|
| `off` | Nothing is proposed or done. |
| `suggest` | **The default.** Proposes only: a slip someone taps to accept. Nothing changes until a person acts. Exactly today's smart suggestions. |
| `assist` | Puts things on lists by itself, before the shop: in-app and reversible, each marked, with a reason and Undo. What it is less sure about stays a suggestion. It never acts outside Bauhouse. |

Full autopilot (buying, booking, messaging for the house) is **not a mode**: it needs a new mode and the
house's explicit consent. `autopilot.Effect` has only in-app values and the executor refuses anything else
(`ErrExternalEffect`).

- `Room.AutopilotMode` (`autopilot_mode`, absent = suggest). Any member changes it in House settings
  (`PUT /rooms/settings {autopilot_mode}`, 400 on unknown; emits `house.settings_updated`). There is no
  server ceiling. A house that set the older `suggestions_off` reads as off (read-time mapping, no
  migration); writing a mode clears it. `GET /rooms/me` returns `autopilot_mode` and, for one release, a
  derived `suggestions_off`; `PUT {suggestions_off}` still works (true sets off; false turns an off house
  back to suggest and never downgrades assist).
- `SUGGESTIONS_MODE=off` is the operator kill switch: the service then plans nothing for any house.

## Backend

_Backend paths are relative to `backend/`; packages live under `backend/internal/`._

- **`internal/autopilot` (pure):** `Mode`/`HouseMode`; `Proposal` (`Kind` restock; hold_back,
  welcome_home and overdue declared only), `Effect`, `Disposition`; `Policy` and `Decide`; the `Signals`
  port, `Gather`, the filters (`Rank`, `CycleOpen`, `Paused`, `RunLookahead`) and `Plan`. It imports only
  `analytics/predict` and `parse`; analytics never imports it. `autopilottest.Signals` is the test fake.
- **One service, one pipeline:** `services.AutopilotService` serves suggestions, ignores, the run hint, the
  read view, Undo, the executor, the outcome hooks and the ticker. Three callers run the same Gather → Plan →
  Decide and differ only in **horizon**: the slip (`now`), run mode (`next_run`, today's lookahead), assist
  (`run_after_next`). `services/autopilot_signals.go` implements `Signals` over `Reader.Upcoming` (now and
  run mode, unchanged), `Reader.NeedsBefore` (assist; its odds are `predict.NeedBy`), `Reader.RunPlan`,
  `services.AwayCalendar` (a house is away only when every member is), the raw events and the live list.
- **Two independent bars** (`autopilot.DefaultPolicy`, set by the eval): a **suggestion** is judged by its add
  forecast, `Forecast.Confident` (score ≥ 0.65, CV ≤ 0.5). **Assist** is judged by the thing's **run fit**
  (`FitRun`, applied by `Assess` on the assist horizon from its own check-offs): run score ≥ 0.50 (a Wilson
  lower bound over the last 12 cycles that landed in the run their rhythm pointed to, ± half a run interval)
  **and** need ≥ 0.60 (the chance it runs out by this run, given it was not bought since; 1 when it is
  overdue by less than two rhythms). Assist asks "will it be bought in this run?", not "when will someone
  add it?". What assist does not apply but clears the suggest bar stays a suggestion. Look-alike spellings
  are each judged, then the most needed is kept (`BestOfLookAlikes`).
- **Ticker** (`TickOnce`, every `AUTOPILOT_TICK_EVERY`, default 15m): takes the `autopilot_state` lease, visits
  houses that stored `assist` (re-reading the mode per house), and for each live list whose next run starts
  within `AUTOPILOT_LEAD` (default 18h), has not started, and is not while the house is away, plans and
  applies what `Decide` says to (at most `MaxPerRun`, 8). Applied items still unchecked 30h after their run
  started expire (or confirm, if they were bought without the hook).
- **Executor** (`Apply`): writes the action row first (unique `(room_id, kind, key, cycle)`, `cycle` = the
  forecast's `LastAt` date, so a retry or another instance is a no-op), then creates the item with
  `ListService.CreateSystemItem` as `system:autopilot`, `ListItem.Source = "autopilot"`. A failed create
  deletes the row so a later tick can retry.
- **Outcomes** (`ListService.UseItemHooks`): checking an autopilot item confirms its action; deleting one
  still unchecked marks it removed; `POST .../autopilot/{action_id}/undo` marks it undone and removes the
  item (no hook re-entry). Removed and undone emit `item.autopilot_removed {via: delete|undo}` (a dismiss
  that counts against the forecast); the action row then blocks a re-add in that cycle, and the event closes
  the cycle for the slip too. Deleting a confirmed (bought) item is tidying, not a miss.
- **Routes:** `GET /rooms/{room_id}/lists/{list_id}/autopilot` → `{mode, applied: [{action_id, item_id, key,
  state, run_at, reason, confidence}], suggestions}` (applied or confirmed in the last 7 days; never applies).
  `POST .../autopilot/{action_id}/undo` → 204 (409 once bought; undoing twice is a no-op).
  **Deprecated, same paths and answers:** `GET .../suggestions`, `POST .../suggestions/ignore`,
  `GET .../run-hint` send `Deprecation: true` and `Link: <.../autopilot>; rel="successor-version"`; they go
  once the List page reads `GET .../autopilot` for suggestions and the run hint.
- **Store:** `autopilot_actions` (see `internal/store/CLAUDE.md`), deleted with the house (room deletion,
  account deletion, and the solo house a joiner dissolves).

## Invariants

- **Autopilot adds are never requests.** `item.autopilot_added` is `Skip: true` with `RoleAutomated`; a key
  with an automated add in its recent cycles forecasts from completions (`ForecastVersion` 4). Its actor is
  `system:autopilot`, so it is never a profile, a turn or "who did it last". Checking an autopilot item off
  is a normal `item.checked`.
- **Suggestions stay stateless; only applied actions are stored**, because "did we already add this?" must
  be exact and the recorder may drop events.
- **Suggest mode is today's suggestions** (the ported suggestion suite and `TestSuggestionsParityAcrossModes`).
- **Never external** (`TestExecutorRefusesExternalEffects`).

## Eval gate

`go run ./cmd/suggest-eval autopilot -synthetic -away-from-trips` replays the golden households (and, without
`-synthetic`, a database) at every past run minus the lead, through the same forecasts, `NeedBy` and planner.
**Ship bar:** precision ≥ 85%, removals ≤ 1 per house-week and **F1 ≥ 70%** (precision × open recall, harmonic
mean; `replay.F1Goal`). Pinned by `TestGoldenAssistMeetsGate`, `TestGoldenAssistF1Floor` (floor 0.77, raised
as changes lift it, never lowered) and `TestHoldOutSeedsMeetGoal` (five households seeds the bar was not tuned
on). 2026-10-17: 97.8% precision, 64.4% open recall, **F1 77.7%**, 0.01 removals per house-week; hold-out F1
76.7–78.9%. See `docs/superpowers/qa/autopilot-benchmark-2026-10-17.md`.

## Frontend

_Frontend paths are relative to `frontend/src/`._

- **House settings** (`RoomSettings`): "Autopilot" as a `StepSlider` (Off · Suggest · Assist, low to high; glyphs
  moon, lightbulb and the service bell, autopilot's one mark), saved on choice with a rollback, and one line under the chosen mode
  (`AUTOPILOT_HELP`) that fades in as the key lands. `autopilotModeOf` reads older
  servers' `suggestions_off`.
- **List page:** on assist only, it reads `GET .../autopilot` (`['autopilot', roomId, listId]`). Rows with
  `source: 'autopilot'` carry the autopilot stamp (`ItemRow`, an icon-only, ink-outlined state stamp holding the
  service bell, beside the category stamp); tapping it says why
  (`reasonText`: "You buy it about every 9 days"). Once per planned run `AutopilotSlip` reads "Added 3 for
  Saturday" (`addedLine`) with Undo all (one undo per action) and Got it; it folds away on Got it or a successful Undo all, and the
  undone rows leave only after it has; the run it was closed for is kept
  in `localStorage` `gracie_autopilot_seen_<listId>`. Suggest mode keeps today's suggestion slip unchanged.
- The mock (`VITE_MOCK_TRIPS=1`) starts on assist with three autopilot items; `?autopilot=suggest|off`.
