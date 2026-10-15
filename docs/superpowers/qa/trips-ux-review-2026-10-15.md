# Trips UX review — 2026-10-15 (round 1)

- **Scenarios:** `trips-ux-review-scenarios.md`.
- **Build:** frontend `760c6ce` (worktree `agent-afb28f0fb1af0d0fd`), mock trips (`VITE_MOCK_TRIPS=1`).
- **Mobile:** 375×812 in the in-app browser.
- **Desktop:** 1280×800 in headless Playwright.

Reviewed as the product owner: "simple yet sophisticated", "If it's too complex, I won't use this".

**Coverage this round:**
- Run: S1, S2, S3, S4 (partly), S5 (visual), S6, S7, S8, S9.
- **Not yet run:**
  - S10 (before/after/offline)
  - S11 (performance)
  - S12 (keyboard and reduced motion)
  - S13 pass B (CRUD against the real backend)
- The unrun scenarios run in the verification round after fixes.
- **Not verified with a mouse:** swipe-to-delete is touch-only. The code reuses the List `useSwipeToDelete` hook, which is correct by inspection.

Severity: **B** blocker · **Ma** major · **Mi** minor · **N** nit. Viewport: **M** mobile · **D** desktop.

## Findings

### Trip page: structure and first viewport
| ID | VP | Lens | Sev | What I saw | What it should be |
|---|---|---|---|---|---|
| T1 | M+D | L1 L2 | **B** | The page loads scrolled to `?day=today`. The header and the Next stop card are skipped. You land mid-list. | During the trip, open at the top (header + Next stop). Only scroll to `?day=` when the URL explicitly carried one (deep link or day-list pick), and don't write `?day=` into the URL on load. |
| T2 | M | L6 | **B** | The fixed "Map · Thu 15" bar covers the add bar. The add-bar placeholder "Add a place or plan" wraps and is cut ("or plan" is clipped). Reported earlier and still present. | Remove the full-width map bar on the phone. Put a compact round map icon button in the PillNav row, right-aligned ("Map", aria-label "Show map for Thu 15"), that opens the pull-up sheet. The add bar is then the only bottom chrome. Placeholder: "Add to today". The day chip already says which day. One line, never wraps. |
| T3 | M | L2 L4 | Ma | The trip title wraps ("Lisbon / & Porto") at ~36px beside the icon. "Day 3 of 9 ▾", the avatars and "2 things to look at" break onto three lines. The ⋮ floats mid-right. | Mobile trip title ~28px, at most 2 lines. Line 2: "Day 3 of 9 · Thu 15 ▾" on the left, avatars on the right. The gaps pill moves out of the header and becomes a quiet line at the top of the Plan sheet (see T9). ⋮ sits top-right, aligned to the title's first line. |
| T4 | M+D | L2 L7 | Ma | The Next stop card sits *between* the header and the Plan · Ideas · Bookings pills. The pills look like they control only the lower sheet, and they're pushed below the fold on the phone. | Order: header sheet, then the PillNav directly under it (the second sheet's top row, as on the House page), then the Plan content. The Next stop card is the first thing *inside Plan*. Ideas and Bookings don't show the deck. |
| T5 | M | L4 | Mi | Next stop actions are stacked: Open Maps, with Show code on a second line, full width. | Same row: [Open Maps] [Show code]. The yellow key comes first. |
| T6 | M+D | L4 | Mi | After a deal, the focus ring is inset and misaligned with the card edge. The "NEXT STOP" kicker touches the ring. | Focus the card's heading (tabIndex -1) rather than the card. Use the standard `--focus-ring`. |
| T7 | M+D | L3 | Mi | After the next stop is ticked, the linked booking stub "10:00 Timed entry" still shows in Later today, as does "Tonight · Alfama flat" mid-list. | Hide booking stubs whose linked todo is done or whose time has passed. "Tonight" goes once, at the top of today, not repeated in Later today. |
| T8 | D | L1 L2 | Ma | The Next stop isn't reflected on the map. Its pin isn't drawn or highlighted, and the numbering shows 2, 4, 5, 6 (1 and 3 missing). | On the map, the next stop's pin is the emphasised one (larger, yellow ring). Number only the stops that have a place, sequentially, and keep the numbers identical to the spine. |
| T9 | M | L6 | **B** | The "things to look at" popover is clipped off the left screen edge. It doesn't close on Esc or on tab switch, so it stays open over the Ideas and Bookings tabs. | Use a bottom sheet on the phone and an anchored popover inside the viewport on desktop. Close it on Esc, outside tap and tab change. |
| T10 | M+D | L3 | Ma | Gaps include overlaps on *done, past* days ("Tue 13 has two things at the same time"). That's noise. | Only flag gaps for today and future days. |
| T11 | M+D | L4 L5 | Ma | Multi-line row titles ("MAAT and the river / walk") put the time and checkbox in the vertical middle of the 3-line block. Row heights vary a lot. | Align the checkbox and time to the first line of the title (`align-items: start`, baseline-matched). Titles are at most 2 lines. |
| T12 | D | L5 | Ma | Pin numbers are jammed against the time in the gutter: "12:30 3" reads as "12:303". | Remove the pin number from the row gutter. When the map is visible, show the number in a small circled badge *before* the time (same style as the map pin, 18px), or show nothing. Never as bare digits. |
| T13 | D | L3 | Mi | Row hover shows two drag affordances (⠿ grip outside the row *and* a ✥ move icon) plus the trash. | One grip (⠿) on hover. Remove ✥. "Move to…" lives in the edit panel's day chip. |
| T14 | D | L7 | Mi | The map reads as a placeholder: a plain grid, heavy brown route, oversized 48px pins. "Offline map" shows when tiles simply aren't configured. | Thinner route (3px), 28px pins with the day colour, and no grid lines (a flat paper-tinted ground). Label "Map preview" when unconfigured, and "Offline map" only when actually offline. |
| T15 | D | L1 | Ma | The Ideas tab replaces the spine. There's no drawer over the map, so you can't see days while sorting ideas. The map keeps showing Thu 15 instead of the ideas. | Per brief 6a: on desktop the Ideas tab opens a drawer over the map pane and the spine stays on Plan. Drag an idea onto a day header. The map shows idea pins (grey) while the drawer is open. |
| T16 | M+D | L4 | Mi | Ideas rows are indented further than Plan rows (checkbox x=122 vs 105). | One row component and one inset for Plan, Ideas and Bookings. |
| T17 | M | L3 | Mi | Ideas rows have checkboxes. An idea isn't a task. | Ideas rows: no checkbox. Leading slot is the category dot; trailing slot is a quiet "Add to day" icon button that opens the day list. |

### Bookings
| ID | VP | Lens | Sev | What I saw | What it should be |
|---|---|---|---|---|---|
| K1 | M+D | L3 L1 | **B** | Two add controls on the Bookings tab: a big "Add booking" yellow button **and** the "Add a booking" add bar. That breaks the one-add-bar rule. | Keep only the add bar. On Bookings it opens the booking sheet directly. |
| K2 | M+D | L5 L3 | Ma | Rows show raw ISO dates ("2026-10-13 · 07:05 London → 09:40 Lisbon"). The title wraps ("London to / Lisbon") because a "Show code" button sits on every row. | Row: kind icon · "London → Lisbon" (1 line) · muted "Tue 13 · 07:05 → 09:40". No Show code on rows; tap opens the booking sheet with Show code. |
| K3 | M+D | L3 | Mi | Past bookings (the Tue 13 flight) aren't stamped "Used" or folded. | Fold past bookings into "2 used · Show", with the Used stamp on each when expanded. |
| K4 | M | L7 | N | Ticket slip: the X header plus divider waste space, and "Copy" is weak grey text. | Drop the header divider. Make Copy a quiet secondary pill. Put the dashed tear edge at the top of the slip, like a ticket stub. |

### Edit sheet / panel
| ID | VP | Lens | Sev | What I saw | What it should be |
|---|---|---|---|---|---|
| E1 | M+D | L5 L2 | Ma | The title is 18px Figtree in a span, not the large editable heading. The checkbox sits lower than the title. | Outfit 24px/700, inline-editable (InlineEditText). Checkbox centred on the first line. |
| E2 | M+D | L7 L5 | Ma | The "when" chips are native `<select>` and `<input type=time>` styled as pills. Time shows "02:00 pm" while the rest of the app uses "14:00". Duration wraps to its own line even on desktop. | Real chips: tap opens a small sheet or popover (day list, time wheel or list in 15-min steps, duration presets). The time format matches the rows (24h, or the user locale consistently, everywhere). All three chips sit on one row. |
| E3 | M+D | L3 | Ma | The 7 category stamps wrap into two rows of rainbow, with a heavy blue border on the selected one. Noisy. | Show only the selected stamp as a chip ("SIGHT ▾"). Tapping opens the 7 stamps in a small popover. Selected state uses the stamp's own fill, never a blue border. |
| E4 | M+D | L3 | Mi | The place row repeats the title ("Quinta da Regaleira" / "Quinta da Regaleira · Sintra"). | When the place name equals the title, the place row shows only "Sintra" (locality) plus a pin icon. |
| E5 | M | L4 | Mi | The sheet is fixed at ~88% height with a big empty bottom. There's no drag handle. | Content-height sheet (max 90%), with a drag handle on top. |
| E6 | D | L1 | Mi | The panel over the map doesn't recentre the map on the item's pin. Pin 4 sits under the panel edge. | When the panel opens, pan so the item's pin is centred in the visible map area left of the panel. |

### House page and creating a trip
| ID | VP | Lens | Sev | What I saw | What it should be |
|---|---|---|---|---|---|
| H1 | M+D | L1 | Ma | The live-trip yellow dot on the Trips pill isn't visible in either state, even though aria-label says "one happening now". | Show a 6px yellow dot at the pill label's top-right when Trips is *not* selected. |
| H2 | M | L6 | Mi | "Somewhere warm i…" is truncated at 375px because of ⋮ + chevron. | Allow 2 lines for trip titles in rows. |
| H3 | M+D | L7 | Mi | Every seed trip uses 🧳, so the travel icons are never seen. | Seed: Lisbon & Porto 🏙️, Ghent 🚆, Somewhere warm 🏖️. |
| H4 | M+D | L7 | Ma | The New trip modal is a stock Ant modal pinned near the top. Its Figtree 18px title doesn't match House headings, and **the input isn't focused** on open. | Use the app's paper modal (match the New list modal; if that's stock too, restyle both): an Outfit title, the input autofocused, and the yellow key full-width on mobile. |
| H5 | M+D | L1 | Ma | "When are you going?" on an empty trip navigates to Trip settings. | Open the range calendar sheet in place on the trip page. |
| H6 | M | L4 | Mi | On an empty trip the map bar shows "Map · ideas" (lowercase) with no places at all. | Hide the map control until the trip has at least one place. |
| H7 | M+D | L3 | N | Rename (row ⋮) opens a stock modal with a Save button. | Fine to keep, but match H4's modal style. |

### Trip settings
| ID | VP | Lens | Sev | What I saw | What it should be |
|---|---|---|---|---|---|
| S1 | M+D | L2 L5 | Ma | The identity block title is 16px/600 next to a 56px icon. It doesn't read as the page's heading or as editable. | Outfit 28px/700, inline-editable, with a subtle pencil on hover/focus. |
| S2 | M+D | L7 | Mi | Chevrons are black and the switch is black (Ant default). House rows use the yellow chevron. | Yellow chevrons as on House rows. The switch uses the brand yellow when on (match UserSettings; if that's black too, change both). |
| S3 | M | L1 | **B** | Range calendar: the sheet changes height after the first tap (the hint line becomes "10 days" + "Clear dates"). The second tap landed on the wrong date (I tapped 25, got 24; tapped 22, got 15). | Reserve the footer height from the start (the hint and Clear share one fixed row) so the grid never moves between taps. Add a "Done" key once a range exists. |
| S4 | M+D | L3 | Mi | "Packing list · 0 items" for the seed's linked list. | Seed the packing list with a few items, or say "Empty — add items ›". |

### Global
| ID | VP | Lens | Sev | What I saw | What it should be |
|---|---|---|---|---|---|
| G1 | M | L4 | **B** | The Days sheet rows have zero left padding: text touches the sheet edge. | Use the same 20–24px side inset as every sheet. |
| G2 | M+D | L7 | Mi | Row ⋮ menu items are `generic`, not `menuitem` (a11y). | Use Ant Menu items or `role="menuitem"`. |
| G3 | M+D | L4 | Mi | Bottom sheets (Days, edit) use a stock X header with a divider. | One sheet header style everywhere: drag handle, then an optional title on the left in Outfit 18. No divider. X only on desktop. |

## Summary

- **Blockers:** T1, T2, T9, K1, S3, G1. They break the first impression, the one-add-bar rule, or basic layout.
- **Majors:** they cluster in four places.
  - The trip header and page order (T3, T4).
  - Row alignment and the gutter (T11, T12).
  - The edit sheet's controls (E1–E3).
  - The desktop Ideas and map relationship (T8, T15).
- **What's working:** the deck and deal, the ticket slip concept, done-day folding, the House pill nav, PillNav consistency, and Trip settings' grouped structure.

## Addendum: gaps pill (after the user's "looks wonky on mobile")

| ID | VP | Lens | Sev | What I saw | What it should be |
|---|---|---|---|---|---|
| T18 | M | L1 L3 L6 | **B** | The pill floats under the header and its popover is clipped. Both entries are overlaps, one on a done day. Tapping "Sun 18 has two things at the same time" scrolls to Sun 18 but marks nothing. | Remove the pill. Show gaps inline (brief 6i). This supersedes T9 and the gaps part of T3. |
