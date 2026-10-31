# Lists

Household lists: the add bar, rows, undo. Core server flows (signup, share, join, deletion) are in [backend/CLAUDE.md](../../backend/CLAUDE.md).

## Frontend (list page)

_Frontend paths are relative to `frontend/src/`._

- **Add-bar suggestions:** `AddItemBar` is an ARIA combobox fed by `GET /rooms/{id}/pantry`
  (fetched once in `ListPage`, filtered client-side by `lib/suggest.ts`). Enter only takes a
  slip the user explicitly arrowed to; otherwise it adds the typed text. Each pantry entry carries the item's usual quantity (the most common of its last 10 adds), which a picked slip pre-fills. `ListPage.bumpPantry`
  keeps the cached pantry current after each add.
  - **Spelling variants are one entry.** The pantry groups adds by `parse.CompactKey` (spaces,
    hyphens and simple plurals folded), so "Chick peas", "Chickpeas" and "chickpea" share their
    history. The entry is named with the spelling the house uses most (ties to the newest).
    `lib/itemKey.ts` mirrors `CompactKey` in the browser; keep the two in step.
  - **Ranking tiers:** prefix, later word start, substring (3+ letters), then folded spacing and
    plurals ("chick pea" finds Chickpeas), then a typo away (5+ letters, same first letter:
    "bananna" finds Bananas). The last two highlight the whole name and show no ghost text.
  - **On the list already:** a slip for an item on the list says "on list" (or "checked off").
    Picking it calls `ListPage.onBumpItem` instead of adding a row: a checked-off row comes back,
    an open one gains the typed amount when the units agree, else one (`lib/bumpQuantity.ts`); a
    quantity that isn't a plain number is left alone with an "Already on the list" toast. Plain
    Enter on typed text still adds a row.
- **Rows:** swipe-left (touch) and the hover trash (desktop) both go through `onDeleteItem`,
  which defers the request ~5s behind an Undo toast and flushes on unmount. **Clear completed**
  (`onClearCompleted`) works the same way: rows leave at once, the `/clear` request waits for the
  toast to close, Undo cancels it.

## Desk (1024px and wider)

Brief: `docs/superpowers/specs/2026-10-24-list-desk-brief.md`; plan: `docs/superpowers/plans/2026-10-24-list-desk.md`.

- **Layout:** `ListPage` branches on `useMedia(WIDE)`. Below 1024px the page is the phone layout (tabs, bottom add bar, one
  floating slip). From 1024px it is two panes in `.desk-frame` (1120px): the list (header sheet and list sheet, scrolling
  under the floating composer) and a 340px side column (`--side-col`) with a Butler sheet over a Notes sheet. The shell
  (`html.desk-shell`, `.desk-page`) and the composer (`.desk-composer`, placed by `useComposerBox`) are shared with the trip
  desk: `desk.css`. The window does not scroll on the desk; the class is removed on unmount and when the window narrows.
- **Butler** is the same slips as on a phone (Up next, the Butler-added slip, the suggestion) in `SlipStack layout="column"`,
  all at once. It is hidden when the House's mode has none of `suggestions`, `auto_add` or `up_next` (ask `hasFeature`, never the
  mode string). With nothing to show: "Nothing due yet." Notes keep the manual Save, and unsaved text survives a resize across
  1024px (the buffer lives in `ListPage`).
- **Rows and groups:** 44px rows. Grouped view's category headings are fold buttons (`foldedCats`, not remembered).
- **Keyboard:** `/` or `n` focuses the composer (`useAddBarShortcut`, shared with trips, never while typing); an empty list
  focuses it on load. `useRowKeys` gives rows roving focus: ↑/↓, Space, Delete/Backspace (focus moves on), Enter. Each key presses
  the row's own control, so the pointer and keyboard paths are one. `ItemRow keyNav` tags the rows.

## Shopping runs (`lib/shoppingRun.ts`)

- `ListPage` fetches `GET .../lists/{id}/run-hint` once (stale after 10 min, never waited for) and feeds
  `useShoppingRun`, a pure `runReducer` behind a hook. Only check-offs count (never unchecks). A run starts when
  the last `checks_to_start` checks chain within `idle_end_min` and are not all faster than `burst_sec` (tidying at
  home); it ends after `idle_end_min` with no check. No hint: `DEFAULT_RUN_HINT` (3 / 45 min / 15 s, the server's
  `predict.RunMin` / `RunGap`).
- **Run mode:** while a run is on, the suggestions query key gains `'run'` and asks `?during=run`; the slip says
  "Usually due in 3 days" (`due_in_days`) and Ignore posts `during: 'run'`.
- **Run done:** once per run, on the last check or on Clear done, an `announce` Sheet with an `InkStamp` ("Run done", dated), "14 items · 22 min", and "4 min quicker than usual" only when ≥ 3 min quicker than the hint's `typical` and the run is at least ¾ the usual size, so a top-up shop is never "quicker" (`runDoneLines`); its key cheers, a different word each run (`CHEERS`, `nextCheer`: "Nice!", "Huzzah!", "Amazing!"..., never the same twice in a row; the last one is kept in `localStorage` `gracie_last_cheer`). The check that finishes a run throws no confetti (the stamp is the celebration; `useShoppingRun().check()` returns whether a run is on). It opens 350ms after the last check. Tracks `list.run_stamped {items, minutes}`.

## Butler on a list

Butler floats one slip at a time (`SlipStack`): while shopping, **Up next** is in front and the suggestion
slip or the "Added 3" slip wait behind it until the person puts it away with the round ✕. See
[autopilot.md](autopilot.md#up-next-the-usual-route-through-the-shop).

In assist mode Butler puts the usual things on the list before the shop: those rows carry the Butler
mark and a reason, and a slip says what was added for which run, with Undo all. Swipe-deleting a Butler
row that was not bought counts as a miss. See [autopilot.md](autopilot.md).
