# Trips UI: itinerary spine + live map (design brief)

Status: confirmed 2026-10-15; open decisions settled (section 7). Shape output only; no code yet.
Builds on: `2026-10-14-trips-api-persistence-design.md` (designed, **not implemented**).
Chosen layout: "Itinerary spine + live map". Sketch: `.impeccable/mocks/decision/spine-map.html`.

## 1. Job and audience

House members planning a trip together, in two postures. Mode: **Operate**.

- **Desktop, before the trip:** two or more people plan in parallel. They shape days, collect
  ideas, keep each day in one area of the map, and enter flights, stays and tickets.
- **Phone, on the trip, often with weak signal:** see what's next today, pull up a booking at
  a counter or door, add an idea, tick things off, shuffle the day.

Trips range from day trips to 1–2 week holidays that move between cities (up to 150 todos and 50
bookings).

## 2. Outcome and proof

- One scrolling column holds the whole trip. Nobody has to switch views to see what happens on
  a day, when, and where.
- The map always shows the day you are reading, so "is this day in one area?" is answered
  without asking.
- On the phone, opening the trip during the trip lands on **today, at now**. A booking's
  confirmation code is at most two taps away, offline included.
- Moving an idea onto a day is one drag on desktop and one menu on the phone.
- Every tap lands instantly (local first). Sync is shown honestly and never blocks.

## 3. Selected direction

Stays inside the existing Bauhouse world: paper sheets on grey, yellow key buttons, Outfit
headings, Figtree body, category stamps, the highlighter mark, confetti, existing motion tokens.
No new visual language.

**Structure.** A trip is an **itinerary spine**: one continuous column of days with sticky day
headers. Bookings sit in the spine at their real times as stub rows. **Ideas** (todos with no
day) sit in a tray above the first day. Beside the spine, a **live map** shows the day in view.

**Signature move: the map follows your reading.** When a day header reaches the sticky line, the
map eases to that day's bounds and draws its route in the day's colour, with numbered pins in
time order. Other days' stops dim to small grey dots. Hovering a row lifts its pin; clicking a
pin scrolls the spine to its row and plays the highlighter sweep. Reduced motion: the map jumps
without easing and the sweep becomes a plain highlight.

**Borrowed details from the round:**
- From the trip card: a **"Now" marker** in today's section (a thin line between done and next,
  labelled with the time), and a **trip summary** in the header that names gaps ("2 days
  empty", "Sat 24: two stops overlap", "3 todos outside trip dates").
- From the ticket wallet: bookings are **stubs** (a dashed tear edge, the code in a monospaced
  face). When a booking has passed it is stamped **Used** and folds to one line. It is never
  deleted.
- From the tab manual: each date in the phone date strip has a small bar whose length shows how
  full that day is.

## 4. Scope and boundaries

In scope (frontend; the backend spec is the contract):
- `/app/trips`: the trip index (also surfaced as a "Trips" section on the House page).
- `/app/trips/:tripId`: the spine + map screen, with `?day=YYYY-MM-DD` deep links.
- Create trip, edit trip details, todo detail editing, the place picker, the bookings view, the
  packing link and the notes.
- The offline client from the spec's "Client contract" (IndexedDB snapshot + outbox).

Anti-goals:
- No calendar-grid or board view in v1. The spine is the only plan view.
- No "near me" map mode on the phone (not chosen in discovery).
- No permissions system. Every House member edits everything.
- No new fonts, palette or icon family. No renaming of internal identifiers (`/rooms/*`, gracie).
- The map never becomes required. Every task can be done from the spine alone.

## 5. States and ranges

| Case | Behaviour |
|---|---|
| Draft (no dates) | The spine shows only Ideas. The header suggests "Add dates". The map shows all ideas. |
| New trip, no todos | Each day shows a dashed "Nothing planned yet" row, and the Ideas tray is open. |
| Day trip | One day. No date strip on the phone. |
| Typical (9 days, ~40 todos, 6 bookings) | Fits the sketch: 4–6 rows per day. |
| Max (14+ days, 150 todos, 50 bookings) | The spine is virtualised by day. The Ideas tray collapses to a count plus a search field. A cap warning shows from 140 todos. |
| Todo dated outside the trip | It goes in an "Outside trip dates" section at the end, so changing dates never hides data. |
| Before / during / after the trip | Opens at the first day or Ideas / today at the Now marker / the first day. Past trips are read-only by default, with "Edit anyway". |
| Offline | Everything stays editable. A small header note reads "Saved on this device · syncs when online". Bookings stay fully readable. |
| Op `conflicted` | A row-level note: "Mia changed this after your offline edit", with a "See theirs" option. No modal. |
| Op `rejected` | The optimistic change reverts, with a short toast saying why ("This idea was deleted"). |
| Places search degraded | Inline "Search is unavailable. Drop a pin or type the address". |
| Map tiles not cached | Pins and routes still draw on a plain ground, with an "Offline map" label. |
| Trip deleted by a member | A banner: "Mia deleted this trip · Restore" (30 days). |
| Packing list (online only) | Shows "Create packing list" when online. When offline the button is disabled with a reason. |

## 6. Interaction and layout

**Desktop (≥1024px).** Two panes.
- **Left, ~460px:** the top bar (back to House, avatars). Below it the trip header: title,
  route ("Lisbon → Porto"), dates, a countdown, and the gaps summary. Then the Ideas tray, then
  the spine.
- **Right, the rest:** the map, with a segmented control at the top: **Map · Bookings · Notes ·
  Packing**. Map is the default. Bookings lists every stub grouped by kind, with codes ready to
  copy.
- **Rows:** checkbox · time (tabular figures, in the todo's own time zone) · title with a place
  line · category stamp. "Added by" and "changed by" show on hover/focus and when the change is
  less than 24h old. Clicking a row expands it **in place** for editing: title, day, time,
  duration, category, place, notes, and "Open in Maps". No modal.
- **Adding:** each day ends with an add row ("Add to Sat 24"). Typing "14:00 Pena Palace" sets
  the time. Place suggestions rise as slips, the same pattern as the pantry autocomplete. The
  Ideas tray has its own add field.
- **Moving:** drag an idea chip onto a day header or between rows; drag rows between days.
  Keyboard: every row and chip has "Move to…" (a list of days plus Ideas), and Alt+↑/↓ reorders.
  Moves are announced politely to screen readers.
- **Time zones:** a zone label shows only when it differs from the previous row. A flight shows
  both ends ("07:05 London → 09:40 Lisbon").

**Tablet (768–1023px).** The spine is full width, and the map is a collapsible right pane
(~40%) opened from a toolbar toggle.

**Phone (<768px).** One column.
- A sticky header with a **date strip** that has fullness bars. Tapping a date scrolls the
  spine to it.
- During the trip, today opens at the Now marker. Tonight's stay stub is pinned at the top of
  today.
- The map is a **pull-up sheet**. At peek height it shows today's pins; pulled up, it is the same
  live map. It loads only when first pulled up.
- A sticky bottom add bar ("Add to today") has a target switch for today, another day, or Ideas.
  Long-press lifts a row to reorder it, the same as Lists. The row action sheet has "Move to day".
- Swipe left deletes with an Undo toast, as in Lists.

**Delight, tuned for work:** the existing confetti on ticking (smaller burst in the spine), the
"Used" stamp on past bookings, a "Day done" stamp on a day header when every row is ticked, the
countdown, and Bauhaus-coloured route lines. Motion uses `--ease-out` and the `--dur-*` tokens,
behind `prefers-reduced-motion: no-preference`.

**Trip index.** "Now", "Upcoming", "Drafts" and "Past" groups of trip cards (title, route,
dates, countdown or "Day 3 of 9"). "New trip" is the yellow key and asks only for a title, an
optional destination (place search) and optional dates.

## 6a. Revision after the first live review (2026-10-15)

User feedback: the spine was too busy and flat. Where this section conflicts with section 6, this
section wins. Hierarchy now has three levels:

- **Trip:** a compact header (it collapses on scroll on the phone) with tabs **Plan · Ideas ·
  Bookings** and a ⋯ menu (Notes, Packing, Trip details). Trip details open in a modal. Gaps
  become one header pill ("3 to sort") that opens a popover. Ideas leave the spine; on desktop
  the Ideas tab is a drawer over the map pane, so dragging onto days still works.
- **Day:** each day is its own paper card with an H2 header, one summary line and a small day
  dot. Past days collapse to a one-line summary; today is marked with a Today pill and the Now
  marker; on the phone only today and the day picked in the date strip are expanded. There is no
  per-day add control: like the List page, the trip screen has **one** sticky add bar (with a
  target switch, defaulting to the day in view or to Ideas on the Ideas tab) on every breakpoint. "Day
  done" stamps once, then shows as ✓ in the summary.
- **Item:** rows are two lines at most (checkbox, time, title / place). The category is an icon
  or dot, not a text chip. The handle, trash, duration and "added by" move off the row. Tapping
  opens the item detail: a bottom sheet on the phone, a panel over the map on desktop. It has
  every field, Open in Maps, Move to…, delete and authorship. Bookings stay as one-line stubs in
  Plan, and their detail shows a large, copyable code.
- Colour in the spine is limited to the day dot, the yellow key and state. The day-colour cycle
  lives on the map.

## 7. Constraints and open decisions

Constraints:
- **The backend is not built.** The UI needs the trips API, the places proxy and sync. Plan the
  backend first, or build the UI against an MSW/mock implementation of the spec contract.
- Low-end devices: lazy route; the map library loads only on desktop or on the first sheet
  pull; virtualise the spine for long trips; memoised rows (`useStableCallback`); hover behind
  `(hover: hover)`.
- Accessibility: every drag has a keyboard and menu equivalent; 44px targets; the date strip is a
  `tablist`-like control with arrow keys; the map is supplementary (`aria-hidden` pins, with the
  spine as the accessible source).
- Show OSM/ODbL attribution on the map and in place search.
- Tests: Vitest + MSW for the outbox replay, conflict and reject handling, keyboard "Move to…",
  scroll-to-day, and the offline banner; bump the coverage ratchets.

Decisions (settled 2026-10-15):
1. **Map stack: MapLibre GL + Protomaps.** Vector tiles from a PMTiles file we host ourselves
   (object storage such as S3/R2, or the same origin), so there is no third-party tile origin
   and prefetching the trip's area offline is allowed. MapLibre (~200KB gzipped) is lazy-loaded.
   `frontend/CLAUDE.md` gets an explicit, narrow exception for the tiles origin if it is not
   same-origin. The tile service worker prefetches the bounding box of the trip's places
   for the zoom levels the spine uses.
2. **Day labels: editable, with a suggestion.** The trip gets a `days` map (date → label, ≤40
   chars). When a day has no label, the UI suggests one from the most common `locality` of that
   day's places, shown muted. Anyone can accept or edit it. Needs a new op and `Place.locality`
   (see the API spec amendment).
3. **Who did it: `created_by` + `updated_by` on todos and bookings**, set by the server from the
   authenticated user and never from a patch. The UI shows "Added by Mia" / "Changed by Jan" on
   hover and focus, and inline when the change is under 24h old and not yours.
4. **Route: entered by hand.** The trip gets an ordered `stops` list of places (≤12). The header
   shows "Lisbon → Porto" from it. With no stops, it falls back to the destination. Editing
   stops is part of trip details (search, add, reorder, remove). Stops do not move todos or
   change zones.
5. **Day colours: a fixed Bauhaus cycle** of 6–7 colours built from brand blue, red and deep
   yellow plus a green, teal and violet, each checked for at least 3:1 contrast against the map
   ground. Day 8 reuses day 1's colour. Only the day in view is drawn in colour. Trip
   category stamp colours are chosen with the build in the same family. Both are recorded in
   DESIGN.md.
6. **Gaps flagged in v1:** empty days, overlapping times (two timed todos or bookings on the
   same day, compared in absolute time), and todos outside trip dates. "Night without a stay"
   is not flagged. Each gap is a link that scrolls the spine to it.
