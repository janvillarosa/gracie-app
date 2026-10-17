# Smart suggestions

One recurring item suggested above a list shortly before it is due. Built on [analytics](analytics.md).

## Backend (forecast, service, eval)

_Backend paths are relative to `backend/`; packages live under `backend/internal/`._

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
- **Mode** `SUGGESTIONS_MODE=off|on` (default on; a retired `shadow` value runs as on and logs it). There is
  no shadow mode: the only gate is enough history, i.e. `Forecast.Confident` (MinScore, MaxCV). Every shown
  suggestion records `item.suggestion_predicted` (`Skip: true`, never rolled up; deterministic id per house,
  item and cycle) so live precision stays measurable.
- **`cmd/suggest-eval`** `backtest | shadow | backfill [-apply]`, backed by `analytics/eval` (pure, shared
  with the tests). `shadow` scores the live `item.suggestion_predicted` records against what happened next.
- **Pause:** two `item.suggestion_ignored` in a row on a list (no `item.suggestion_accepted` between, within
  14 days) stop suggestions there (`pausedByIgnores`, via `EventRepository.ListByContainer`). Ignore is
  written with `emitSync` (`analytics.SyncRecorder`) so the client's immediate refetch sees it.
- **Look-alike names:** `parse.Similarity` (plurals, spacing, edit distance; 0.85 threshold, 4-letter
  minimum). The fold merges look-alikes' history into an item's add forecast and scales its score by
  `NameCertainty`; `ForList` keeps one name per cluster, treats a look-alike on the list as on it, and shows
  the most recent wording.
- **Forecast version:** `analytics.ForecastVersion` is stamped on every `KeyIntervals`. **Bump it whenever the
  rhythm or add-forecast logic changes** (or after a backfill folded by older code): each fold tick then rebuilds
  every older forecast from stored history (`Worker.RefreshStale`, 500 per tick), no new events needed.
- **Run mode** (spec `2026-10-17-shopping-run-features-design.md`): `GET .../suggestions?during=run` (the List page
  asks once it sees a shopping run) also returns keys whose window opens before the house's next run on the list:
  lookahead = `Containers["list:<id>"].IntervalDay` of the house profile, capped at 14 days; no learned run rhythm
  means nothing in run mode. Open ones first, then soonest (`due_in_days`), then score, before the limit applies.
  `POST .../suggestions/ignore {key, during:"run"}` emits the ignore with `props.during`: it counts toward the
  two-ignores pause, is **not** a forecast miss (the rollup skips it), and only hides the key from run mode until
  its window opens. Run-mode predictions carry `during` and their own deterministic id. Any other `during` is a 400.
- **Run hint:** `GET .../lists/{id}/run-hint` (`services/run_hint.go`, pure `ComputeRunHint`) tells the client how
  to spot a run: `checks_to_start` 2 (`expected`: in the `next_run` window ±1 h with confidence ≥ 0.5, or the hour of
  week ±1 holds ≥ 50% of the `run_how` peak), 3 (`unknown`), 4 (`unlikely`: < 10% of the peak); `idle_end_min` =
  clamp(4 × `run_gap_sec`, 15, 45 min); `burst_sec` = clamp(`run_gap_sec`/5, 5, 30 s); `typical` from 5 runs. Own
  rhythm at ≥ 3 runs, else the house's. Analytics off or the house setting off: the default 3 / 45 / 15.
- **House setting:** `PUT /rooms/settings {suggestions_off}`; `GET /rooms/me` returns it.
- Invariants: never add suggestion state that is not derivable from events and aggregates; an ignore must
  stay an event so the forecast sees it.

## Frontend (the suggestion slip)

_Frontend paths are relative to `frontend/src/`._

`ListPage` asks `GET /rooms/{id}/lists/{list}/suggestions?limit=1` and shows the answer as one
`SuggestionStack` row above the items: a paper slip (`--slip-rest`, not a lift: it lies on the list's sheet) with the item, "You add it weekly", a yellow Add (this
page's one key; a round plus at 400px and narrower, `NARROW_SLIP`, so the name keeps the room; the name wraps to two lines before it is cut) and a round "not now" X. Never inside the list or the add bar. Add goes through `onCreateItem`
with `source: 'suggestion'`; Ignore posts the key. Both pop the slip at once and the server is asked for the
next one; after two ignores in a row it answers with nothing (the list is paused).
Motion: one authored arrival, then rest, nothing loops (`styles.css`, "Arrival"). The slip settles in while the list
below glides down (`.suggestion-reveal` grid rows 0fr to 1fr, clipped only during the grow; on the lite motion tier the
slot opens at once), its warm edge (an `::after` border, faded by opacity) flashes and
fades, and a beat later the plus on the key turns a quarter once and rests
(it is symmetric, so it ends looking as it began). No gloss, no pulsing, no loop. A taken or ignored slip pops out but keeps its slot (`spent` phases leaving, held, collapsing), so going
through suggestions swaps the card in place and the list never moves; the slot closes once, only when nothing follows.
Every slip is the same height (`min-height: 76px`, room for a two-line name). Any new row, typed or suggested, pops in (`row-in`, with the highlighter swipe). Taking or ignoring the slip pops it out (150ms) while the list glides up; it stays mounted
until then (`leavingSuggestion`, `SUGGESTION_EXIT_MS`). Reduced motion gets a plain fade. The server decides everything (confidence, home list, house setting), so a
failure or an empty answer just shows nothing. Events: `nudge.shown|tapped|dismissed` with
`kind: 'recurring'`. The House settings page has the on/off switch (`suggestions_off`). Mid-shop the slip runs in
run mode (see [lists.md](lists.md), Shopping runs).
