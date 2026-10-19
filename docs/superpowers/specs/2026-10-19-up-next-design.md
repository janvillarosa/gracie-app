# Up next: the house's usual route through the shop

Status: design, 2026-10-19. Feature note to write on ship: `docs/features/autopilot.md` (Up next section).

## Intent

On a list the house shops often (Groceries), the list is in the order things were added, not the
order the house walks the shop. **Up next** names the one item on the list the house usually grabs
next, learned from the order past runs were checked off. It is the route the house already walks,
learned, never set up.

It is an autopilot feature: a guess, marked as one (the service bell, "Usually next"), that the
person can wave off. It never adds, removes or reorders anything.

Jan's words: "the usual sequence" (not the usual basket); "do not float an up next suggestion if the
house doesn't have a consistent pattern of shop"; "autopilot can only float one action to the user at a
time... autopilot slips stack in front of each other in a Z axis, not on the Y axis".

## Goals

1. Mid-shop, one slip above the list names the next item on the usual route. Ticking it checks the item
   off and the slip hands off to the next one in place.
2. It appears as soon as the list is opened in the store, as far as the app can tell (see "When it shows").
3. **Autopilot tiers become one mapping** (feature → modes) in `internal/autopilot`, which every gate reads.
4. **One autopilot slip at a time.** Every autopilot slip on the List page is one stack, ordered by the
   server; only the front one is in full, the rest peek beneath it (Z axis). Never two slips one under
   the other (Y axis).

## Non-goals

- No basket prediction (that is suggestions). No reordering of the list itself (mockup C was rejected).
- No location, geofences or store detection. No "Start shopping" button (a later option, see below).
- No per-store routes. One route per list; a list shopped at two stores is inconsistent and stays silent.
- No per-person routes. The route is the house's (house profile), like the run rhythm.
- No change to what Off / Suggest / Assist mean for existing features.

## Anti-goals (a failure even if it works)

- A wrong guess shown confidently. Silence beats a bad route; the bar is set by the eval, not by feel.
- Two autopilot slips stacked down the page pushing the list down.
- The list moving under the person's thumb mid-shop (hand-offs swap the slip in place).
- Dismissing Up next teaching the route anything, or leaking into the next shop.
- A yellow key on the Up next slip (in Suggest mode the suggestion's Add is the page's one key).

## Decisions Jan made

| Decision | Choice |
|---|---|
| What "the usual order" means | The usual **sequence** through the shop, not the usual basket. |
| Tiers | Up next is on **Suggest and Assist**, not Off. |
| How tiers are expressed | One mapping in code; features ask the mapping, never compare modes. |
| Look | Mockup **B1**: the existing suggestion slip (same paper, edge, 76px, round X), a tick box on the left, name, a reason line with the service bell "Usually next · then Bread", a round ✕. Not "pencilled in". No key. |
| Stacking | Autopilot floats **one** slip; others stack behind it (peeking), server-ordered. Up next is in front of the suggestion slip. |
| ✕ on Up next | "Not now, I know my way": hidden for the rest of this run, **not** a signal against the route, back next shop. |
| Stores | A list is mostly one store. No consistent pattern → no Up next. |
| When it shows | As soon as the list is opened in the store, if possible; else the best available signal (below). |
| The slip behind | **Hidden until ✕.** The stack is display-only: the peeking edges only say something waits; the slip behind comes forward only when the front one is closed. Mid-shop suggestions and the assist slip wait behind Up next. |
| Real data | **Gate before deploy.** Merge on the synthetic bar; before deploy run `suggest-eval upnext` on real data. Below the bar it ships silent (the bar keeps it from showing), never wrong. |

## Design

### 1. The tier mapping (`internal/autopilot/features.go`)

```go
type Feature string

const (
    FeatureSuggestions Feature = "suggestions" // the suggestion slip (incl. run mode)
    FeatureAutoAdd     Feature = "auto_add"    // assist's ticker adds, marks, Undo, the "Added 3" slip
    FeatureRunHint     Feature = "run_hint"    // learned run detection thresholds
    FeatureUpNext      Feature = "up_next"
)

// Tiers is the one place that says which mode has which feature. The modes are exclusive, not a
// ladder (assist has no suggestion slip), so this is feature -> modes, not a minimum tier.
var Tiers = map[Feature][]Mode{
    FeatureSuggestions: {ModeSuggest},
    FeatureAutoAdd:     {ModeAssist},
    FeatureRunHint:     {ModeSuggest, ModeAssist},
    FeatureUpNext:      {ModeSuggest, ModeAssist},
}

func Has(m Mode, f Feature) bool
func Features(m Mode) []Feature // sorted, for the API

// SlipOrder is the front-to-back order of autopilot slips on a list: what matters in the aisle first.
var SlipOrder = []Feature{FeatureUpNext, FeatureAutoAdd, FeatureSuggestions}
```

- Every existing gate moves onto `Has`: `AutopilotService.Suggestions` (`mode != ModeSuggest`), `RunHint`
  (`== ModeOff`), the ticker's per-house check (`!= ModeAssist`). `ListIDsByAutopilotMode(ModeAssist)` stays a
  store query but takes its mode list from `Tiers[FeatureAutoAdd]`. `Decide` keeps its per-mode bar logic (it
  is about bars, not membership) but its mode switch must agree with `Tiers`; a test pins that.
- A test fails if any `Feature` constant is missing from `Tiers` or `SlipOrder` (SlipOrder lists only slip
  features; run_hint is not a slip).
- The API carries the house's resolved features: `GET /rooms/me` (and the other room payloads that already
  carry `autopilot_mode`) add `autopilot_features: ["run_hint","up_next",...]`; `GET .../autopilot` adds
  `features` too.
- Frontend: `hasFeature(room, 'up_next')` reads `autopilot_features`. The List page stops comparing mode
  strings (`ListPage.tsx` `assist`). For deploy skew only (API and web deploy separately), when the field is
  absent it falls back to a copy of the table keyed by `autopilotModeOf(room)`; the fallback goes after one
  release, like `suggestions_off`. RoomSettings keeps using the mode itself (it is the setting).

### 2. Learning the route (pure, `analytics/predict/route.go`)

Input: the house's completion events on the list container (`item.checked`, `RoleComplete`, already
gathered per container in `BuildProfileAway`), split into runs by `predict.RunSpans`.

- **Per run:** the order of distinct keys checked (first check of a key wins; look-alike names merged with
  `parse.Similar`, keeping one cluster name as `ForList` does). A run counts toward the route only if it has
  at least `RouteMinItems` (4) distinct keys; smaller top-up shops say little about a route.
- **Position:** in a run of n keys, the k-th key (0-based) sits at k/(n−1), from 0 (start) to 1 (end).
- **Route:** each key's position is a recency-weighted mean over the last `RouteWindow` (12) qualifying runs it
  appeared in (half-life `RouteHalfLife`, 4 runs), so a changed habit shows within a few shops. Only keys seen
  in ≥ 2 of those runs get a spot.
- **Score (the consistency bar):** a backtest, like the add forecast. For each of the last 12 qualifying runs,
  learn the route from the runs **before** it, then step through that run: after each check, predict the
  next item among the run's still-unchecked keys that have a spot. A **hit** is the named key being checked
  within the next `RouteHitWindow` (2) checks (grabbing Bread before Eggs in the same aisle is not a miss).
  Score = Wilson lower bound of hits/trials. Two stores, a random grabber, or a household where each member
  walks differently all score low, so the route stays silent. That is Jan's "consistent pattern" rule.
- **Bars** (`autopilot.Policy`): `UpNextMinRuns` (5 qualifying runs), `UpNextMinScore` (set by the eval; start
  at 0.5). Tune with `suggest-eval upnext`, not by feel.
- **Stored** in the house profile only (`h:<room>`), on the container's rhythm:
  `ContainerRhythm.Route *Route { Runs int; Score float64; Spots map[string]float64 }` (`route` in bson). It is
  rebuilt whole on each profile recompute, like the rest of the profile; no version bump is needed.
  The person profile (`u:`) does not compute it.

### 3. Picking Up next (pure, shared rule)

Given the list's live items with a spot, and the spot of the last item checked **this run**:

1. Up next is the unchecked item with the smallest spot **at or after** the anchor (the last checked item's
   spot). Before any check this run, the anchor is 0 (the start of the route).
2. If nothing unchecked lies ahead, double back: the unchecked item with the smallest spot overall.
3. "then X" names the following pick (the next by the same rule after Up next), or nothing.
4. A checked item with no spot does not move the anchor. Items with no spot are never named.
5. No candidate → no slip.

The rule runs on the client (`frontend/src/lib/upNext.ts`) so the hand-off is instant on each check; the
server sends the data, not the pick. A Go twin in `internal/autopilot/upnext.go` serves the eval; table tests in
both use the same cases (a shared JSON fixture under `backend/internal/autopilot/testdata/upnext_cases.json`,
read by the Go test and copied/imported by the Vitest test; builder's call how to share it).

### 4. The API: one ordered stack (`GET .../autopilot`)

`AutopilotView` grows and becomes the List page's single autopilot read in every mode:

```json
{
  "mode": "suggest",
  "features": ["run_hint", "suggestions", "up_next"],
  "stack": ["up_next", "suggestions"],
  "up_next": {
    "ready": true,
    "run": {"started_at": "2026-10-19T10:02:00Z", "anchor_item_id": "it_7"},
    "route": [{"item_id": "it_1", "key": "eggs", "spot": 0.31}, ...]
  },
  "applied": [...],
  "suggestions": [...]
}
```

- `stack` is `SlipOrder` filtered to the features this house has **and** has something for on this list
  right now (Up next: a route that clears the bar and ≥ 1 unchecked item with a spot; auto_add: an applied
  action in the slip's run; suggestions: ≥ 1 suggestion). The server decides the order; the page never does.
- `up_next.route` lists the live items (checked or not) that have a spot, so the client can apply the pick rule
  as items are checked. Item ↔ key matching uses the same normalization and look-alike rule as suggestions'
  "already on the list".
- `up_next.ready` and `up_next.run` (the current run and its anchor) are defined in "When it shows".
- `GET .../autopilot?during=run` passes run mode through to the suggestions in the view (today's
  `/suggestions?during=run`). Anything else in `during` is a 400.
- The List page moves off the deprecated `GET .../suggestions` onto this view for suggestions in Suggest mode.
  Ignore stays `POST .../suggestions/ignore` (not deprecated in behavior); after it the page refetches the view.
  `GET .../run-hint` is untouched by this work.
- Never applies, never writes, as today. Up next records nothing server-side.

### 5. When it shows, and where the route starts

The app cannot know the person is in the shop. It knows when the house usually shops, and the server
sees every member's check-offs (raw `item.checked` events on the list), so **the server owns "the current
run"**, not the page's in-memory `useShoppingRun`:

- `up_next.run` (server): when the list's latest check-off is within `predict.RunGap` of now, the current
  run is the span it belongs to: `{"started_at": ..., "anchor_item_id": "<last item checked in it>"}`, from any
  member. Otherwise absent. Check-offs from earlier runs (last week's items not yet cleared) are never an
  anchor.
- `up_next.ready` is true when a run is in progress (`run` present) **or** the house's `NextRun` window
  contains now with confidence ≥ `Policy.MinRunConfidence` (the run hint's `expected`). A run in progress
  keeps it true even after the profile recompute moves `NextRun` to next week, so it cannot flip off mid-shop.
- **On open:** if `ready`, the slip is there on first paint, anchored on `run.anchor_item_id` (or the start of
  the route when no run has begun). This covers reloads, app resume and a second member's phone.
- **Otherwise, on the first check-off of this visit** (a check, not an uncheck), it appears, anchored on that
  item. One check tells us where on the route the person is.
- The page's own later checks move the anchor locally; a refetch takes the server's anchor.
- Once shown, it **stays for the visit** while there is something to name; it goes when nothing is left, on
  Clear done / "Run done", or when a refetch says `ready: false` and the page has seen no check for the run
  hint's `idle_end_min`.
- **✕ is keyed to the run:** `gracie_up_next_hidden_<listId>` stores `run.started_at` (or the `NextRun` window
  start when no run has begun) and the time. It applies while that key matches, and lapses after 12 h at most.
  A reload is not a new run; the next shop is.

Later, if the window misses too often (measured, see Measurement): a "Shopping now" tap, then maybe location.
Out of scope here.

### 6. The slip and the stack (frontend)

- **`UpNextSlip`** (`components/UpNextSlip.tsx`): the suggestion slip's paper and size (76px, `--slip-rest`,
  `--radius-lg`), plain edge (`--border-strong`, no warm edge: nothing waits on a key). Left: a tick box (the
  same check control as a list row, 44px target). Middle: the name (wraps to two lines, as suggestions) and a
  muted reason line led by the autopilot stamp holding the service bell: "Usually next · then Bread" (no
  "then" when nothing follows). Right: a round ✕ (`Button iconOnly`, `title="Not now"`,
  `aria-label="Hide up next"`).
- **Tick** checks the item through the page's existing toggle (same mutation, same confetti and run rules as
  the row) and the slip hands off in place to the next pick (the suggestion slip's spent/held phases). The
  list does not move.
- **✕** hides Up next for this run: kept per list in `localStorage` `gracie_up_next_hidden_<listId>` with the
  time; it lapses when the run ends or after 12 h. No server call, no forecast effect. The slip behind it
  comes forward.
- **The stack (new primitive `SlipStack`, `components/ui/`):** children are slips in front-to-back order; the
  first is in full, up to two more peek beneath its foot as slip edges (display-only: peeks are not
  focusable or tappable, and are `aria-hidden`; the front slip's label says nothing more) (slip heights, not paper heights; the
  peeks use the `--peek-tilt-*` tokens). Closing the front slip brings the next forward in place; the slot
  only closes when the stack empties. The List page renders `stack` from the view, after dropping what is not
  showable now (Up next before it is ready or while hidden, the assist slip once seen), and wraps the
  existing `SuggestionStack` row and `AutopilotSlip` as stack members. They stop being siblings one under the
  other. Add `SlipStack` to `docs/design-system/index.html` and DESIGN.md ("autopilot floats one slip").
- **A11y:** the slip is a `section` labelled "Up next"; on hand-off the new name is announced politely
  ("Up next: Bread"); the tick's label is "<name>, done". Reduced motion: plain swap.
- **Mock** (`VITE_MOCK_TRIPS=1`): the Groceries mock gets a route and `ready: true`; `?upnext=off` hides it;
  works with `?autopilot=suggest|assist`.

### 7. Measurement

- Client events (existing `nudge.*` path): `nudge.shown {kind:'up_next', key}` once per pick, `nudge.tapped
  {kind:'up_next'}` on tick, `nudge.dismissed {kind:'up_next'}` on ✕, and `nudge.followed {kind:'up_next', hit}`
  on the next check-off after a pick is shown (`hit` true when the checked item is the named one or the "then"
  one). Register the new name.
- `suggest-eval upnext` (new subcommand): replays houses (golden synthetic, and a database without
  `-synthetic`) run by run through the same route learner and pick rule; reports coverage (share of runs with
  a route), hit rate, and silence on inconsistent houses. **Ship bar** (pinned by tests on synthetic data):
  hit rate ≥ 70% where it speaks, silent on the two-store and random personas. Builder confirms the numbers on
  the synthetic set and writes them to `docs/superpowers/qa/up-next-benchmark-2026-10-19.md`.
- **Real data (Jan: gate before deploy):** after merge and before deploy, run `suggest-eval upnext` on the
  production data (read-only, as for PR #28) and record coverage and hit rate in the QA note. If real houses
  fall below the bar, deploy anyway only if it stays silent for them; the bar is the safety, not a tweak.
- **Synthetic data:** the golden households check items in random minute offsets within a run, so they have
  no route. Add route personas **without changing the existing world's bytes** (a separate generator or an
  opt-in, so `world.golden.json` and the autopilot benchmarks do not move): one-store steady route, route
  that changes halfway, two stores alternating, random grabber, two members with different routes, top-up
  shops only.

## Constraints

- `internal/autopilot` stays pure; analytics never imports it. The route learner lives in `analytics/predict`.
- Tokens only in CSS; `Button`/`Paper` primitives; no Ant Card/Button/Modal (tests enforce).
- Go 1.26, `CGO_ENABLED=0`, pnpm 9, Node 20. `make check` green; coverage ratchets do not regress;
  `make test-integration` if the profile's Mongo shape changes (it gains a field; existing docs read fine).
- Branding: user copy says "Up next", internal names stay as above.

## Left to the builder

- Exact animation of the stack hand-off (reuse the suggestion slip's phases).
- How the Go and TS pick-rule tests share cases.
- Refactor order of the existing gates onto `Has`, as long as behavior is unchanged (existing tests pass).
- Final eval bar values, within the ship bar above.

## Calls I made (Claude), for Jan to check

1. Route is per house, stored on the house profile's list rhythm; per-person routes are out.
2. A hit counts if the named item is checked within the next **two** checks.
3. Route needs ≥ 5 runs of ≥ 4 items; bars set by the eval, starting at score ≥ 0.5.
4. The pick rule runs on the client (instant hand-off); the server sends the route, not the pick.
5. The List page moves onto `GET .../autopilot` for suggestions in every mode (the documented successor),
   so one response carries the stack order.
6. `✕` is client-only (localStorage), keyed to the server's run, with a 12 h ceiling.
9. The server owns "the current run" (from every member's check-offs within `RunGap`), so the anchor survives
   reloads and second phones, and `ready` cannot flip off mid-shop.
7. Stack order `up_next > auto_add > suggestions`; at most two slips peek.
8. The new `SlipStack` primitive, added to the design system first.
