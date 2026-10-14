# List page: autocomplete, rows and navigation (design brief)

Status: draft, awaiting confirmation. Shape output only; no code yet.

## 1. Job and audience

A housemate standing in a kitchen or a supermarket aisle, phone in one hand, adding or
ticking off items fast. Mode: **Operate**. Speed and scanability outrank expression;
brand lives in the details (paper surfaces, category stamps, highlighter sweep, confetti).

## 2. Outcome and proof

- Adding a repeat item takes 2–3 keystrokes and a tap, and the row lands already
  categorised (the pantry knows the category, so no wait for the categoriser).
- About twice as many rows fit on a phone screen (today: ~4).
- Navigation reads as navigation: Back lives in the top bar, not next to a view toggle.

## 3. Selected direction

Stays inside the incumbent world (Outfit/Figtree, brand yellow, paper cards, category
colours, existing motion tokens). No new visual language.

**Autocomplete signature: the "pantry slip".** Suggestions rise out of the sticky add bar
as a short stack of paper slips (the bar is at the bottom, so they open upward). Each slip
shows the name with the typed prefix in the existing highlighter-yellow mark, the house's
usual quantity ghosted at the right ("1 kg"), and its category colour as a stamp on the
slip's edge. The top match also shows as ghost text inside the field (type "bas", see
"mati rice" muted; Tab or → accepts). Picking a slip drops it into the list using the
existing row entrance, with the category stamp already on.

## 4. Scope and boundaries

In scope:
- **Backend:** extend `GET /rooms/{room_id}/pantry` to aggregate over all of the room's
  items (active + archived), keyed by `parse.NormalizeKey(description)`, returning
  `description, category, quantity, unit, times_added, last_added_at`. For a room with
  little history, append the grocery anchors as low-ranked "common" entries, so new
  houses also get suggestions. Mongo aggregation; integration test required.
- **Frontend:** `AddItemBar` gains the combobox; `ItemRow` is rebuilt; list header and
  `TopNav` change on the list page.

Anti-goals:
- Never take over Enter. Enter with no highlighted slip adds exactly what was typed.
  The instant-add loop from `6a157dc` must not slow down.
- No network request per keystroke. Fetch the pantry once (`['pantry', roomId]`, long
  staleTime), filter on the client, update the cache on each add.
- No duplicate-on-list detection (not chosen this round).
- No change to internal names or `/rooms/*` endpoints (branding rule).

## 5. States and ranges

- Pantry size: 0 (new house) to ~1,000 entries. Show at most 4 slips on mobile, 6 on desktop.
- Quantity prefix: "2 kg bas" parses first, matches on "bas", keeps the typed 2 kg (the
  typed quantity beats the usual one).
- No match: no slips, no "no results" row. The field behaves as it does today.
- Pantry fetch fails or loads slowly: the bar works exactly as today; suggestions are
  only an addition.
- Long names: one line with an ellipsis on a slip; rows wrap to at most 2 lines.

## 6. Interaction and layout

**Autocomplete**
- ARIA combobox pattern: `role="combobox"` on the field, `listbox`/`option` slips,
  `aria-activedescendant`, ↑/↓ to move, Enter picks the highlighted slip, Esc closes,
  Tab accepts the ghost text. Announce the count politely ("3 suggestions").
- Ranking: prefix match on any word > substring; then a mix of `times_added` and recency.
- Mobile: position against `visualViewport`, so slips sit above the keyboard. Each slip
  is at least 44px tall. Tapping a slip keeps the keyboard up for the next add.
- Motion: slips rise and stagger in about 120ms with `--ease-out`; picking one slides it
  into place. Reduced motion: a plain fade, no ghost-text animation.

**Rows**
- One line: `[checkbox] Name  1 kg ……… ● Bakery`. The quantity is inline, muted, with
  tabular numbers. The "Quantity:" label goes. The category moves to a small trailing
  stamp, and is hidden in grouped view because the section header already says it.
- Delete: swipe left on touch shows a red action; a full swipe deletes. On desktop, a
  neutral trash icon shows on hover and focus-within and turns red on hover. Every delete
  gets an **Undo** toast (hold the request about 5s instead of re-creating the item).
- Reorder: the handle shows on hover on desktop; on touch, long-press anywhere on the
  row to lift it (keeps the 300ms TouchSensor delay, gives a haptic tick and a lift
  shadow). The always-visible handle on mobile goes away.
- Checkbox keeps a 24px visual size with a 44px hit area. Confetti and the highlighter
  sweep stay.
- Completed: replace the "Show completed" item hidden in the ⋮ menu with a footer row at
  the end of the list, "3 checked off · Show".
- Grouped view: sticky section headers with counts ("PRODUCE · 4").

**Navigation and header**
- On the list page the top bar shows a back chevron and the house name on the left
  (it navigates to `/app`), and the avatar stays on the right. The logo stays on the
  dashboard.
- Header: icon + title with ⋮ at the far right; one meta line, "10 to get · updated 38m
  ago"; the description below only when set.
- The tab strip row holds Items (count) / Notes (a dot when notes exist) on the left,
  and the "By category" toggle with `aria-pressed` on the right. It no longer sits in
  the header.

## 7. Constraints and open decisions

- Keep `ItemRow` memoised; keep the autocomplete state inside `AddItemBar` (performance
  rules in `frontend/CLAUDE.md`). Hover styles stay behind `@media (hover: hover)`.
- Swipe: write it by hand on pointer events (no new gesture dependency), or ask first.
- Tests: Vitest + MSW for combobox keyboard and pick behaviour, the Enter-not-hijacked
  case and swipe-delete with undo; a Go service test and a Mongo integration test for the
  aggregation; bump the coverage ratchets.
- Open: whether the list title should fold into the top bar on scroll. Proposed as a
  later step, not part of this build.
