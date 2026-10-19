# Autopilot

Bauhouse takes the next in-app step for a house by itself, from what the house already does. Built on
[analytics](analytics.md); today's [smart suggestions](suggestions.md) are its Suggest mode.

Plan: `docs/superpowers/plans/2026-10-17-autopilot-engine.md` (v4, with diagrams). Benchmark:
`docs/superpowers/qa/autopilot-benchmark-2026-10-17.md`. Up next: spec
`docs/superpowers/specs/2026-10-19-up-next-design.md`, plan `docs/superpowers/plans/2026-10-19-up-next.md`,
benchmark `docs/superpowers/qa/up-next-benchmark-2026-10-19.md`.

## Modes (a house setting)

| Mode | What it does |
|---|---|
| `off` | Nothing is proposed or done. |
| `suggest` | **The default.** Proposes only: a slip someone taps to accept. Nothing changes until a person acts. Exactly today's smart suggestions. |
| `assist` | Puts things on lists by itself, before the shop: in-app and reversible, each marked, with a reason and Undo. **It never suggests:** if something is good enough to suggest, assist adds it. It never acts outside Bauhouse. |

## Which mode has which feature: one table

`autopilot.Tiers` (`internal/autopilot/features.go`) maps each **feature** to the modes that have it. The modes
are exclusive, not a ladder (assist has no suggestion slip), so it is feature → modes, not a minimum tier. Every
gate asks `autopilot.Has(mode, feature)`; none compares a mode. The server sends the House's resolved list
(`autopilot_features` on the room payloads, `features` on `GET .../autopilot`) and the frontend asks
`hasFeature(room, 'up_next')` (`lib/autopilotFeatures.ts`; a copy of the table keyed by mode is its fallback for
an older server, to go after one release). Moving a feature between tiers is a one-line change.

| Feature | Off | Suggest | Assist |
|---|---|---|---|
| `suggestions` (the suggestion slip) | | ✓ | |
| `auto_add` (assist adds, marks, Undo, the "Added 3" slip) | | | ✓ |
| `run_hint` (learned run detection) | | ✓ | ✓ |
| `up_next` (the usual route through the shop) | | ✓ | ✓ |

**The modes do not mix.** A house is in exactly one, and only Suggest shows suggestions: on assist the
suggestions endpoint answers with nothing and the List page shows only the autopilot slip.

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
- **Two bars** (`autopilot.DefaultPolicy`, set by the eval). The **suggest bar** is the add forecast,
  `Forecast.Confident` (score ≥ 0.65, CV ≤ 0.5). The **run-fit bar** is the thing's **run fit**
  (`FitRun`, applied by `Assess` on the assist horizon from its own check-offs): run score ≥ 0.50 (a Wilson
  lower bound over the last 12 cycles that landed in the run their rhythm pointed to, ± half a run interval)
  **and** need ≥ 0.60 (the chance it runs out by this run, given it was not bought since; 1 when it is
  overdue by less than two rhythms). Assist asks "will it be bought in this run?", not "when will someone
  add it?". Suggest mode uses only the suggest bar. **Assist adds what either bar picks** (`AssistOpen`):
  first what Suggest would show in run mode now (a confident forecast whose window opens within a run
  interval; `Basis` forecast), then anything else whose run fit clears the run-fit bar (`Basis` run), one name
  per look-alike cluster. `Decide` in assist checks each proposal against the bar of its `Basis` and never
  returns Suggest.
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

## Up next (the usual route through the shop)

On a list the House shops, **Up next** names the item it usually grabs next, learned from the order past runs were
checked off. It is autopilot's guess (the service bell, "Usually next · then Bread") and never adds, removes or
reorders anything. On Suggest and Assist.

- **Route** (`analytics/predict/route.go`, pure): per run (`predict.RunSpans`) the distinct keys in check order
  (look-alikes merged in `analytics.RunOrders`); a run counts with ≥ 4 keys. A key's **spot** is its position
  0..1, a recency-weighted mean over the last 12 runs (half-life 4); seen in ≥ 2 runs to get one. The route is
  stored on the **house** profile only (`ContainerRhythm.Route`, `{runs, score, spots}`). Its **score** is a
  backtest: learn from the runs before each run, and a pick is a hit when the named key is checked within the
  next 2 check-offs (Wilson lower bound). `Policy.RouteClears`: ≥ 5 runs and score ≥ 0.60
  (`UpNextMinRuns`, `UpNextMinScore`, set by `suggest-eval upnext`). A house without a consistent walk (two
  stores, no habit, only top-ups) gets nothing.
- **Pick rule** (`autopilot.PickUpNext`; TS twin `lib/upNext.ts`, which returns `{next, after}`): the unchecked item
  with the smallest spot at or after the anchor (the last checked item with a spot; none = the start), doubling
  back when nothing is ahead; the next strictly later spot is the "then". Both run
  `internal/autopilot/testdata/upnext_cases.json`.
- **View** (`GET .../autopilot`): `up_next {ready, run?, route[]}` and `stack`. The server owns "the current run"
  (every member's `item.checked` within `RunGap`, so a reload or second phone has the same anchor; last week's
  uncleared checks never count). `ready` = a run in progress, or the House's usual run window is open with
  confidence ≥ `MinRunConfidence`; a run in progress keeps it true after the profile moves on.
- **Frontend** (`useUpNext`, `UpNextSlip`): shows as soon as `ready`, else after the first check-off of the visit;
  stays for the visit while something is left to name. Tick checks the item off and the slip hands off in place;
  the round ✕ puts it away for this run (`localStorage` `gracie_up_next_hidden_<listId>`, keyed to the run, 12 h
  at most), never a forecast signal. Events: `nudge.shown|tapped|dismissed|followed {kind: 'up_next'}`
  (`followed` also has `hit`: the next check-off was the pick or the one after).
- **Freshness:** the page reads the view on load and after an Undo; there is no refetch on focus, so an item
  added mid-shop is not named until the next load, and the server's `ready` is only read then (the client latches
  it for the visit). The route learns from **finished** runs only (a run still going when the profile recomputes is
  left out), and a ✕ made before the run carries into it if the run begins within about two hours of the hide.
- **Eval gate:** `go run ./cmd/suggest-eval upnext -synthetic` replays the route personas; ship bar hit rate ≥ 70%
  where it speaks and silent on two stores, random and top-ups (`replay/upnext_test.go`). **Before deploy**, run
  `suggest-eval upnext` on real data and record it in the QA note; below the bar it stays silent by design.

## One autopilot slip at a time

Autopilot floats **one** slip to the person; the rest wait behind it on the Z axis (`SlipStack`: the front in full,
up to two slip edges peeking, display-only), never a second slip down the page. The server orders them
(`autopilot.SlipOrder`: `up_next`, `auto_add`, `suggestions`) and sends the ones this list has something for as
`stack`; a slip the server did not order goes to the back. Closing the front slip brings the next one forward.
The List page keeps its own suggestions query (add/ignore flows) and reads the view for the route, the applied
adds and the order.

## Invariants

- **Autopilot adds are never requests.** `item.autopilot_added` is `Skip: true` with `RoleAutomated`; a key
  with an automated add in its recent cycles forecasts from completions (`ForecastVersion` 4). Its actor is
  `system:autopilot`, so it is never a profile, a turn or "who did it last". Checking an autopilot item off
  is a normal `item.checked`.
- **Suggestions stay stateless; only applied actions are stored**, because "did we already add this?" must
  be exact and the recorder may drop events.
- **Suggest mode is today's suggestions** (the ported suggestion suite), and **only suggest mode suggests**
  (`TestSuggestionsOnlyInSuggestMode`, `TestDecideModesDoNotMix`). If it is good enough to suggest, assist adds
  it (`TestAssistAddsWhatWouldBeSuggested`, `TestAssistPicksByEitherBar`).
- **Never external** (`TestExecutorRefusesExternalEffects`).

## Eval gate

`go run ./cmd/suggest-eval autopilot -synthetic -away-from-trips` replays the golden households (and, without
`-synthetic`, a database) at every past run minus the lead, through the same forecasts, `NeedBy` and planner.
**Ship bar:** precision ≥ 75% (`replay.PrecisionGate`), removals ≤ 1 per house-week and **F1 ≥ 70%** (precision ×
open recall, harmonic mean; `replay.F1Goal`). Pinned by `TestGoldenAssistMeetsGate`, `TestGoldenAssistF1Floor`
(floor 0.76) and `TestHoldOutSeedsMeetGoal` (five households seeds the bar was not tuned on). 2026-10-17, with
both bars: 83.9% precision, 69.6% open recall, **F1 76.1%**, 0.07 removals per house-week; hold-out F1
75.3–80.8%, precision 79.5–89.2%. (The run-fit bar alone scored 97.8% / 64.4% / 77.7%, but then what it did not
add was suggested, so the modes mixed; Jan chose exclusive modes, trading precision for open recall.) See
`docs/superpowers/qa/autopilot-benchmark-2026-10-17.md`.

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
  in `localStorage` `gracie_autopilot_seen_<listId>`. On assist the page never asks for suggestions (it waits
  for the House's mode first), so the two slips never stack. Suggest mode keeps today's suggestion slip unchanged.
- The mock (`VITE_MOCK_TRIPS=1`) starts on assist with three autopilot items; `?autopilot=suggest|off`.
