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
- `/app/trips`: the House page with the Trips pill selected (see 6g).
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
  target switch, defaulting to the day in view or to Ideas on the Ideas tab) on every breakpoint. **Done days**
  (every todo ticked, any date) fold into a slim muted line, not a card ("✓ Tue 13 · Arrival · 5
  done"); consecutive done days merge into one line ("✓ Tue 13 – Wed 14 · 2 days done"). Tapping
  expands it in place. Ticking a day's last item plays the confetti and a ~1s "Day done" stamp,
  then the card folds; unticking unfolds it. A past day with open items is not done and stays a
  full card. Done days show ✓ in the phone date strip and are not drawn on the map unless
  expanded.
- **Item:** rows are two lines at most (checkbox, time, title / place). The category is an icon
  or dot, not a text chip. The handle, trash, duration and "added by" move off the row. Tapping
  opens the item detail: a bottom sheet on the phone, a panel over the map on desktop. It has
  every field, Open in Maps, Move to…, delete and authorship. Bookings stay as one-line stubs in
  Plan, and their detail shows a large, copyable code.
- Colour in the spine is limited to the day dot, the yellow key and state. The day-colour cycle
  lives on the map.

## 6b. Add flow and untimed todos (2026-10-15)

- **Add:** the single add bar is for quick capture: it parses "14:00 Pena Palace" into a time and a
  title, shows place slips, and Enter adds at once. An expand button (or Shift+Enter) opens the item
  detail, prefilled. The item detail is the same editor used for editing (a bottom sheet on the
  phone, a panel over the map on desktop). In the Bookings tab, add opens the booking form
  directly.
- **Untimed todos are first-class.** A day's order is the manual `order`. Setting a time places the
  todo between its timed neighbours; untimed todos stay where they were dragged. Rows without a
  time have no empty time column. The Now marker, overlap gaps and time display apply only to
  timed todos. Duration is optional and lives in the detail.

## 6c. Charm and simplicity (2026-10-15, second live review)

User feedback: "looks like Bauhouse, but doesn't have the Bauhouse charm and metaphor or stacked
papers and unintimidating UI. The prompt should be dead simple. If it's too complex, I won't use
this." This section outranks feature completeness; when in doubt, show less.

- The trip page is a **paper stack**, built with the List page's own classes and arrival motion.
  The top sheet is the trip header (icon via IconPicker, big title, one friendly line, avatars).
  The plan sheet sits beneath it, with days as sections inside it. The peeking sheet edge stays.
- Tabs use the List page's pill segmented control (Plan · Ideas · Bookings). Notes, Packing and
  Trip details live in the ⋮ menu.
- Each screen answers one question. During the trip, today opens with "Next up: … at 14:00".
  Copy uses the House voice ("Today in Sintra", "Nothing planned yet", "2 things to look at").
  Count summaries are dropped from day headers.
- Plan shows only tonight's stay and the next booking as stubs; the rest live in Bookings.
- The add bar matches the List add bar, with the day target as a chip in the placeholder. The
  expand control appears only after typing.
- **New trip asks only for a name.** Dates, destination and stops come later, from Trip details
  or a gentle prompt in the empty plan.
- Done days fold into one quiet line at the top of the plan sheet, like "Show checked-off items".
- **No horizontal date strip** on any breakpoint. The header's friendly line ("Day 3 of 9 · Thu
  15 ▾") opens a day list (a bottom sheet on the phone, a popover on desktop) styled like the House
  page's list rows. On the phone, days after tomorrow are folded to their header line until
  tapped. `?day=` deep links still work.

## 6d. During the trip: the next-stop deck (2026-10-15)

User direction: on the trip, the pressing question is where to go next; make it feel like an
adventure or a scavenger hunt.

- During the trip, the Plan tab opens on a **deck of paper cards**: today's remaining stops, top
  card in full (a "Next stop" kicker, a big title, one line of time · place · Open in Maps), with
  sheet edges peeking beneath and "2 more today".
- The next card is the first unticked todo in the day's order. An overdue time is noted gently.
  A booking appears as a card with its code large.
- An empty deck shows Day done, then a teaser for tomorrow's first stop.
- "Later today" rows sit below the deck.
- No deck before or after the trip. No geolocation in v1. The deck works offline.
- **Hierarchy (revised after review):**
  - The place title is the hero, with a list-row checkbox beside it. Ticking it deals the next card.
  - A muted subheading under the title gives the time ("Anytime" when untimed), plus the linked booking ("10:15 · Timed entry booked").
  - The one yellow key is **Open Maps**.
  - A booking's confirmation code is hidden behind a "Show code" button.
  - "Skip for now", the Done button, the progress shapes and the "N more today" line are removed.
    The peeking sheet edges are the only hint that more cards remain.
  - The heading is only where to go: the place name, falling back to the title. Booking
    descriptors and a differing todo title go in the subheading ("Lunch · 12:30", "10:00 · Timed
    entry · Booked").

## 6e. Trip settings and the next-stop preference (2026-10-15)

- **Trip settings** is a full page (`/app/trips/:tripId/settings`), opened from the ⋮ menu, styled
  like RoomSettings and UserSettings. It replaces the Trip details modal.
  - "This trip" is shared with the House: name and icon, dates, destination, route stops, packing
    list, and Delete trip (restorable for 30 days).
  - "Just for you" holds the switch **"Show next stop when I'm travelling"**.
- The switch is a **per-account preference** (`preferences.trips_show_next_stop` on `/me`,
  default on), also shown under a Trips section in UserSettings. When it's off, the trip opens on
  today's plan without the deck. Changing it needs a connection; offline, the cached value is used.

## 6f. Code reveal, delete and the edit sheet (2026-10-15)

- **Show code** opens a ticket slip: a bottom sheet on the phone, a popover on desktop. It shows the
  title, a time · place line, the code large in the app's own type on a dashed-edge slip, and
  Copy. The card never reflows. It is one component wherever a code appears.
- A todo with a linked booking absorbs it in the deck ("10:00 entry · Booked"). Only unlinked
  bookings get their own deck card.
- **Delete:** swipe left on rows with Undo, reusing the List implementation (hover trash on
  desktop). The deck card has no delete. Delete is also a quiet red text button at the bottom of
  the edit sheet.
- **Edit sheet** (add and edit; a sheet on the phone, a panel on desktop): checkbox plus a large
  borderless title, a place row, then "when" chips (day, time, preset durations; duration hidden
  until there's a time), category stamps, a "Link a booking" row, and borderless notes. Open in
  Maps, an authorship line and Delete sit at the bottom. There are no field labels, no boxed
  inputs and no Save button; everything autosaves.

## 6g. House navigation: pill nav (2026-10-15)

- One shared **PillNav** (the List page's segmented pill) is the only tab style in the app: House
  (Lists · Trips), List (Items · Notes), Trip (Plan · Ideas · Bookings).
- The House page is a paper stack. The header sheet sits on top; the second sheet opens with
  **Lists · Trips** pills and that section's yellow key ("New list" / "New trip"), replacing the
  "Our Lists" / "Our Trips" headings. `/app` is Lists and `/app/trips` is Trips (the separate trips
  index page is removed). The last pill is remembered per viewer, and a yellow dot marks a trip
  happening now.
- Trip rows mirror list rows (icon, title, one meta line, yellow chevron). Order: now, then
  upcoming, then drafts. Past trips fold into "3 past trips · Show".

## 6h. Trip icons and a simpler Trip settings (2026-10-15)

- Trips have their own icon set, stored as keys (`icon` on the trip): SUITCASE 🧳 (the default),
  PLANE ✈️, BEACH 🏖️, MOUNTAIN 🏔️, CITY 🏙️, TRAIN 🚆, ROAD_TRIP 🚗, CAMPING ⛺, MAP 🗺️,
  LANDMARK 🏛️, WINE 🍷, SKI 🎿.
- Trip settings is a grouped list on paper with no boxed inputs:
  - The identity block is the icon (it opens the icon grid) plus an inline-editable title.
  - **Where**: one ordered list of places. The first place is the destination; destination and
    route are no longer separate concepts.
  - **When**: one range calendar sheet.
  - **Packing list**: opens the linked list, or "Make a packing list".
  - "Just for you" holds the next-stop switch. "Delete trip" comes last, as quiet red text, and
    its confirm says the trip can be restored for 30 days.
  - Back is the TopNav chevron; there is no separate Back button.

## 6i. Gaps live inline (2026-10-15)

The "N things to look at" header pill and its popover are removed. On mobile it looked wonky, it
flagged done days, and it didn't say which items clashed. Gaps now show where they are:
- An **overlap** (today and future days only) gets one quiet amber line under the day header that
  names the clash, with both rows marked. Tapping the line opens the later item with its time chip
  focused.
- An **empty day** says "Nothing planned yet".
- Todos **outside trip dates** sit in their own end section, with one explanatory line.
- The day list marks days that have an overlap with a small amber dot.
- A warned todo stays completable. Ticking either clashing item clears the warning (done todos and
  bookings that have passed don't count as overlapping); unticking brings it back.

## 6j. Interactive map (2026-10-15)

- **Desktop map:** a real MapLibre map with zoom and pan, a +/− control, **Fit day** and Show all
  days. Following the scroll pauses after any manual zoom or pan, until Fit day or a day pick.
  The basemap is a quiet light style so day colours and pins stand out.
- **Click to add a stop:** clicking the map or a place label drops a temporary pin and opens a paper
  popover with the place name (POI name or reverse geocode, else "Dropped pin"), "Add to Thu 15"
  with a day chip (another day or Ideas), and "More details". Nothing is created until you confirm.
  Esc, an outside click or a pan dismisses it.
- Highlighting a place slip in the add bar previews its pin on the map.
- **Google Maps considered and rejected (2026-10-15):** its terms forbid storing place snapshots
  and using Places data on a non-Google map (see `2026-10-15-google-maps-option.md`). Protomaps and
  Photon stay. Google is used only through the "Open in Maps" link.
- **Budget:** the lazy map chunk may be up to 320 KB gzip; trip route chunks stay around 50 KB.
- **Offline: no map.** On desktop the pane hides (after a ~5s debounce) and the list widens, with
  "The map comes back when you're online." On the phone the map button hides. The map chunk is
  not fetched while offline.
- **Names and category pips replace numbers** (approved 2026-10-15; sketch:
  `.impeccable/mocks/map-labels.html`).
  - **Pips:** each stop is a pip in its category colour, and done stops are muted. The next and
    selected stops get a yellow ring.
  - **Names:** drawn beside the pip, truncated (about 22 characters on desktop, 14 on the phone).
    MapLibre hides names that collide; pips always stay. Priority: selected, then next, then the
    day's order.
  - **Grouping:** stacked stops merge into a "+N" pip that zooms in on click.
  - **Order:** arrows on the route line show the order. Hovering a row or a pip shows its name.
  - **Other views:** all-days mode uses day colours with names on hover only. Ideas are hollow pips.
  - **No numbers anywhere,** neither on the map nor in the rows.
- **Phone map: a full-screen, read-only view.**
  - **Opening:** a labelled "🗺 Map" pill in the PillNav row opens it.
  - **Top bar:** ✕ close on the left and a "‹ Thu 15 · Sintra ›" day stepper in the centre.
  - **The map** fits the day's pins clear of the chrome.
  - **Bottom card:** one card for the selected stop (the next stop by default), with Open Maps.
    Tapping a pin switches the card.
  - **Closing:** ✕, a swipe down, Esc, or the back gesture (via a history entry).
  - **Read-only:** no adding from the map. All map interactions are desktop only.
- **Tiles (decided 2026-10-15): the Protomaps hosted API** (TileJSON, key in `VITE_PROTOMAPS_API_KEY`,
  restricted by domain). This supersedes self-hosted PMTiles in 7.1. There is no offline tile
  prefetch (the API terms forbid it); offline, the map is hidden (see the offline rule above).

## 6k. Trip header avatars (2026-10-15)

The member avatars stay. They are right-aligned on the "Day 3 of 9" line, with their right edge
matching the ⋮ menu's, as a tight overlapping stack (24px avatars, "+N" after 3). On narrow
screens they wrap onto their own line below, still right-aligned. They are not interactive, and
the stack is labelled "Shared with …".

## 6l. Components as a design system (2026-10-15)

Every overlay uses one `Sheet`, and sheet content is built only from shared primitives in
`frontend/src/components/ui/`:
- Sheet, SheetTitle, Row (the shared grid), NavRow (yellow chevron)
- Chip and ChipGroup, Stamp, Pip, Field (borderless)
- Switch (brand yellow), Button (key / quiet / text, with danger)
- SectionLabel, Note (muted / warn), EmptyState

The rules:
- All values are `:root` tokens.
- Trips code may not import antd form or overlay components directly; tests enforce this.
- A dev-only `/dev/ui` gallery shows every primitive and state.
- DESIGN.md is generated from the finished build.

## 6m. Four-tier sheet template (adopted 2026-10-15)

Every sheet fills the same four tiers, in order (reference: `.impeccable/mocks/sheet-template.html`):
1. **Identity:** a checkbox or kind icon, the title in Outfit 26, and one context line.
2. **Do:** one yellow key (at most one per sheet, only in this tier) plus at most one quiet button.
3. **Details:** one tinted group of rows, each with a short muted label, a value and a yellow
   chevron. Each value opens one picker; "When" covers day, time and duration together.
4. **Footer:** "Added by … · day" on the left and a red Delete on the right.

This supersedes the no-labels anatomy in 6f and the booking edit layout in 6l. Booking creation
still starts with the kind chips.

## 6n. Desktop planning desk (2026-10-15)

User feedback: the desktop view was the phone layout stretched wide (a 410px column plus a mostly
empty map), and planning before the trip happens on desktop. The user chose option A
(sketch: `.impeccable/mocks/desktop-planning.html`).

- **At 1200px and wider, three columns:** Ideas (300px), then Days (fills the rest), then Map
  (about 420px). All three are visible at once. Ideas sits in its own column instead of a tab or
  drawer; you drag an idea onto a day, and "Move to…" still works. PillNav on desktop is
  **Plan · Bookings**. Everything below 1200px keeps the current layouts.
- **Every date in the trip shows on desktop,** including empty days. An empty day is a dashed slot,
  "Nothing planned yet", which turns into a yellow drop target while an idea is being dragged.
  Days before today fold as before.
- **Before the trip,** a **"Ready to go?"** checklist sits above the days and replaces the Next stop
  card. Each line links to the fix:
  - bookings added (flights, trains);
  - a stay covering every night (this check returns here only; it is not an inline gap);
  - empty days;
  - packing progress.

  During the trip, the Next stop card shows there instead.
- **The map column** only claims space when the trip has places. Before that it shows a quiet
  empty state ("Places you add show up here"). It follows the day in view as before.
- **One add bar** sits under the Days column, with the target chip including Ideas. The Ideas column
  has no add field of its own. On desktop it is a **floating composer** and the star of the planning
  view: fixed to the viewport bottom over the Days column, 56px tall with 17px text, elevated, with a
  48px yellow key and a `/` key hint. The plan scrolls clear beneath it.
- **The header** spans the Days column: icon, title on one line, route · dates · countdown, and
  avatars on the right.

## 6o. Details on the desk (2026-10-15)

**Drag behaviour:**
- The Days area auto-scrolls while you hold a dragged item near its top or bottom edge, faster the
  deeper you go into the edge.
- Holding over a folded day for about 600ms unfolds it.
- While dragging, the map previews the target day and the idea's place.
- A timed idea drops at its time; an untimed idea drops where the line shows.
- After a drop, the page stays still, the row gets a highlight sweep, and a toast offers Undo
  ("Added to Wed 25").
- Esc, or dropping outside a target, cancels.
- On trips longer than 5 days, a quiet date rail appears only while dragging.
- The same rules apply when dragging rows between days, and "Move to…" gives keyboard parity.

- **Pips and leading glyphs** are centred on the title's first line (within 1px), everywhere.
- **Ideas look draggable:**
  - On desktop, the grip shows at rest, with grab and grabbing cursors and a lift on hover.
  - While dragging: a placeholder at the source, every day becomes a drop target with an insertion
    line, and the Days column auto-scrolls near its edges.
- **Touch at any width** (`pointer: coarse`):
  - Long-press drag with a haptic tick.
  - No hover-only actions; swipe left to delete.
  - 44px hit areas.
- **Quick delete for ideas:** a hover trash icon, swipe, or Delete/Backspace, all with Undo (5s) and
  never a confirm dialog. Spine rows share the same row-actions component.

## 6p. Desktop inspector (2026-10-15)

On desktop (1024px and wider) the item and booking panels become an **inline inspector**. They use
the same four tiers, but the details tier edits in place with no picker sheets:
- **When:** day select, a typed time with ↑/↓ adjusting it, and a duration segmented control.
- **Place:** inline search.
- **Category:** a stamp select where only the selected stamp is filled.
- **Booking:** an inline select. **Note:** a visible textarea.

It is master-detail: clicking another row swaps the content without closing, J/K moves between items,
and Esc closes. At 1200px and wider it takes the map column's place while open. Target: setting day,
time, place and category takes 5 clicks or fewer. The phone keeps the existing row-to-picker flow.
Context lines leave an 8px gap before the stamp.

## 6q. The map stays put (2026-10-15)

User feedback: the map jumped while the list scrolled. This supersedes "the map follows the day in
view" as a camera move.
- **No camera moves on scroll.** The map fits the whole trip on load, and scrolling only changes
  emphasis: the day in view gets its colour, and other days dim.
- **The camera moves only on explicit actions:**
  - Fit day or Show all days;
  - "Show on map";
  - picking a day in the day list;
  - opening an item, and only if its pin is off-screen;
  - previewing a drag, and only if the place is off-screen.

## 6r. Days stack and playful drag (2026-10-15)

- **The Days column stack** uses exactly the List page's stack:
  - the same overlap with no corner notches;
  - the same borders and lift;
  - a peek sheet at the end of the scroll.
  - The Ideas and Map columns share the same radius and lift, with their tops and bottoms aligned.
- **Dragging an idea is playful:**
  - It lifts into a paper slip with a −2° tilt and follows the pointer with a slight spring, swaying with
    speed.
  - The day header gets the highlighter sweep, and empty slots gently "breathe".
  - The drop tucks in with a small settle, and the counts tick up or down.
  - A cancel floats back to where it started.
  - All of it uses transform and opacity only, holds 60fps at 6× CPU, and turns off under reduced motion.

## 6s. Map fonts (2026-10-15)

All map text uses self-hosted glyphs: **Figtree first, Noto Sans as the fallback** (composite stacks
for Latin, Greek and Cyrillic). CJK uses the device's system font through MapLibre's
`localIdeographFontFamily`. Arabic and Hebrew use the RTL plugin, self-hosted and lazy-loaded.
Scripts MapLibre can't shape fall back to a hover label. The basemap prefers English names, then the
local name. No third-party font origins.

## 6t. Open Maps (2026-10-15)

Every "Open Maps" is one `MapsLink`, named for the place:
- **Desktop:** Google Maps in a new tab.
- **iOS and iPadOS, including the installed PWA:** the Apple Maps universal link, so it opens the Maps
  app.
- **Android:** the Google Maps universal link, so it opens the app, falling back to the web.

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
