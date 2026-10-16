# Frontend — Agent Guide

React 18 + Vite + TypeScript SPA. Ant Design + Tailwind v4, TanStack Query for
server state, React Router. See the root [CLAUDE.md](../CLAUDE.md) for the command
surface and canonical facts.

## Terminology (UI copy)

The UI is branded **Bauhouse** and calls a "room" a **House**. Backend endpoints and
internal identifiers stay `/rooms/*` / "gracie" — only visible copy changes.

## Layout

`src/` — `api/` (fetch `client.ts`, `endpoints.ts`, `types.ts`), `auth/`
(`AuthProvider` — API key in `localStorage` key `gracie_api_key`), `components/`,
`pages/`, `lib/` (helpers), `routes/`. Path aliases (`@api`, `@auth`, `@components`,
`@pages`, `@lib`, `@routes`, `@assets`) are defined in both `vite.config.ts` and
`tsconfig.json` — keep them in sync.

## Validation

Run from the repo root via `make check`, or directly here:

- **Typecheck:** `pnpm typecheck` (`tsc --noEmit`). `vite build` does **not**
  typecheck, so this is the only thing that enforces `strict` TS. Asset-module
  imports (`*.png`, `*.webmanifest`, …) are declared in `src/vite-env.d.ts`.
- **Lint/format:** `pnpm lint` / `pnpm format` (Biome, config in `biome.json`).
  Biome handles JS/TS only; Tailwind CSS is excluded.
- **Tests:** `pnpm test` (watch) / `pnpm test:ci` (coverage). Vitest + Testing
  Library + **MSW** for HTTP mocking. `src/testServer.ts` exports the shared server;
  register handlers per-test with `server.use(...)`.

Use **Node 20** (`.nvmrc`) — newer Node destabilizes Vitest's worker pool, which is
why the config forces a single fork.

## Testing conventions

- **No arbitrary `setTimeout`/sleep waits in tests.** Use `await waitFor(...)` or
  `findBy*` queries to await state — sleeps are flaky. (Some older tests still use
  sleeps; replace them when you touch those files.)
- Assert on user-visible behavior (roles/text), not implementation details.

## Performance conventions (low-end devices)

- **Routes are lazy.** `routes/AppRoutes.tsx` loads each page with `React.lazy`; vendor
  chunks (`react`, `antd`, `dnd`) are split in `vite.config.ts` `build.rollupOptions`.
  Don't import a page eagerly from the entry.
- **Images:** never ship a source image bigger than ~2x its largest rendered size.
  No SVGs that wrap base64 rasters. The in-app logo is the inline `HouseMark` SVG, traced
  from `logo-168.png` (kept as the reference artwork); keep the two in step.
- **List rows are memoized** (`components/ItemRow.tsx`). Pass handlers wrapped in
  `useStableCallback` and keep per-keystroke state (e.g. `AddItemBar`'s draft) out of
  big pages. Define components at module scope, never inside another component.
- **CSS:** no permanent `will-change`, no `filter` on always-visible images, hover
  effects behind `@media (hover: hover)`.
- **Fonts** are self-hosted variable faces declared in `src/fonts.css` (latin subset
  only): **Outfit** for headings (`--font-headings`) and **Figtree** for body/UI
  (`--font-body`), from `@fontsource-variable/*`. Don't add third-party font or
  script origins.
- **Motion/shape tokens** live on `:root` in `styles.css` (`--ease-out`,
  `--dur-*`, `--shadow-key`, `--focus-ring`). Reuse them; animations stay behind
  `prefers-reduced-motion: no-preference`.

## Loading and motion under latency

- **Page loads** show `HouseLoader` (the logo building itself), hidden for its first ~250ms
  so fast responses never flash it. **In-sheet loads** use `RowSkeleton`, drawn to the
  real rows' geometry; content that replaces a skeleton fades in once (`is-arriving`).
- **View transitions** wait (max 250ms) only for the lazy-route fallback
  (`data-route-fallback`), never for data; a page's own loading state is what should show.
- **Post-login welcome:** `startWelcome()` (in `Login`) opens a short window in which any
  `BrandLogo` that mounts plays the window-light/door-swing, resuming mid-way on remount.
- **Notes** never overwrite unsaved typing with server data (see `syncedNotes` in `ListPage`).
- Test against latency with a delaying proxy in front of the API, not just the fast mock.

## List page behaviors worth knowing

- **Add-bar suggestions:** `AddItemBar` is an ARIA combobox fed by `GET /rooms/{id}/pantry`
  (fetched once in `ListPage`, filtered client-side by `lib/suggest.ts`). Enter only takes a
  slip the user explicitly arrowed to; otherwise it adds the typed text. `ListPage.bumpPantry`
  keeps the cached pantry current after each add.
- **Rows:** swipe-left (touch) and the hover trash (desktop) both go through `onDeleteItem`,
  which defers the request ~5s behind an Undo toast and flushes on unmount. **Clear completed**
  (`onClearCompleted`) works the same way: rows leave at once, the `/clear` request waits for the
  toast to close, Undo cancels it.

## Smart suggestions

`ListPage` asks `GET /rooms/{id}/lists/{list}/suggestions?limit=1` and shows the answer as one
`SuggestionStack` row above the items: a paper sheet with the item, "You add it weekly", a yellow Add (this
page's one key) and a round "not now" X. Never inside the list or the add bar. Add goes through `onCreateItem`
with `source: 'suggestion'`; Ignore posts the key. Both pop the slip at once and the server is asked for the
next one; after two ignores in a row it answers with nothing (the list is paused).
Motion: one authored arrival, then rest, nothing loops (`styles.css`, "Arrival"). The slip settles in while the list
below glides down (`.suggestion-reveal` grid rows 0fr to 1fr, clipped only during the grow), its warm edge flashes and
fades, and a beat later the plus on the key turns a quarter once and rests
(it is symmetric, so it ends looking as it began). No gloss, no pulsing, no loop. A taken or ignored slip pops out but keeps its slot (`spent` phases leaving, held, collapsing), so going
through suggestions swaps the card in place and the list never moves; the slot closes once, only when nothing follows.
Every slip is the same height (`min-height: 68px`). Any new row, typed or suggested, pops in (`row-in`, with the highlighter swipe). Taking or ignoring the slip pops it out (150ms) while the list glides up; it stays mounted
until then (`leavingSuggestion`, `SUGGESTION_EXIT_MS`). Any new row, typed or suggested, pops in (`row-in`, with the highlighter swipe). Reduced motion gets a plain fade. The server decides everything (confidence, home list, house setting), so a
failure or an empty answer just shows nothing. Events: `nudge.shown|tapped|dismissed` with
`kind: 'recurring'`. The House settings page has the on/off switch (`suggestions_off`).

## Behavior tracking (`lib/analytics/`)

- `tracker.ts` is a small injectable queue (`Tracker`); `index.ts` binds it to the API and `localStorage`.
  `AuthProvider` turns it on for the signed-in key and off (queue cleared) on sign-out. It is best
  effort: `track()` never throws, the queue is capped (200), mirrored to `localStorage` inside
  try/catch, flushed every 10s, on `visibilitychange` -> hidden (`keepalive`) and when back online.
  Event ids are client-made, so a retried batch is deduped by the server.
- Events go to `POST /events` on **our** API (no third-party SDK). They carry no identity: the server
  takes the user and house from the API key. Allowed names are the `Client: true` registrations in
  the backend; the subject type must equal the name's prefix. Never put typed text in an event: `key`
  is a normalized item name, nothing else is free text.
- `apiFetch` sends `X-Timezone` on every call; the server buckets behavior in local time with it.
- Call sites: `app.open` / `app.resume` (`startAppTracking`), `list.view` (`ListPage`),
  `item.delete_undone`, `add_bar.suggestion_accepted` (`AddItemBar`, needs `listId`), `trip.view`.
  Tests need the default `POST /api/events` handler in `testServer.ts` (MSW errors on unhandled requests).

## Trips (offline-first)

- **Layout:** `lib/trips/` is the client: `db.ts` (IndexedDB `trips`/`outbox`/`meta`),
  `replay.ts` (pure `renderTrip(snapshot, pendingOps)`), `store.ts` (per-tab senders, flush
  lock, backoff, per-result handling), `schedule.ts` (ordering, dates, DST-safe `wallToUtc`),
  `hooks.ts`. UI lives in `components/trips/` and `pages/Trip*.tsx`. Mutations go through the
  store (outbox), never straight to the API. Ids are client-made (`trip_`/`ttd_`/`tbk_` + 32 hex).
- **Tabs:** every tab group on the House, List and Trip screens uses `components/PillNav.tsx`.
  Do not add another tab style.
- **Map (Google Maps JavaScript API), keys and offline:** the map is lazy (`MapCanvas` +
  `components/trips/gmap/`: `loader.ts`, `controller.ts`, `pin.ts`, `labels.ts`, `geometry.ts`,
  `gmap.css`) behind the `MapViewProps` adapter in `components/trips/mapView.ts`; `TripMap` picks
  the real map or the plain SVG "Map preview". Google's script is loaded only when the map is first
  shown, through `@googlemaps/js-api-loader` (`importLibrary('maps'|'marker'|'core')`; `places` loads
  on the first search, see Places), and never offline.
  - **Keys:** `VITE_GOOGLE_MAPS_API_KEY` (browser key, restricted by HTTP referrer and to the Maps
    JavaScript and Places (New) APIs) and `VITE_GOOGLE_MAP_ID` (the cloud style;
    `DEMO_MAP_ID` in dev only). Both live in the git-ignored `.env.development.local`. No key or no
    Map ID: the plain "Map preview". **Never print, log or render the key.**
  - **Third-party origins:** `maps.googleapis.com` and `maps.gstatic.com` (script, tiles, fonts of
    Google's own UI) are the only allowed non-self origins, and only for the map. No service worker
    caches Google content, and nothing from Google (tiles, names, addresses) is stored by us; the
    only Google value we keep is `place_id`.
  - **Attribution:** Google's logo (bottom-left) and terms (bottom-right) stay visible; our +/- sit
    above the terms strip, and on the phone the bottom card sits below the map, never over the logo.
  - **View only (brief 6v):** `clickableIcons: false`, no `click` handler on the map, no POI popover,
    no add-from-map, no dropped pins, no reverse geocoding. The one click action is a pill: it
    selects its item. Desktop: `scrollIntoView({block:'nearest'})` on the Days row, the highlighter
    sweep, and the item opens in the inspector; the camera does not move. Phone map view: the map
    closes (`MapScreen.onPickRow`), then the list scrolls to the row and lights it. Kept: pan/zoom,
    +/-, Fit day, Show all days, row hover lifts the pill (`hotId`), pill hover lights the row
    (`onPinHover`, class `is-pin-linked`), and the add bar's preview pin.
  - **Pills (brief 6u, `gmap/pin.ts`, `gmap/gmap.css`):** each stop is an `AdvancedMarkerElement`
    with our HTML: a 34px white paper pill (12px category dot, name in Figtree 14/600, time 12.5/600
    if set), a pointer tail and a 10px anchor ring on the exact coordinate. Next is the yellow key
    pill with a "NEXT" kicker; done is grey; selected has a 2px ink outline; ideas are outlined. The
    pills are `aria-hidden` and `cursor: pointer`. After `idle` a greedy pass (`gmap/labels.ts`
    `resolvePills`, priority selected, next, day order; selected, next and hovered always kept)
    collapses pills that would overlap, and the pills of other days, to anchor and dot; they expand
    on hover (`isLabelled()` decides which are in full). Clusters ("+N", `@googlemaps/markerclusterer`)
    are 30px ink pills; the next, selected and emphasised-day pins are never clustered. Phone: 30px
    pills, 13px text, no time, names cut at 16 (`labelLimit`).
  - **Routes:** per day a 5px day-colour line on a 10px white casing with white chevrons ~100px
    apart; a leg to a `transport` stop is dotted in `--trip-transport` (defined in `gmap.css`).
  - **Camera (brief 6q):** only explicit actions move it (Fit day, Show all days, "Show" on the
    chip, picking a day, an opened item or a drag preview that is off screen). The first fit is the
    emphasised day (today during the trip, else the first day with places). Scrolling the list only
    changes `emphasisDay`. When that day's stops are all off screen (or piled up when zoomed out) the
    controller calls `onOffMap` and `MapCanvas` shows the chip "Wed 28 is off the map · Show"
    (`onShowDay` is Fit day). A programmatic move holds its own token until its own `idle`; the first
    fit waits for the map's first idle (`gmap/controller.ts`).
  - **Budget:** our map chunk (JS + CSS) must stay well under **320 KB gzip** (MapLibre is gone);
    Google's script is third-party, loaded on demand and outside that budget. Trip route chunks
    stay near 50 KB. On phones the map is a full-screen view (history `#map`). Offline the map pane
    and its button are not rendered (5 s debounce), the plan widens, and nothing is requested.
  - **Tests** mock the loader and clusterer with `__tests__/googleFake.ts`.
- **Places (Google Places API (New), `lib/trips/places*.ts`):**
  - **Storage rules** (the backend enforces them; the mock mirrors them): a Google place stores only
    `{source:'google', place_id, lat, lng, coords_fetched_at}` (and `tz` when known). **No name, no
    address.** Coordinates may be at most 30 days old; `lat`/`lng` may be missing once purged. A
    todo title is user content only: picking a place leaves it blank (a blank title is allowed only
    with a Google place). `osm_ref` and the `photon` source are gone; the `/places/*` proxy too.
  - **Search** (`placesSource.ts`, `usePlaces.ts`): `AutocompleteSuggestion.fetchAutocompleteSuggestions`
    with one session token per search session, biased to the trip's area (rounded to 0.1 degree),
    250 ms debounce, at least 2 characters. A pick calls `fetchFields` on the prediction's place
    (same token), which ends the session. No key: a small labelled demo list stands in.
  - **Display cache** (`places.ts`): name, address and locality for a place_id live in **session
    memory only**, filled while online (de-duplicated, paced about 5 calls a second). `useTrips`
    enriches rendered trips from it, so rows show `title || name`, and offline or before the fetch,
    the title or "Saved place". **Never persist the cache** (not IndexedDB, not localStorage), and
    every op goes through `sanitizePatch` (in `store.enqueue`) so an enriched name can never be sent.
  - **Coordinate refresh:** online, current and upcoming trips refresh Google coordinates that are
    missing or older than 25 days (an ordinary `todo/booking/trip.update`, on load and on focus).
  - **Open Maps** (brief 6t): `mapsUrl` (Apple Maps on iOS and iPadOS, Google Maps elsewhere) and
    `MapsLink`; a Google place opens by `query_place_id`.
  - **Place fields in the UI:** `InlinePlace` (`components/ui/InlinePlace.tsx`) is the inline place
    field with slips below (the desktop inspector mounts it); `PlacePicker` serves the phone sheet,
    booking From/To and trip Where; `QuickAdd` is the add bar (its highlighted suggestion previews as
    a hollow pin after a short dwell and one `location` lookup). All use the shared `Combobox`.
- **Desktop planning desk (`pages/TripPage.tsx`, brief 6n):** at 1200px and wider the trip is three
  columns, Ideas (300) | Days | Map (~420); at 1024-1199px it is Ideas | Days, and the map opens
  over them from the Map pill (`trip-side is-over`). Below 1024px nothing changes (phones keep the
  Plan / Ideas / Bookings pills). On desks Ideas is a column, so the pills are Plan / Bookings;
  every trip date shows (empty days are dashed "Nothing planned yet" slots that turn yellow while
  dragging); the one add bar is sticky under the Days column with Ideas in its target chip; before
  the trip a "Ready to go?" sheet (`components/trips/ReadyToGo.tsx`, pure rules in
  `lib/trips/readiness.ts`: travel, a stay for every night, empty days, packing) sits where the Next
  stop card goes during the trip. With no places the map column shows "Places you add show up here"
  and renders no map. Tests set the viewport with `setViewport('desktop' | 'mid' | 'phone')`:
  `desktop` is a 1440px screen (matches the 1024 and 1200 queries), `mid` is 1024-1199px.
- **Desk shell and inspector:** at 1024px and wider the window does not scroll (`html.trip-desk-shell`):
  the Ideas list and the Days column (`.trip-days-col`, the sticky-header scroll container and the
  IntersectionObserver root) scroll on their own, and each pane's position is kept in
  `sessionStorage` per trip. An open todo or booking is an inspector: it takes the right column at
  1200px and wider, a fixed overlay panel at 1024-1199px. Opening, switching or closing it never
  moves the Days pane (focus uses `preventScroll`; a selected row that is hidden is scrolled just
  into view). Tested in `__tests__/TripScroll.test.tsx`. With an item open, J/K and Alt+↑/↓ open the
  next or previous item in its pane (`pages/trip/useInspectorKeys.ts`; focus ends in the inspector,
  J/K are ignored while typing); tested in `__tests__/TripInspector.test.tsx`.
- **Dev mock (no backend needed):** `cd frontend && VITE_MOCK_TRIPS=1 pnpm dev --port 5174 --strictPort --host 127.0.0.1`
  (or just `pnpm dev`). It boots an MSW worker (a fetch
  shim if a service worker can't register) backed by `mocks/tripsServer.ts`, seeded from
  `mocks/seed.ts` ("Lisbon & Porto", dates relative to today). `?mockPhase=before|during|after`
  picks the seed's phase and re-seeds from scratch on every load that carries it (every trips
  database, including the mock user's, is deleted first; without the param the tab keeps its last
  phase, default `during`). Dev only; never in a production build.
- **Tests:** `__tests__/trips.helpers.tsx` has `renderTrips`, `seed`, `setViewport`,
  `lisbonTrip`, `meState`, `resetTripsWorld`; the shared in-memory `tripServer` is in `testServer.ts`.

## Landing page (`/`, logged out)

- `pages/Landing.tsx` composes `components/landing/*` (styles in `landing.css`, all classes `ld-*`). Logged-in
  members hitting `/` go to `/app` (`RequireGuest`). Brief: `docs/superpowers/specs/2026-10-15-landing-page-brief.md`;
  visual rules in the root `DESIGN.md`.
- The hero list, the shared plate and the offline slip are **local demos** (`components/landing/demo.ts`, pure and
  unit-tested): no API calls. Mia, Sam and Jo are an example House; the page never calls it a demo.
  `components/landing/appUi.tsx` copies the app's own pieces (list header, PillNav, checkbox, add bar,
  avatars); keep it in step when those change in the app.
- "Call your House ___ and start." stores the name in `sessionStorage` (`lib/pendingHouse.ts`);
  `CreateHouseSheet` takes it once to prefill the House name.
- Photos in `assets/landing/` are open-licence (CC BY); `credits.json` holds sources, the footer credits them, and
  each JPEG carries its provenance in a comment. Keep all three in step when adding or swapping a picture.
- The page's thesis: one shared space for the household, from the weekly shop to the next trip. Four parts and a close: hero, **Lists for the house** (`SharedPlate.tsx`, id `lists`), **Plan the trip together** (`Capabilities.tsx`, id `trips`: a weekend in Porto in two views behind two tab pills, "Planning at home" = `PlanDesk.tsx`, the desk with the drawn `PortoMap.tsx` in a MacBook Pro frame, and "On the trip" = `PhoneTrip.tsx` in an iPhone 14 Pro frame, plus `OfflineSlip`. The frames are Devices.css (MIT), vendored as `components/landing/devices.css` (only those two devices; its reset is scoped to the frame's own parts, and the notice is a `/*!` comment so the build keeps it); `DeviceFit.tsx` scales a frame to the width it has; both views stay in the markup without JavaScript), **It costs nothing** (`FreeReceipt`, with `InstallLine`), then the closing sentence. The lists section's looping typing demo keeps its logic in `demo.ts` (`plateTick`, `plateLand`): one tick per new line, and a line already on the list is never landed again, so leaving and coming back mid-word can't duplicate or shrink it. It plays only while on screen and rests on a finished list with reduced motion. Calls to action say "Get started free" (never "Try"). `StickyKey` pins that key to the bottom of phones once the hero's has scrolled away, and steps aside while another key, the close, the footer or a `[data-ui]` picture is in its strip.
- Offline is claimed for trips only (lists have no outbox yet). Bring back a page-wide claim only once lists work offline.
- **Install:** `lib/installPrompt.ts` keeps the `beforeinstallprompt` event (listener registered in `main.tsx`, no `preventDefault`), and `useInstallWay()` returns `prompt` / `ios` / `installed` / `browser`; the receipt section shows an install button, Safari's step, or nothing accordingly.
- **Prerender:** `pnpm build` also runs `vite build --ssr src/landing.server.tsx` and `scripts/prerender.mjs`, which writes the landing HTML into `#prerender` in `dist/index.html` and links the landing stylesheet. An inline script drops it before paint on other routes and for signed-in members; `Landing` removes it in a layout effect. Keep the landing page free of `window`/`document` access outside effects and handlers (use `useClientLayoutEffect` for layout effects). An optional `SITE_URL` at build time makes `og:url`/`og:image` absolute. The Dockerfile copies `scripts/` and `public/`.

## Design tokens (`src/styles.css`, top) and the living reference

All values come from the one `:root` block at the top of `src/styles.css`, grouped by role: type
(`--t-display`, `--t-title`, `--t-heading`, `--t-lead`, `--t-field`, `--t-body`, `--t-meta`, `--t-label`,
`--t-stamp`, `--t-code`), weights (`--w-regular/medium/semibold/bold`), inks (`--ink`, `--text`,
`--muted`), surfaces (`--bg`, `--panel`, `--panel-subtle`), edges, accents, status, space, controls,
corners, icons, depth (`--lift-0..3`, `--thick`, `--peek-*`, `--slip-*`, `--well`, `--shadow-key*`,
`--key-travel`), texture (`--grain-paper`, `--grain-desk`: background layers with their strength baked
in) and motion. **Fills:** paper is grained, so a flat white or tint inside a sheet shows as a patch.
Inside a sheet use `background: var(--paper-fill)` (or `var(--well-fill)` for a tint); where something
covers the desk use `var(--desk-fill)`. Never `background: var(--panel)` / `var(--bg)` on an element.
**Round keys** (`Button kind="key" iconOnly`) take their size from `--key-size` (default 44px) and stay
circles; their glyph is half the diameter. `docs/design-system/index.html` is the living reference: it carries a byte-for-byte
copy of that block. **After changing a token run `pnpm design:sync`**; `__tests__/designTokens.test.ts`
fails while the two differ, and also fails on any raw colour, px font size or numeric weight in
`styles.css`, `trips.css`, `ui.css` or `gmap.css` outside the block. The landing page (`landing.css`)
keeps its own poster scale.

## UI primitives (`src/components/ui/`)

Every trip overlay (and the House's New list / Edit list) is a composition of these, one file
each, styled by `ui/ui.css` from tokens on `:root` in `styles.css` (`--space-*`, `--radius-*`,
`--control-*`, `--row-h`, `--lead/--gap/--time-w`, `--sheet-*`, `--tier-*`, `--warn-*`). Import from
`@components/ui`; do not write one-off buttons, fields, chips or modals.

| Primitive | File | Is |
|---|---|---|
| `Paper` | `Paper.tsx` | One sheet: edge, white top highlight, grain, 16px corners and one of four heights (`lift` 0 resting, 1 on top, 2 overlay, 3 popover). `tone="tint"` for a well, `inset="flush"` to lay out its own padding, `as` for the element. Every panel is one (no Ant `Card`). |
| `PaperStack` | `PaperStack.tsx` | Sheets bottom-up: each next one slides 20px over the last and lifts, the ones beneath lose their foot edge, `peek` (0/1/2) sheets show beneath a little off true, and the stack assembles bottom-up on arrival (`arrive={false}` for the next-stop deck, which deals its own cards). Used by House, List, Trip, the desk's Ideas column, settings, Account, no-House and sign-in. |
| `Sheet` | `Sheet.tsx` | The one overlay. Variants `sheet`, `panel` (docked over the map), `slip`, `confirm`, `chips` (popover on wide, small sheet elsewhere, hangs from `anchor`). Header: phone drag handle + close key; closes with the key, Esc (innermost only), scrim and swipe-down; `dirty` asks "Discard this?"; focus trap and return. Slots `identity`, `actions`, `details`, `footer` always lay out in that order. |
| `SheetIdentity`, `SheetTitle` | `SheetIdentity.tsx`, `SheetTitle.tsx` | Tier 1: leading mark, Outfit title (inline-editable, with the server's title limit), one muted context line. |
| `SheetActions` | `SheetActions.tsx` | Tier 2: the one yellow key and at most one quiet button. |
| `DetailGroup`, `NavRow` | `DetailGroup.tsx`, `NavRow.tsx` | Tier 3: a tinted group of 52px rows (label, value, chevron); a row is a button, link or opens a picker (`Sheet variant="chips"`). |
| `SheetFooter` | `SheetFooter.tsx` | Tier 4: "Added by Mia" and a red Delete. |
| `Button` | `Button.tsx` | Paper at known heights: `key` (the one lifted control, one per sheet; sinks `--key-travel` when pressed; "not yet" is yellow soaked into the paper), `quiet` (a slip: rests a hair up, lifts on hover, presses in), `text` (ink on the sheet; `danger` is red). `iconOnly` makes a round one (the add bar's `kind="key" iconOnly` plus shows a paper disc while there's nothing to add). No `loading` spinner: the label says what is happening ("Saving…"). `href` makes it a link. |
| `Chip`, `ChipGroup` | `Chip.tsx`, `ChipGroup.tsx` | A pill that opens a picker; the large toggle choices (kinds, categories, times). |
| `Field`, `Switch` | `Field.tsx`, `Switch.tsx` | Borderless text field (with inline problem text); the yellow switch. |
| `Combobox` | `Combobox.tsx` | The one ARIA combobox: slips rise above an add bar, ↑/↓, Esc, Tab takes the ghost, polite count, `visualViewport` fit. Enter only picks a highlighted option, else `onSubmitText`. `AddItemBar` (pantry) and the trip `QuickAdd` (places) both use it; the draft stays in the bar. |
| `Stamp`, `Pip` | `Stamp.tsx`, `Pip.tsx` | Category/state tag; the colour dot. |
| `InlineWhen`, `InlineSelect`, `StampSelect` | `InlineWhen.tsx`, `InlineSelect.tsx`, `StampSelect.tsx` | The desktop inspector's in-place editors (variant `panel`; phones keep pickers). `InlineWhen`: a day select, a typed 24-hour time (`lib/trips/clock.ts` parses "9", "930", "2:30pm"; ↑/↓ ±15 min, Shift ±1 h; blank clears when allowed), and the length as segments. `InlineSelect`: a native select drawn like the paper (linked booking). `StampSelect`: stamps outlined in their colours, only the chosen one filled. The desktop Place rows (todo; booking From/To) are `InlinePlace` (Enter on typed text drops a pin from coordinates or keeps an address: `components/trips/typedPlace.ts`); phones keep `PlacePicker`. |
| `Row` | `Row.tsx` | The row grid `[lead 24] 12 [time 48] 12 [title] [trail]`. |
| `Note`, `SectionLabel`, `EmptyState` | `Note.tsx`, `SectionLabel.tsx`, `EmptyState.tsx` | Muted/warn one-liner (warn = amber text + glyph, no side rule), small caps label, friendly empty line. |

**House screens** (`RoomPage`, `RoomSettings`, `NoRoomPage`) are built from the same primitives:
`ShareCodeSheet` (the invite code as a ticket slip; reads `GET /rooms/share`, replaces only on "Get
new code"), `CreateHouseSheet`, `DeleteVoteSheet` (says what a delete vote does before it is cast;
the last vote deletes) and `IconPicker` (`ChipGroup` tiles). House settings mirrors Trip settings and
autosaves; so does Edit list.

Rules, enforced by `__tests__/ui.enforcement.test.ts`: no file outside the landing page imports Ant `Card` or `Button`; trip files and `RoomPage` import no Ant
`Modal`/`Drawer`/`Popover` (trip files also no `Input`/`Select`/`Button`/`Switch`/`DatePicker`);
`trips.css` and `ui.css` contain no hex colours outside `:root` and no side-stripe accent borders;
every token `ui.css` uses is defined. A sheet has at most one `key` Button (`ui.helpers.ts`).
The dev-only gallery at `/dev/ui` shows every primitive in a phone and a desktop frame. Pickers
(`components/trips/pickers.tsx`) apply their choice at once; sheets autosave.

## Ratchets (raise over time; never lower)

- **Coverage:** thresholds live in `vite.config.ts` (`test.coverage.thresholds`),
  set just under the current baseline. When you add tests, bump them to the new floor.
- **Lint:** `recommended` is on, but a batch of pre-existing violations (some a11y
  rules, plus `useExhaustiveDependencies`, `noArrayIndexKey`) are downgraded to
  `warn` in `biome.json` so the baseline is green. Fix violations and promote each
  rule back to error (its `recommended` default). Also open: `noExplicitAny` and
  `noNonNullAssertion` warnings to work down.
