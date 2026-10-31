# List desk (desktop list page) — brief

Status: shaped 2026-10-24, revised twice the same day (trip desk patterns; then two panes, no
usuals column). Confirmed by Jan 2026-10-24 (manual Save on notes). Plan:
`docs/superpowers/plans/2026-10-24-list-desk.md`.
Target: `frontend/src/pages/ListPage.tsx` at `WIDE` (1024px and wider, `useMedia.ts`). Mode: Operate.

## 1. Job and audience

A House member at a laptop, before the shop. They **build and tidy** the list: type many items in a
row, take Butler's suggestions, write a note for whoever shops, clear what's done. Checking off
happens on the phone in the shop; on desktop it is secondary but still one click.

## 2. Outcome and proof

- Adding ten items is ten lines of typing and Enter.
- Butler's suggestions and the notes are on screen next to the list, not behind a tab or a
  floating slip.
- A typical list (10–40 items) is readable on one 900px-tall screen.

## 3. Direction: two panes on the trip's desk

The list page borrows the trip planning desk's frame, so the two read as one product, but with two
panes instead of three. No new visual world; existing tokens, `Paper`, `PaperStack`, `Button`,
slips, the row grid.

- **Frame:** centred, like the trip desk. The window does not scroll; each pane scrolls on its own.
- **Left pane, the list** (fills the rest): the header sheet (icon, title, "9 to get · updated just
  now", menu), then the list sheet. The add bar is the trip's floating **composer** at the foot of
  this pane, with a `/` key cap; its pantry slips open upward, as today.
- **Right pane, the side sheet** (about 340px), one `PaperStack` with two parts:
  1. **Butler** (bell mark): the slips the phone floats one at a time, laid out together: Up next
     (only during a shopping run), the suggestions with Add / Ignore and their reason ("Usually due
     in 2 days"), and "Added 3 · Undo all". With nothing to show, one quiet line: "Nothing due yet."
     Butler off for the House: this part is not shown.
  2. **Notes**: the list notes text area and its Save key, always open, filling the rest of the pane.
- The Items · Notes pills go away on desktop. The grouped-view toggle stays on the list sheet.
- The same two panes at every width from 1024px; no third column and no breakpoint at 1200px.

## 4. List sheet

- Grouped view: each category is a section heading like a trip day ("Produce · 3", with the
  collapse chevron). Ungrouped stays the hand-ordered list.
- Rows use the **row grid** with the time column at 0: checkbox lead, name, quantity (muted,
  tabular), Butler mark, category stamp in the trailing slot (hidden in grouped view, where the
  heading already says it). Hover shows the drag handle and trash, as today.
- "Show checked-off items" and Clear completed stay at the foot of the sheet, above the composer.

## 5. Scope and boundaries

- Production-ready, list page only, at 1024px and wider.
- **Below 1024px nothing changes**: phone and tablet keep the bottom add bar, tabs, floating
  `SlipStack` and swipe. Lists index, trips and print (`ListPrint`) are untouched.
- Not included: a usuals/pantry column, an item inspector, multi-select or bulk edit.
- Anti-goals: no table look, no new Ant components, no raw values outside tokens, no copy beyond the
  lines quoted here.

## 6. Keyboard (visible, few)

| Key | Does |
|---|---|
| `/` or `N` | Focus the composer (anywhere outside a text field) |
| `Esc` | Leave the composer |
| `↑` `↓` | Move between rows (roving focus) |
| `Space` | Check off / un-check the focused row |
| `Delete` / `Backspace` | Delete the focused row, with the usual 5s Undo toast |
| `Enter` | Edit the focused row's name |

Drag reorder keeps its keyboard path. Rows carry `aria-keyshortcuts`.

## 7. States and ranges

- Items 0–80 (typical 10–40); suggestions 0–3; notes from empty to a few paragraphs (the Notes part
  scrolls inside the pane).
- Empty list: composer focused on load; the existing empty state in the list sheet.
- Loading: row skeletons in the list; the side sheet shows its headings.
- Run done: the announce sheet is unchanged.

## 8. Constraints and implementation notes

- Reuse the trip desk's frame and composer CSS rather than copying it: lift the shared parts
  (frame, pane scroll, composer position) into desk classes both pages use.
- New token if needed: `--side-col` (340px) in the `:root` block, then `pnpm design:sync`; DESIGN.md's
  Layout section gains a "list desk" paragraph.
- `ListPage` branches on `useMedia(WIDE)`; `SlipStack` gains a column layout for the Butler part.
- Tests: wide-width `ListPage` (two panes, no tabs, Butler and Notes visible), Butler empty and off
  states, shortcut handling, phone path unchanged.

## 9. Open for Jan

- Notes keeps the manual Save (proposed) vs. autosave.
