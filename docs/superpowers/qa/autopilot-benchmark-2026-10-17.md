# Autopilot assist benchmark (2026-10-17)

Command: `cd backend && go run ./cmd/suggest-eval autopilot -synthetic -away-from-trips`
(the golden households, `internal/testutil/households`, seed 20261017). Pinned by
`internal/autopilot/replay` `TestGoldenAssistMeetsGate`.

## Method

At every past shopping run on a list (runs found from check-offs with `predict.RunSpans`, after the
first four, so a run rhythm exists), the replay steps back by the ticker lead (18 h) and plans with
only the events before that moment, through the server's own code: `predict.PredictAway` forecasts,
`predict.NeedBy` at the run after next (one median run interval of home time later, as
`Reader.RunPlan` steps it), `autopilot.Rank` / `CycleOpen` / `Plan` / `Decide` at the assist bar.
Each add is scored against what the house checked off in that run (± 2 h):

- **precision**: adds bought in that run.
- **removals per house-week**: adds not bought in that run (a person would delete them, or they expire).
- **recall**: adds over everything bought in the run, one-offs included.
- **open recall**: adds over what was bought but *not already on the list* when assist planned. In
  these households people usually write things down themselves before the shop, and assist rightly
  skips those, so this is the share of the remaining writing-down that assist takes over.

## Results (default bar: score ≥ 0.80, need ≥ 0.70)

| | runs | adds | precision | open recall | removals / house-week |
|---|---:|---:|---:|---:|---:|
| **all houses** | 183 | 55 | **90.9%** | 37.0% | **0.02** |
| weekend-couple | 41 | 26 | 88.5% | 48.9% | 0.07 |
| big-family | 45 | 16 | 87.5% | 36.8% | 0.04 |
| lookalikes | 45 | 6 | 100% | 20.0% | 0 |
| bursty | 22 | 3 | 100% | 50.0% | 0 |
| frequent-travellers | 16 | 3 | 100% | 42.9% | 0 |
| monthly-stocker | 8 | 1 | 100% | 25.0% | 0 |
| habit-changer | 6 | 0 | n/a | 0% | 0 |

bin-day, solo-irregular and new-house have no replayable runs (no shopping list with a run rhythm,
or too little history) and get nothing added. Wall time and home time give the same numbers here.

**Gate (precision ≥ 85%, ≤ 1 removal per house-week): PASS.**

## Bar sweep

| score ≥ | need ≥ | adds | precision | open recall | removals / wk |
|---:|---:|---:|---:|---:|---:|
| 0.65 | 0.70 | 87 | 81.6% | 52.6% | 0.06 |
| 0.70 | 0.50 | 58 | 87.9% | 37.8% | 0.03 |
| 0.75 | 0.70 | 56 | 89.3% | 37.0% | 0.02 |
| **0.80** | **0.70** | **55** | **90.9%** | **37.0%** | **0.02** |
| 0.80 | 0.90 | 54 | 92.6% | 37.0% | 0.01 |
| 0.85 | any | 0 | n/a | 0% | 0 |

## Findings

1. **Score ≥ 0.85 adds nothing.** The forecast score is the Wilson lower bound over the latest 8
   cycles (`predict.DefaultParams.RecentCycles`), which tops out at about 0.83 for a perfect 8/8. The
   0.80 bar therefore means "right every cycle lately". Any stricter bar has to come from need, not score.
2. **Need barely moves the result.** Planning for the run after next, anything with a confident
   rhythm is almost always needed by then (need ≈ 1), so 0.5 to 0.9 changes one or two adds.
3. **The loosest bar that passes (0.70 / 0.50) buys almost nothing**: +3 adds and +0.8 points of open
   recall for 3 points less precision. The default stays at 0.80 / 0.70 for the margin; the plan's
   "loosest passing bar" rule was set aside for that reason and is Jan's call.
4. **Look-alikes lose recall** (20%): the replay forecasts each spelling on its own, while the server
   merges look-alike histories, so it understates that persona.

## Limits

- The replay knows when each run actually happened (an oracle on run timing); the server acts on the
  predicted `RunPlan`. A missed prediction means assist adds nothing that run, so precision does not
  suffer, but real adds per run will be lower.
- No dev dataset exists locally (the local `gracie` database is empty) and production data was not
  touched. Run `suggest-eval autopilot -away-from-trips` against a real database before relying on
  these numbers for real houses.
