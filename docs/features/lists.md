# Lists

Household lists: the add bar, rows, undo. Core server flows (signup, share, join, deletion) are in [backend/CLAUDE.md](../../backend/CLAUDE.md).

## Frontend (list page)

_Frontend paths are relative to `frontend/src/`._

- **Add-bar suggestions:** `AddItemBar` is an ARIA combobox fed by `GET /rooms/{id}/pantry`
  (fetched once in `ListPage`, filtered client-side by `lib/suggest.ts`). Enter only takes a
  slip the user explicitly arrowed to; otherwise it adds the typed text. Each pantry entry carries the item's usual quantity (the most common of its last 10 adds), which a picked slip pre-fills. `ListPage.bumpPantry`
  keeps the cached pantry current after each add.
- **Rows:** swipe-left (touch) and the hover trash (desktop) both go through `onDeleteItem`,
  which defers the request ~5s behind an Undo toast and flushes on unmount. **Clear completed**
  (`onClearCompleted`) works the same way: rows leave at once, the `/clear` request waits for the
  toast to close, Undo cancels it.

## Shopping runs (`lib/shoppingRun.ts`)

- `ListPage` fetches `GET .../lists/{id}/run-hint` once (stale after 10 min, never waited for) and feeds
  `useShoppingRun`, a pure `runReducer` behind a hook. Only check-offs count (never unchecks). A run starts when
  the last `checks_to_start` checks chain within `idle_end_min` and are not all faster than `burst_sec` (tidying at
  home); it ends after `idle_end_min` with no check. No hint: `DEFAULT_RUN_HINT` (3 / 45 min / 15 s, the server's
  `predict.RunMin` / `RunGap`).
- **Run mode:** while a run is on, the suggestions query key gains `'run'` and asks `?during=run`; the slip says
  "Usually due in 3 days" (`due_in_days`) and Ignore posts `during: 'run'`.
- **Run done:** once per run, on the last check or on Clear done, an `announce` Sheet with an `InkStamp` ("Run done", dated), "14 items · 22 min", and "4 min quicker than usual" only when ≥ 3 min quicker than the hint's `typical` and the run is at least ¾ the usual size, so a top-up shop is never "quicker" (`runDoneLines`); its key cheers, a different word each run (`CHEERS`, `nextCheer`: "Nice!", "Huzzah!", "Amazing!"..., never the same twice in a row; the last one is kept in `localStorage` `gracie_last_cheer`). The check that finishes a run throws no confetti (the stamp is the celebration; `useShoppingRun().check()` returns whether a run is on). It opens 350ms after the last check. Tracks `list.run_stamped {items, minutes}`.
