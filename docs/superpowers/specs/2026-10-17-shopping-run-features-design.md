# Shopping-run features: run-mode suggestions, run-done stamp, usual quantity

Status: approved by Jan 2026-10-17. Builds on
[behavior analytics](2026-10-16-behavior-analytics-design.md) and
[smart suggestions](2026-10-16-smart-suggestions-design.md).

## Intent

The analytics layer already knows when a house shops, how often each item comes back and what
quantity it usually buys. Three small features put that to work while you shop. None of them
adds a new screen. They follow Bauhouse's taste: one quiet slip, charm moments, nothing you have
to learn.

1. **Grab it while you're there (run mode).** Once you are clearly mid-shop, the suggestion slip
   offers something that is not due yet but will be before your next shop.
2. **Run-done stamp.** When you finish a shop, a stamp lands on the sheet:
   "Run done · 14 items · 22 min".
3. **Usual quantity.** Autocomplete pre-fills the quantity you *usually* buy, not the one you
   bought last.

Out of scope: the trip lead-time nudge (idea 3). It is being designed in its own session
(`docs/superpowers/specs/2026-10-17-trip-leadtime-nudge-design.md`).

## Decision (Jan): no shadow mode, data is the only gate

> "If it has enough data in analytics service then it should just go. The only gate is
> abundance of data to make confident decisions."

- `SUGGESTIONS_MODE` becomes `off | on`, default **`on`**. Shadow is removed. This applies to the
  existing smart suggestions too, not only run mode, so **suggestions start showing in production
  on deploy** wherever the forecast is confident.
- The gate is the forecast's own confidence bar, which already exists:
  `Forecast.Confident` = has trials, Wilson lower bound ≥ `MinScore` (0.65 at z = 1.28) and
  `CV ≤ MaxCV` (0.5). In practice an item needs a run of correct backtested cycles before it can
  speak, so a thin history is silent by construction.
- Run mode adds one more data gate: the list must have a learned run rhythm (see below).
- `item.suggestion_predicted` is still recorded in `on` mode (it already is), so
  `suggest-eval shadow` keeps measuring live precision. The subcommand keeps its name (builder may
  alias it to `live`).
- A legacy `SUGGESTIONS_MODE=shadow` value is read as `on` with a startup log line, so a stale
  env var cannot silently hide the feature. The `mode` prop enum keeps `"shadow"` so old events
  still validate (props are additive only).
- The off switches stay: env `SUGGESTIONS_MODE=off` and the house setting `Room.SuggestionsOff`.
- **Deploy check:** confirm the production env (Railway) does not pin `SUGGESTIONS_MODE`.

## 1. Run mode: "grab it while you're there"

### When a run is on (Jan: "smarter, using user analytics as well")

Two halves. The **server** says how likely a run is right now and what this person's runs on this
list usually look like (learned). The **client** watches live check-offs and decides instantly
(the server's aggregates lag ~15 minutes). Lying about a run only gets you your own house's
suggestions, so it needs no server-side check.

**Live signal (client).** The List page keeps, in memory, the times **you** checked items on
**this list** during this page visit (not persisted). A run starts when the last *k* checks fall
within the idle gap of each other, they don't look like tidying (below), and *k* is the
"checks to start" the hint gives. The run ends after the idle gap passes with no check.

**Learned prior (server): `GET /rooms/{room_id}/lists/{list_id}/run-hint`.**
Point lookups on your profile (`u:<user>`) and the house profile (`h:<room>`), membership-checked.
It uses **your** rhythm for the list (`Containers["list:<id>"]`) when you have ≥ 3 runs there, and
the house's otherwise. It returns:

```json
{ "likely": "expected | unknown | unlikely", "checks_to_start": 2, "idle_end_min": 20,
  "burst_sec": 15, "typical": { "minutes": 24, "items": 12 } }
```

- **How likely a run is now:**
  - `expected`: now is inside the list's `next_run` window (±1 h) with confidence ≥ 0.5, **or** the
    current hour of week (±1 h) holds ≥ 50% of the peak of `run_how`, with ≥ 3 runs learned.
    → **2 checks** start a run.
  - `unlikely`: ≥ 3 runs learned, not in the window, and the current hour holds < 10% of the
    `run_how` peak (say, 11 pm on a Tuesday for Saturday-morning shoppers). → **4 checks**.
  - `unknown`: anything else, including no profile yet. → **3 checks**, today's rule.
- **What a run looks like for you** (new learned fields on `ContainerRhythm`, computed in
  `BuildProfile` from the same runs `predict.Runs` finds; `predict` gains a variant that returns
  each run's start, end and count):
  - `run_minutes`: median length of a run, first to last check.
  - `run_items`: median checks per run.
  - `run_gap_sec`: median gap between checks inside a run.
- **Idle gap** (`idle_end_min`): `clamp(4 × run_gap_sec, 15 min, 45 min)`. A quick shopper's run
  ends sooner than a slow one's. Default 45 min (`RunGap`) without data.
- **Tidying filter** (`burst_sec`): checks that land faster than a person could shop are someone
  ticking things off at home after unpacking, not a run. If every gap among the starting checks is
  under `burst_sec`, they don't start a run. `burst_sec = clamp(run_gap_sec / 5, 5 s, 30 s)`,
  default 15 s.
- `typical` is present only with ≥ 5 runs learned. The stamp uses it (section 2).

**Fallback.** No hint (error, offline, no profile) means today's rule: 3 checks, 45 min, 15 s. The
client fetches the hint once when the List page opens (React Query, stale after 10 min) and never
waits for it.

New profile fields appear after the next profile pass for a subject that had events, and the
nightly full pass fills the rest. No backfill is needed.

### What it suggests
- Request: `GET /rooms/{room_id}/lists/{list_id}/suggestions?during=run`.
- Server: everything `ForList` does today (house off switch, ignore pause, home list, not on the
  list, look-alikes, confident only), but the candidate window is wider: a key qualifies if its add
  window is open now **or opens before the next expected run**.
  - Lookahead = the house profile's run rhythm for this list, `Containers["list:<id>"].IntervalDay`,
    capped at 14 days.
  - **No run rhythm for the list (fewer than the runs `NextWindow` needs) → run mode returns
    nothing.** That is the extra data gate.
  - Ordering: items whose window is already open first, then by soonest due, then by score.
- `Reader.Upcoming` / `UpcomingKeys` gains an "opens before" bound (today it only matches windows
  open at `now`). Mongo and memstore both change; there is an existing integration test to extend.
- The response adds `due_in_days` (0 when the window is already open) so the slip can say when.
- `item.suggestion_predicted` carries `props.during = "run"` (new optional enum prop) so precision
  can be measured separately.

### How it looks
- The same single slip in the same place (top of the list). Same Add key and quiet X.
- Copy changes only in run mode, in the House voice: e.g. "Eggs? Usually due in 3 days." Exact
  copy is the builder's call within the design system.
- When the run ends (45 min idle), the page drops back to normal suggestions on next fetch.

### Ignore and accept
- Accept is unchanged (`source: suggestion` on `item.added`).
- Ignore in run mode posts `{key, during: "run"}` and emits `item.suggestion_ignored` with
  `props.during = "run"`.
  - It **counts** toward the two-ignores pause (the house said no twice).
  - It is **excluded** from the forecast's dismiss series. Turning down eggs three days early is
    not evidence the rhythm is wrong, so it must not lower the item's score. *(My call.)*
  - It skips that item for the rest of this run. It can return when it is actually due.

## 2. Run-done stamp

- **Trigger:** while a run is on (section 1), either the last unchecked item on the list gets
  checked or the user taps Clear done. At most once per run.
- **Content:** "Run done · {n} items · {m} min". n = checks in this run, m = minutes from the first
  to the last check in this run, rounded. Under 1 minute, drop the minutes.
- **Learned flourish:** when the run hint carries `typical` (≥ 5 runs learned) and this run was at
  least 3 minutes quicker than `typical.minutes`, add a line: "4 min quicker than usual". Never
  "slower than usual". The stamp is a reward, not a report card. *(My call.)*
- **Behaviour:** the stamp lands on the list sheet with a short press animation, stays about 2.5 s,
  then fades. A tap dismisses it. It never blocks input. Under `prefers-reduced-motion` it appears
  and fades without the press. It is announced politely to screen readers (`role="status"`).
- **Client-built:** made from the page's own check times plus the run hint already fetched for
  run detection. No extra request.
- **Design system first:** this is a new pattern (a large rubber-stamp moment, distinct from the
  small `ui/Stamp` tag). Add it to `components/ui/` as a primitive (name is the builder's call, e.g.
  `RubberStamp`), with its tokens in the `:root` block, a section on
  `docs/design-system/index.html` (`pnpm design:sync`) and in `DESIGN.md`.
- **Measurement:** client event `list.run_stamped {items, minutes}` (`Client: true`, int props,
  `Container {list}`), registered in `services/analytics_events.go` and allow-listed for
  `POST /events`.

## 3. Usual quantity

- Today `pantryByKey` takes the quantity and unit from the **most recent** add of each item
  (`services/list_service.go`), and `AddItemBar` already falls back to it when you pick an
  autocomplete slip without typing a quantity. The slip already shows it.
- Change: quantity + unit (as one pair) become the **most common pair among that item's last 10
  adds**. Ties go to the most recent. An add with no quantity counts as the empty pair, so a house
  that usually types plain "milk" gets no pre-fill.
- Description and category still come from the most recent add.
- Suggestions inherit it for free (`toSuggestion` reads the pantry entry).
- No frontend change. No new endpoint. (`GetPantry` still scans history. Moving it to `key_stats`
  is the existing follow-up, not part of this.)

## Files (expected)

Backend:
- `internal/config/config.go`, `.env.example`, `cmd/gracie-server/main.go`: modes `off|on`, default on.
- `internal/services/suggestion_service.go`: remove shadow, `during=run` path, run-mode ignore.
- `internal/services/analytics_events.go`: `during` prop, `list.run_stamped`.
- `internal/analytics/reader.go`, `store/mongo/analytics_agg_repo.go`,
  `testutil/memstore/analytics_read.go`: "opens before" bound.
- `internal/analytics` fold / forecast input: drop `during: run` ignores from the dismiss series.
- `internal/http/handlers/suggestions.go`: `during` query param and ignore body field.
- `internal/analytics/profile.go`, `internal/analytics/predict/rhythm.go`: run spans, and
  `run_minutes` / `run_items` / `run_gap_sec` on `ContainerRhythm`.
- New `internal/services/run_hint.go` (pure `RunHint(userProfile, houseProfile, listID, now)` plus a
  service method) and a handler + route for `GET .../lists/{list_id}/run-hint`.
- `internal/services/list_service.go`: usual-quantity pick in `pantryByKey`.

Frontend:
- `pages/ListPage.tsx` (run-hint fetch, run tracking via a pure `useShoppingRun` hook / reducer,
  run-mode fetch, stamp trigger), `components/SuggestionSlip.tsx`
  (run copy), `api/` (param, `due_in_days`), `lib/analytics` (event), new `components/ui/` stamp
  primitive + CSS + tokens.

Docs: `backend/CLAUDE.md` (Smart suggestions: modes, run mode, gate), `frontend/CLAUDE.md`,
`DESIGN.md`, `docs/design-system/index.html`.

## Verification

- Unit (backend): `RunHint` table tests (in window, habit hour, unlikely hour, own vs house rhythm,
  < 3 runs → unknown, `typical` only at ≥ 5 runs, clamps on idle gap and burst); run spans and the
  three medians, including a run that crosses midnight; mode parsing (incl. legacy `shadow` → on); run-mode candidates (open now vs
  opens before next run, cap at 14 days, no rhythm → empty); run-mode ignore counts for the pause but
  not the forecast; `pantryByKey` mode-of-last-10 with ties and empty pairs; `list.run_stamped`
  validation.
- Integration: `UpcomingKeys` with an "opens before" bound (`make test-integration`).
- Frontend (Vitest): run starts after `checks_to_start` checks (2, 3, 4) and not before; a burst
  under `burst_sec` doesn't start one; the run ends after `idle_end_min`; no hint → the 3 / 45 / 15
  fallback; the stamp appears
  on the last check and on Clear done, once per run, never outside a run; reduced motion; run-mode
  slip copy and ignore payload.
- `make check` green, coverage floors held.

## Calls I made (for review)

- Run detection: the client decides live, the server supplies a learned prior (`run-hint`). Your
  own rhythm wins at ≥ 3 runs, else the house's. Thresholds: expected → 2 checks, unknown → 3,
  unlikely → 4. Idle gap and tidying filter scale from your median check gap.
- Stamp says "quicker than usual" only, never slower, and only with ≥ 5 runs learned.
- Run-mode lookahead = the list's learned run interval, capped at 14 days. No rhythm, no run mode.
- Run-mode ignores pause suggestions but don't count against the forecast.
- Stamp trigger = last item checked or Clear done, during a run only.
- Usual quantity = most common of the last 10 adds, ties to the most recent.
- `suggest-eval shadow` keeps its name.
