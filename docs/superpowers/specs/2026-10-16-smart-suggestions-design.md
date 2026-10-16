# Smart suggestions for recurring items

Status: built, shipping in `shadow` mode. Builds on
[behavior analytics](2026-10-16-behavior-analytics-design.md).

## Intent

A house re-adds the same things on a rhythm (milk about every 6 days, paper towels every 3
weeks). When one of those looks due, Bauhouse shows **one** quiet suggestion at the top of
the list, and a tap adds it. It suggests a little **before** the house would add it
themselves, and only when it has **evidence** the prediction is right for that house and
that item. A wrong suggestion costs trust; a late one is useless. So most of the work is in
earning and measuring confidence; the UI is deliberately small.

## Decisions (Jan)

- Suggest, never auto-add. One tap adds it.
- Stateless at request time: a suggestion is a pure function of what analytics knows now
  plus the live list. There is no suggestion table.
- High confidence only, ranked by confidence. One slip at a time (a three-slip stack was tried in
  the demo and reverted); acting on it (add or ignore) asks the server for the next one.
- Placement: one slip at the top of the list page, above the items. Not inside the list, not
  attached to the add bar. Its Add is the page's one yellow key; Ignore is a quiet round X.
- **Two ignores in a row stop suggestions** on that list (no accepted suggestion in between). Jan's
  rule; the pause length is a builder's call: 14 days, then it tries again. Derived from events
  (`item.suggestion_ignored`, `item.suggestion_accepted`), so there is still no stored state.
- Ignore skips the item for this cycle; it can return when next due.
- A house setting turns the feature off for the whole house (`Room.SuggestionsOff`, default on,
  `PUT /rooms/settings {suggestions_off}`).

## Confidence: backtest every item's rhythm

`predict.Params.Predict` (pure) forecasts the next add from a house's history and scores the
forecast by replaying it.

- **Series.** Adds when there are at least 4 (after collapsing bursts under 6h); otherwise
  checks, as a re-add usually follows a completion. A checks-only house still works. No profile
  is needed.
- **Window.** For a predicted due time D and smoothed gap E days: opens at D - clamp(0.2E, 12h, 2d),
  closes at D + clamp(0.1E, 6h, 1d). A suggestion shows only while now is inside it. The window then
  widens to cover the habit's own wobble: two standard deviations of the gaps (CV x E x 2) on each side,
  capped at 2 days early and 1.5 days late, and never narrower than the base. A steady weekly item keeps
  its tight window; a "Saturday or Sunday" shopper (gaps of 6 and 8 days) gets one that opens on Friday,
  and their Sunday adds count as hits instead of misses (added 2026-10-16, `JitterK`, `MaxJitterGrace`).
- **Backtest.** For every occurrence after the first three, forecast it from what came before and
  count a hit when it landed in the window (too early and too late are misses). An
  `item.suggestion_ignored` inside a cycle turns that cycle into a miss, so ignores lower future
  confidence: real feedback, not a mute list.
- **Score.** Wilson lower bound of hits/trials at z = 1.28, so thin evidence scores low without a
  magic minimum count (4/4 = 0.71, 3/4 = 0.43).
- **Bar.** Score >= 0.65 and CV <= 0.5. Both are `predict.DefaultParams`, tuned with
  `suggest-eval`, not by feel.

The fold stores the result as `KeyIntervals.Add` (`AddForecast`) on `key_stats`, with an index
on `(room_id, subject_type, intervals.add.opens_at)`. The request path is a cheap indexed read
(`Reader.Upcoming` -> `UpcomingKeys`).

## Tuned on a real household (2026-10-16, forecast version 2)

`suggest-eval tune` replayed a real house's year of history (~1,100 adds) at the unchanged bar
(MinScore 0.65, MaxCV 0.5). Under the first model nothing qualified. The household shops at weekends,
buys staples most weeks and skips some (gaps of 7, 14, 21, 28 days), and its habits changed during the
year (cherry tomatoes went from fortnightly to weekly). The defaults are now:

- **Rhythm:** the median of the latest 12 gaps (a skipped week does not stretch it), and regularity
  measured after folding skipped cycles (a 14 day gap on a 7 day rhythm is two clean cycles).
- **Windows repeat** for up to four skipped cycles: after a weekend without an add, the next weekend
  opens again. Each window opens up to 3 days early (0.5 of the rhythm) and closes up to 2 days late
  (0.25). All windows are stored (`AddForecast.Windows`) and `UpcomingKeys` matches any of them.
- **Confidence is judged on the latest 8 cycles,** so it reflects how the house shops now.
- **Scoring is per cycle (lenient):** a cycle is a hit when the add landed in any of its windows. A
  weekend the slip showed without an add is not counted as a miss. Under the strict reading
  (`StrictSkips`, every empty window a miss) nothing qualifies for this house, because it genuinely skips
  about a third of weekends; Ignore and the two-ignores pause handle those weekends instead.
- **On the list** now means unchecked: houses that never clear keep every checked row, which blocked
  every suggestion. Only the event type the forecast learned from (adds) closes a cycle, so checking off
  Saturday's add on Sunday does not hide next week's slip.

Result on that house's data, run through the real fold and `ForList`: cherry tomatoes (0.83), butter
beans (0.83), eggs (0.66) and feta (0.66) suggested on the Groceries list. `predict.ClassicParams`
keeps the first model for comparison.

## Look-alike names (added 2026-10-16)

"orange" and "oranges", or "butterbeans" and "butter beans", are one thing to a household.

- **Similarity** (`parse.Similarity`): 1.0 when the names match after folding spaces, hyphens and simple
  English plurals (`parse.CompactKey`); otherwise one minus the edit distance over the longer compact
  name. Names under four letters only match exactly. Look-alikes are names at 0.85 or above.
- **Merged history:** when the fold recomputes an item, its add forecast also uses the events of up to
  five look-alike names in the house. The score is multiplied by the name certainty, the average
  similarity across the merged occurrences: exact names and plurals cost nothing, a spelling apart
  ("yoghurt" for "yogurt") lowers the score in proportion to how much of the history it supplied. The
  certainty is stored on the forecast (`AddForecast.NameCertainty`). Look-alikes of a changed item are
  recomputed in the same pass. The older own-key rhythm used by insights is unchanged.
- **One slip per cluster:** at request time only the most confident name of a look-alike group is kept,
  a look-alike already on the list counts as on it, and the slip shows the wording the house used most
  recently (with that item's quantity and unit).
- `suggest-eval backtest` still groups by exact name, so it measures without the merge (follow-up).

## Request path

`GET /rooms/{id}/lists/{list}/suggestions` (`SuggestionService.ForList`):

1. Member check. Nothing when mode is `off`, analytics is off, the house turned it off, or the list is
   paused (its last two suggestion reactions in the past 14 days were both ignores).
2. `Upcoming`: forecasts whose window is open now and that clear the bar.
3. Keep keys whose **home list** is this one (>= 60% of the key's events, `KeyStat.Containers`).
4. Drop keys already on the list (checked-but-not-cleared counts as on the list).
5. Drop keys ignored this cycle, or added/checked since the forecast was computed (raw events
   are fresher than the rollup, which lags up to ~17 minutes).
6. Sort by score, return up to `limit` (default 1, max 5; the UI asks for 1).

`POST .../suggestions/ignore {key}` records `item.suggestion_ignored` (an analytics event
with `RoleDismiss`) **synchronously** (`SyncRecorder`), because the client asks for the next
suggestion at once and the buffered recorder flushes only about once a second; there is no other state. The key is in the body because it is free text.

Adding from a suggestion sends `source: "suggestion"`; `item.added` carries it as a prop and the
server also records `item.suggestion_accepted`, which ends an ignore streak.

## Rolling out: shadow first

`SUGGESTIONS_MODE=off|shadow|on` (default **shadow**).

- **shadow:** computes suggestions and records one `item.suggestion_predicted` per house, item and
  cycle (deterministic event id, so repeat views write one), but returns an empty list.
- **on:** returns suggestions and still records predictions, so live precision stays visible.

`go run ./cmd/suggest-eval`:

- `backtest`: replays all history through the same code, prints precision, how many items
  qualify, the score distribution and a `MinScore` sweep. Use it to pick constants.
- `shadow`: joins live predictions with what the house did next (hit, premature, ignored,
  accepted).
- `backfill [-apply]`: turns existing `list_items` (cleared items are archived, not deleted)
  into `item.added`/`item.checked` events with deterministic ids so houses from before analytics get
  forecasts; dry run by default, skips items that already have events, safe to repeat.

**Go-live gate:** switch to `on` only when shadow precision is >= 70% over at least 50 settled
predictions across at least 2 weeks. Otherwise tune and repeat.

## Not in v1

- Per-person suggestions or assignees. Suggestions are for the house.
- Auto-add, notifications or push.
- A way to un-ignore. Ignore only affects the current cycle, and the house setting is the off switch.
- Re-homing a solo house's history when its owner joins another house.
