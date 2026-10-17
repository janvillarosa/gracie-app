# Autopilot assist benchmark (2026-10-17)

Command: `cd backend && go run ./cmd/suggest-eval autopilot -synthetic -away-from-trips`
(the golden households, `internal/testutil/households`, seed 20261017). Pinned by
`internal/autopilot/replay`: `TestGoldenAssistMeetsGate`, `TestGoldenAssistF1Floor` and
`TestHoldOutSeedsMeetGoal`.

**Ship bar (Jan):** precision ≥ 85%, ≤ 1 removal per house-week, **and F1 ≥ 70%**.

## Method

At every past shopping run on a list (runs found from check-offs with `predict.RunSpans`, after the
first four, so a run rhythm exists), the replay steps back by the ticker lead (18 h) and plans with
only the events before that moment, through the server's own code: the candidates `Reader.NeedsBefore`
would return, `autopilot.Rank`, `CycleOpen`, `Assess` (the run fit), `BestOfLookAlikes`, `Plan` and
`Decide`. Each add is scored against what the house checked off in that run (± 2 h):

- **precision**: adds bought in that run.
- **removals per house-week**: adds not bought in that run (a person would delete them, or they expire).
- **open recall**: adds over what was bought but *not already on the list* when assist planned. In these
  households people often write things down before the shop, and assist rightly skips those, so this is
  the share of the remaining writing-down that assist takes over. (Plain recall, over everything bought
  including one-offs and what was already listed, is reported too.)
- **F1**: the harmonic mean of precision and open recall.

## Result (default bar: run score ≥ 0.50, need ≥ 0.60)

| | runs | adds | precision | open recall | F1 | removals / house-week |
|---|---:|---:|---:|---:|---:|---:|
| **all houses** | 183 | 89 | **97.8%** | **64.4%** | **77.7%** | **0.01** |
| weekend-couple | 41 | 36 | 100% | 76.6% | | 0 |
| big-family | 45 | 30 | 93.3% | 73.7% | | 0.04 |
| bursty | 22 | 5 | 100% | 83.3% | | 0 |
| frequent-travellers | 16 | 7 | 100% | 100% | | 0 |
| habit-changer | 6 | 3 | 100% | 100% | | 0 |
| monthly-stocker | 8 | 3 | 100% | 75.0% | | 0 |
| lookalikes | 45 | 5 | 100% | 16.7% | | 0 |

bin-day, solo-irregular and new-house have no replayable runs and get nothing added.
**Ship bar: PASS.**

**Hold-out** (same bar, households generated from seeds it was not tuned on):

| seed | runs | adds | precision | open recall | F1 | removals / wk |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 171 | 89 | 98.9% | 65.7% | 78.9% | 0.00 |
| 7 | 181 | 91 | 92.3% | 65.6% | 76.7% | 0.03 |
| 42 | 171 | 96 | 94.8% | 65.9% | 77.8% | 0.02 |
| 2025 | 168 | 100 | 97.0% | 66.0% | 78.5% | 0.01 |
| 99991 | 183 | 107 | 96.3% | 64.4% | 77.2% | 0.02 |

## How F1 went from 52.6% to 77.7%

The first version judged assist with the suggestion forecast: a Wilson score on whether the *add* lands
in a narrow window around its predicted time, and `predict.NeedBy`, which is capped at 0.5 for any
forecast below the suggest bar. That measures the wrong thing for assist. Milk bought nearly every
Saturday scored 0.52 because people add it on different days, and its need could never pass. Miss
diagnostics (`Report.Misses`) showed 51 of 85 open misses blocked by the suggestion score and 21 more by
the assist bar; only 8 were first-time buys nothing could catch. The fixes:

1. **Run fit** (`autopilot.FitRun`, `Assess`): assist judges each thing from its own purchases against the
   house's run rhythm. Score = Wilson lower bound over the last 12 cycles that landed in the run their
   rhythm pointed to (± half a run interval). Need = the chance it runs out by this run, given it was not
   bought since: the share of its recent gaps that end by this run's window among those that had not ended
   before it (Laplace-smoothed), in home time. 52.6% → 73.7%.
2. **Overdue means wanted**: when it has been longer than any recent gap (a skipped run), need is 1, unless
   it is more than two rhythms overdue (the habit stopped).
3. **Look-alikes judged before they are merged**: assist keeps every spelling until each has its run fit,
   then keeps the most needed (`BestOfLookAlikes`).
4. **Independent bars**: `Decide` applies on the assist bar alone; the suggest bar (on the add forecast)
   only governs suggestions. Before, anything under 0.65 was dropped before the assist bar was checked.
5. **The bar from the plateau, not the peak**: every bar from 0.45 to 0.60 gives F1 76–78%; 0.50 / 0.60 sits
   in the middle at 97.8% precision. Bars around 0.35 reach 81% but cost 5 points of precision.

The suggestion slip and run mode are untouched (they still use the add forecast; `TestSuggestionsParityAcrossModes`).

## Bar sweep (score × need)

| run score ≥ | need ≥ | adds | precision | open recall | F1 | removals / wk |
|---:|---:|---:|---:|---:|---:|---:|
| 0.35 | 0.60 | 104 | 93.3% | 71.9% | 81.2% | 0.03 |
| 0.45 | 0.60 | 97 | 93.8% | 67.4% | 78.4% | 0.02 |
| **0.50** | **0.60** | **89** | **97.8%** | **64.4%** | **77.7%** | **0.01** |
| 0.55 | 0.60 | 88 | 97.7% | 63.7% | 77.1% | 0.01 |
| 0.65 | 0.60 | 82 | 97.6% | 59.3% | 73.7% | 0.01 |
| 0.80 | 0.60 | 35 | 100% | 25.9% | 41.2% | 0 |

## What is still missed (golden, default bar)

29 run score below the bar (skippy items: bought in 6–7 of 8 predicted runs), 9 cycle closed or too few
purchases (fewer than four), 8 never bought before, 2 other. The lookalikes persona stays low (16.7%): each
spelling's purchases are judged on their own, so a thing written three ways rarely has four purchases under
one name. Merging look-alike purchases in `Assess` is the next lever.

## Limits

- The replay knows when each run actually happened; the server acts on the predicted `RunPlan`. A missed
  run prediction means assist adds nothing that run (precision does not suffer; real adds per run will be
  lower).
- The golden and hold-out households are synthetic. No dev dataset exists locally and production data was
  not touched: run `suggest-eval autopilot -away-from-trips` against a real database before relying on these
  numbers for real houses.
