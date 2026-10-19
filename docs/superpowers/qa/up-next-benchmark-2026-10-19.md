# Up next benchmark, 2026-10-19

`go run ./cmd/suggest-eval upnext -synthetic` replays the route personas (`internal/testutil/households/routes.go`,
seeds 1 to 6, 24 runs each) at every run, learning the route from the runs behind it only. A **hit** is the item
Up next names being checked within the next two check-offs (`predict.RouteHitWindow`).

## Ship bar (pinned by `internal/autopilot/replay/upnext_test.go`)

- Pooled hit rate where it speaks >= 70% (`replay.UpNextHitGate`), on seed 1 and on hold-out seeds 2 to 6.
- Silent (never speaks) on `two_stores`, `random` and `top_ups`.
- Speaks on at least half of `steady`'s eligible runs.

## The bar (`autopilot.DefaultPolicy`): >= 5 runs, score >= 0.60

Sweep of `UpNextMinScore` over six seeds (pooled hit rate, coverage, runs where a house that must stay silent spoke):

| score | hit rate | coverage | silent violations |
|---|---|---|---|
| 0.40 | 73.5% | 52% | 12 |
| 0.45 | 80.3% | 41% | 11 |
| 0.50 | 83.9% | 37% | 1 |
| 0.55 | 84.8% | 34% | 0 |
| **0.60** | **86.5%** | **31%** | **0** |
| 0.65 | 88.6% | 28% | 0 |

0.55 to 0.65 never speaks for a house with no consistent route; 0.60 is the middle. Past 0.60, `habit_change`
(the store was rearranged) loses coverage (77% to 68% at 0.60, 61% at 0.65), which is the trade for being silent
rather than wrong.

## Seed 1 by persona (bar 0.60)

| persona | spoke | hits | hit rate |
|---|---|---|---|
| steady | 19/24 | 199/207 | 96.1% |
| habit_change | 14/24 | 113/147 | 76.9% |
| two_members | 13/24 | 101/155 | 65.2% |
| two_stores, random, top_ups | 0 | 0 | silent |

`two_members` (two people with different walks, 70/30) is the weak case: it speaks and is right 65% of the time
on seed 1 (about 75% pooled over six seeds). It is not asserted on its own; the pooled gate holds.

## Real data (deploy gate, not a merge gate)

Before deploy: `suggest-eval upnext` against the production database (read-only). Record coverage and hit rate
here. Below the bar real houses stay silent by design; what must not happen is Up next speaking and being wrong.

Real-data run: _not yet run_.
