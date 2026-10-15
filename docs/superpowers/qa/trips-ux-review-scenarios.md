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

**Look and flow, not just function.** For every screen and flow, capture screenshots and judge them
as the product owner would, in addition to the measurements:
- Does it read calmly?
- Is there one clear focus?
- Do columns look aligned to the eye (optical, not only numeric)?
- Does each step lead naturally to the next (where did my action go, what changed, what's next)?
- Do transitions and states (hover, drag, drop, empty, loading) feel finished?

Record a one-line visual judgement next to each numeric check. A passing measurement with a ragged
look is still a finding.

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

### S13. CRUD for every entity

Run this matrix twice:
- **Pass A:** against the mock (`VITE_MOCK_TRIPS=1`).
- **Pass B:** against the real Go backend and Mongo. Run `docker compose up -d mongo mongo-rs-init`, start the API on `:8080`, and run the frontend without `VITE_MOCK_TRIPS`. Use a test account created for this run, and a second test account joined to the same House for the two-person checks.

For every operation, check both columns:
- **Works:** the UI updates instantly. After a reload it is still there (pass B: it's in Mongo). The other member sees it after their next sync. An offline change syncs on reconnect.
- **UX follows guidance:** the rule in the last column. These rules come from the product owner's feedback, recorded in brief sections 6a–6h.

| Entity | Op | How | UX rule to verify |
|---|---|---|---|
| Trip | Create | House → Trips pill → New trip | Asks **only the name** (one field + yellow key); icon defaults to 🧳 |
| Trip | Read | House trip rows; trip page | Rows mirror list rows; trip page is a paper stack; now-trip first |
| Trip | Update | Trip settings: title inline, icon sheet, Where, When | No boxed inputs, no labels, autosave, travel icons only, one range calendar |
| Trip | Delete / restore | Settings → Delete trip (last, quiet red) → confirm; restore from the banner | Confirm mentions 30-day restore; a "Restore" banner appears for other members |
| Todo (on a day) | Create | The single add bar (quick capture) and the expand → sheet | **One** add bar per screen; Enter adds instantly; expand only after typing |
| Todo | Read | Plan rows; Next stop card; detail sheet | Rows ≤2 lines; heading = place; no stray chips |
| Todo | Update | Tap row → sheet: title, place, day/time/duration chips, category, notes, tick | Sheet hierarchy per 6f; no Save button; chips not inputs |
| Todo | Delete | Swipe left (mobile), hover trash (desktop), red Delete in sheet | Undo toast ~5s, same as Lists; no delete on the Next stop card |
| Todo | Reorder / move | Long-press drag, hover handle, Alt+↑/↓, day chip in sheet | Untimed keep dragged position; timed re-slot by time |
| Idea (no day) | Create / update / delete | Ideas tab, with the add bar targeting Ideas | Same row and sheet components; move to a day via the day chip or drag (desktop drawer) |
| Booking | Create | Bookings tab → add opens the booking form directly | Same sheet anatomy; kind, both ends, zones, code |
| Booking | Read | Bookings tab; Plan stubs (tonight's stay + next only); Show code slip | Code hidden by default; slip does not reflow the card |
| Booking | Update / delete | Booking sheet; swipe | Deleting a linked booking clears the link on its todo (subheading updates) |
| Todo ↔ booking link | Create / delete | Sheet → "Link a booking" / unlink | Deck shows the todo, not a duplicate booking card |
| Day label | Create / update / delete | Day header (suggested locality shown muted) | Inline edit; clearing restores the suggestion |
| Route stop | Create / reorder / delete | Settings → Where sub-sheet | Search to add, drag handle, swipe to remove; first stop = destination |
| Packing list | Create / open | Settings → Packing list | "Make a packing list" when unlinked (online only); "N items ›" when linked |
| Next-stop preference | Update | Settings "Just for you", UserSettings → Trips | Saved to the account (survives another browser); offline disabled |

**Two-person checks (pass B only):**
- Both users edit the same todo title while one is offline. The newer edit wins, and the loser sees the inline "changed this after your offline edit" note.
- One user deletes a booking while the other is linking it. The link is rejected, and the optimistic state reverts with a toast.

**Record the results** for each row as works pass/fail plus UX pass/fail, with notes, in the dated results file.

### S14. Alignment audit (run on every screen, at 375 and 1280)

Every line inside a sheet follows one row grid: `[lead 24] 12 [time 44] 12 [title 1fr] [trail]`. Paste this into the console on the trip page and on each sheet. It prints the left x of each column for every row-like line. Within one sheet, all values in a column must be equal (±1px).

```js
(() => {
  const L = (e) => (e ? Math.round(e.getBoundingClientRect().left) : null)
  const lines = [...document.querySelectorAll('[data-row], .trip-row-line, [class*="stub"], [class*="day-head"]')]
  return lines.map((l) => ({
    text: l.innerText.trim().split('\n')[0].slice(0, 30),
    lead: L(l.querySelector('input[type=checkbox], svg')),
    time: L(l.querySelector('[class*="time"]')),
    title: L(l.querySelector('[class*="title"], strong, b')),
  }))
})()
```

Also check by eye:
- Day headers, section titles and the "N days done" line start at the lead column.
- The Next stop card's checkbox, heading, subheading and buttons align to its own lead and title columns.
- The left and right inner padding of each card or sheet is equal.
- Nothing touches a card edge.

### S15. Desk flows (desktop planning, ≥1024), run as real use, not as static shots

Run each flow with a real mouse or trackpad (and once with touch emulation at 1180×820). Capture a
screenshot at each step, and write a one-line look-and-flow judgement for each.

1. **Independent scrolling:**
   - Scroll the Ideas pane to its end; the Days pane must not move.
   - Scroll Days; Ideas must not move.
   - The wheel over the map scrolls nothing (or zooms the map, desktop).
2. **Plan a day from scratch:** on an empty trip (Ghent), add three ideas with the composer, then drag
   each onto a different day. Watch the auto-scroll, the drop slot, the toast and Undo.
3. **Long trip:** drag an idea from the bottom of Ideas to the last day. Hold near the edge and let
   auto-scroll carry Days. Then try the jump rail.
4. **Edit in place** (the Days pane's scroll position must not change when the inspector opens, switches or closes): open the inspector on one row and change the day, time, place and category.
   Count the clicks (target ≤5). Press J/K through 5 items without closing.
5. **Delete fast:** delete an idea with the hover trash, with Delete, and with a swipe (touch), then
   Undo each one.
6. **Geography check:** scroll Days. The map follows each day and the sticky day header matches it.
   Drag an idea over days and the map previews the idea's place.
7. **Leave and return:** open Trip settings, go back, and check both panes keep their scroll.
9. **Map interaction (both map modes):**
   - Run once with no key (the interactive preview) and once with `VITE_PMTILES_URL` (real MapLibre).
   - Zoom with the wheel, a pinch and +/−; drag to pan.
   - Fit day resets; a manual pan pauses follow-scroll.
   - The map is view-only: clicking the map or a Google POI does nothing; clicking a pill selects
     its row (inspector opens, the camera stays).
   - Labels and pips don't collide; clusters split when you zoom.
10. **Place autocomplete** (Google Places with the key in `frontend/.env.development.local`; no key gives the labelled demo list):
    - The add bar suggests places ("Powered by Google"). The slips rise **above** the bar, so ↑ then Enter picks one, with the map preview pin showing.
    - The pick stores only `{source:'google', place_id, lat, lng, coords_fetched_at}` and a blank title; the row and the inspector title both read the Google name.
    - Typing a time first still parses.
    - Search, pick and clear work in the desktop inspector, the phone picker and the booking From/To fields.
    - The degraded message shows when search is unavailable.
8. **Before → during:** switch `?mockPhase=during`. The Next stop card replaces Ready to go, and
   nothing else jumps.

A flow passes only if it works **and** reads calmly, with no jank, jumps, misalignment or confusing
state at any step.

### S16. Smooth editing (no jumps), desktop inspector and phone sheet

Watch the layout while you edit, not just the result. Instrument with a `layout-shift`
`PerformanceObserver` (log each entry's sources and their dy/dh) plus a per-frame sampler of the
edited row, the inspector/sheet and the add bar, and the Days pane's `scrollTop`.

1. With an item open in the desk inspector: type in the title, pick a length, a category, type a
   three-line note, tick and untick done. **Expect zero layout shifts** and no movement of the
   header, the rows or the inspector. (A transient "Syncing…" line used to push the plan down
   32px on every save; it now shows only for a sync still waiting after 2 s.)
2. Change the time so the row reorders: the row moves to its slot, stays selected and in view; the
   Days pane does not scroll.
3. Add from the bar, then delete with Undo: rows above the edit never move; rows below move by
   exactly one row; the pane keeps its scroll.
4. Move the item to another day: the day it left closes the gap; nothing above it moves.
5. Phone (375): open a todo sheet and repeat 1. The sheet keeps its top and height; only a
   picker's own slide registers.

Script used in the 2026-10-15 final QA: `.playwright-mcp/smooth.js` (local, not committed: it
holds a test account key).
