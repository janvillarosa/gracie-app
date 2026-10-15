# Trips UX review scenarios

A manual UX walkthrough of the Trips feature (and the House navigation it changed), run in a real
browser at phone and desktop sizes. Any agent or person can replay it. Findings go in a dated
results file next to this one (`trips-ux-review-YYYY-MM-DD.md`), one row per finding.

Review it the way the product owner would. Their bar, in their own words:
- "simple yet sophisticated UI that runs lean even on old systems"
- "If it's too complex, I won't use this"

The design source of truth is `docs/superpowers/specs/2026-10-15-trips-ui-brief.md`, sections 6a–6h.
Where those sections conflict with section 6, they win.

## Setup

```bash
cd frontend && VITE_MOCK_TRIPS=1 pnpm dev --port 5174 --strictPort --host 127.0.0.1
```

- The mock signs you in as "Jan". The housemate "Mia" authored most of the seed.
- Seed trip: `/app/trips/trip_00000000000000000000000000000001` (Lisbon & Porto, 9 days).
- Phase switch: `?mockPhase=before|during|after`. The default is `during`, day 3. It sticks per tab.
- Run every scenario at both viewports:
  - **Mobile:** 375×812. Spot-check 320×640 for cut-offs.
  - **Desktop:** 1280×800. Spot-check 1440×900 and 1024×768.
- Reset viewport emulation between runs. Reload after switching size so load-time layout re-runs.

## What to judge on every screen

Score each screen against these seven lenses. Log a finding whenever one fails.

| # | Lens | Ask |
|---|---|---|
| L1 | Ease of use | Can the main task be done in one obvious step? Is every control's meaning clear without a label hunt? |
| L2 | Hierarchy | Is there exactly one most-important thing? Does the eye go there first? Do levels read trip → day → item? |
| L3 | Simplicity / noise | Can anything be removed without loss? Duplicate controls, redundant labels, counts nobody needs, decoration? |
| L4 | Spacing / layout | Consistent rhythm? Aligned edges? More space above a heading than below it? Nothing crammed or floating? |
| L5 | Typography | Weights and sizes follow one scale: H1 trip title, H2 day header, 15–16px/600 row title, 13px muted meta. No stray bold, no too-light text. |
| L6 | Cut-offs | Is any text truncated without intent, any control clipped, overlapped by a fixed bar, or pushed off-screen, at 375 and 320? |
| L7 | Bauhouse system | Paper stack, pill nav, yellow key, List-style rows, stamps, Outfit/Figtree, existing motion. Anything off-system, stock Ant, or a new pattern? |

Log each finding with these fields:
- **ID**
- **Viewport:** M (mobile) or D (desktop)
- **Screen / element**
- **Lens**
- **Severity:** blocker, major, minor or nit
- **What I saw:** include a screenshot path if you can
- **What it should be:** the fix

## Scenarios

### S1. House page and pill nav
1. Open `/app`. The House header sheet sits on top and the **Lists · Trips** pill is below it, with the section's yellow key on the right.
2. Tap **Trips**:
   - The URL becomes `/app/trips` and the content swaps with sheet motion.
   - The yellow key reads "New trip".
   - The live trip shows a yellow dot on the pill.
3. Check trip rows. Each has an icon circle, a title, one meta line and a yellow chevron. The trip happening now is first. Upcoming trips come next, then drafts. Past trips fold into "N past trips · Show".
4. Tap "Show" on past trips. Then press the browser Back button: you return to Lists. Reload: the last pill is remembered.
5. Open each row's ⋮ menu (Rename, Trip settings, Delete) and cancel every action.
6. Keyboard: Tab to the pill, use the arrow keys to switch, and check the focus ring.
7. Lists pill: the packing list row shows 🧳 and "For Lisbon & Porto".

### S2. Create a trip
1. Trips pill, then **New trip**. The modal asks **only for a name**: one field and the yellow key.
2. Submit an empty name (it should be blocked, with a clear message). Then submit "Weekend away".
3. You land on the new trip. The empty plan says "Where to first?" and shows the add bar and a gentle "When are you going?" prompt.
4. Back on the House Trips list, the trip is under Drafts with "No dates yet".

### S3. Trip page, during (`?mockPhase=during`)
1. First viewport: the trip header has the 🧳 icon, title, "Day 3 of 9 · Thu 15 ▾", avatars and the "N things to look at" pill on one line. The **Next stop** card is directly below.
2. Next stop card:
   - The heading is the **place only**.
   - The subheading reads like "10:00 · Timed entry · Booked".
   - A checkbox sits beside the heading.
   - **Open Maps** is the only yellow key.
   - There is no count line and no Skip.
3. Tick the checkbox. The highlighter and confetti play, the next card is dealt, and focus moves to it.
4. **Show code** opens the ticket slip (a sheet on mobile, a popover on desktop). Check that Copy shows "Copied" and that the slip closes by tapping outside, by Esc and by swiping down. The card must not reflow.
5. Tap "Open Maps". It opens an external maps URL in a new tab. Don't complete anything there.
6. Tap "Day 3 of 9 ▾". The day list opens with House-style rows. Pick Fri 16: the page scrolls to it and expands it.
7. Tap the "things to look at" pill. A popover lists the gaps, and each one scrolls to its target.
8. Done days fold into one quiet line. Tap it to expand and again to fold.
9. "Later today" rows are at most two lines, with no stray chips, handles or trash icons.
10. Turn the account setting off (S7.6), come back, and check there is no deck.

### S4. Rows: tick, edit, delete, reorder
1. Tick a row. It strikes through with the highlighter. Untick it.
2. Swipe a row left on mobile. The red action appears, and a full swipe deletes it with an Undo toast. Tap Undo and the row returns.
3. On desktop, hover a row. The trash and handle appear only on hover. Delete it, then Undo.
4. Long-press a row on mobile and drag to reorder. On desktop, use the hover handle and Alt+↑/↓. Then use "Move to…" with the keyboard only.
5. Drag an untimed row between two timed rows. It stays there. Then set it a time: it re-slots by time.
6. Finish a day by ticking its last item. The Day done stamp plays for about 1s, then the day folds to a slim line. Untick an item: the day unfolds.

### S5. Add flow
1. There is **exactly one** add bar on the screen, matching the List add bar, with the day chip in the placeholder ("Add to Today ▾").
2. Type "14:00 Pena". Place slips rise. Arrow keys move through them, Enter picks one, and Esc closes them.
3. Type "Coffee" and press Enter. The todo is added instantly to the chosen day, and the page scrolls to it.
4. Type something and use the expand control (or Shift+Enter). The edit sheet opens prefilled. The expand control is not visible before typing.
5. Change the day chip to another day, then to Ideas. On the Ideas tab, the target is Ideas.
6. On desktop, `n` or `/` focuses the bar, but only when no field has focus.
7. Mobile: the add bar is never covered by the Map handle or the keyboard. Test with the visual viewport.

### S6. Edit sheet (todo and booking)
1. Tap a row. The sheet (mobile) or the panel over the map (desktop) opens. Check:
   - There's no duplicated title and no field labels or boxed inputs.
   - The checkbox sits beside a large editable title.
   - A place row is next, then the when-chips, the category stamps, "Link a booking" and borderless notes.
   - At the bottom are Open in Maps, the authorship line and a red Delete.
2. Edit each part:
   - Rename the title.
   - Change the place through search and Back.
   - Set the day, time and duration chips. The duration chip is hidden until a time is set.
   - Change the category.
   - Link a booking and see Show code appear.
   - Write a note.
   - Close the sheet and confirm every change persisted with no Save button.
3. Open a booking (Bookings tab). It has the same anatomy, a from → to block with zones, and the Show code slip.
4. Close the sheet by swiping down, by Esc, by tapping outside, and with the desktop X. Focus returns to the row.
5. Check for long content: a 200-character title, a long place name and a long note. Nothing is cut off and nothing overflows.

### S7. Trip settings
1. Open ⋮ → Trip settings. Back is the TopNav "‹ Lisbon & Porto", with no extra Back button.
2. The identity block is the icon circle plus an inline-editable title. The icon sheet shows the **travel** set only.
3. **Where**: "Lisbon → Porto ›". Add a place, drag to reorder, swipe to remove. There is no separate Destination field.
4. **When**: one range calendar. Pick start then end. A single day works. Clear dates.
5. **Packing list**: shows "N items ›" because the seed is linked, and opens the List.
6. **Just for you** switch: toggle it. Check the helper text and the optimistic update. Offline (DevTools), it is disabled with "Connect to change this".
7. **Delete trip** is last, as quiet red text. The confirm copy mentions the 30-day restore. Cancel it.

### S8. Ideas and Bookings tabs
1. Ideas: the list and add bar target Ideas. On desktop, the Ideas drawer over the map lets you drag an idea onto a day, and "Move to…" also works.
2. Bookings: grouped by kind, as quiet rows. Past bookings are stamped "Used" and folded. Show code works here too.

### S9. Desktop map and panes
1. The spine is on the left and the map on the right. Scroll the spine: the map follows the day in view, its route in the day colour, with numbered pins and other days dimmed.
2. Hover a row and its pin lifts. Click a pin and the row scrolls into view with the highlighter.
3. With no tiles (`VITE_PMTILES_URL` unset), pins draw on a plain ground with "Offline map" and the OSM attribution.
4. 1024×768: the map is a collapsible pane. Check that nothing overlaps.

### S10. Before, after, empty and offline states
1. `?mockPhase=before`: there is no deck, the header shows the dates, and the plan opens at the first day or Ideas.
2. `?mockPhase=after`: the trip reads as past, and editing needs "Edit anyway".
3. A new empty trip shows "Where to first?" and no grid of empty days.
4. Offline (DevTools → Offline): tick, add and edit still work, and the header note reads "Saved on this device · syncs when online". Go back online and the note clears.

### S11. Performance on an old device
1. DevTools: CPU 6× slowdown, Fast 3G. Load the trip.
   - Is the first meaningful paint quick?
   - Does the map JS load only when the map is shown? Check the Network tab.
   - Does scrolling stay smooth?
2. Record the gzipped size of the trip route chunk and the map chunk (`pnpm build` output).

### S12. Accessibility pass
1. Run S3–S7 keyboard-only, with visible focus everywhere.
2. Sheets trap focus and return it on close.
3. Reduced motion (DevTools rendering): there is no slide, deal or confetti motion, and only instant swaps.
4. Hit targets are at least 44px on mobile, and text contrast meets WCAG AA.
