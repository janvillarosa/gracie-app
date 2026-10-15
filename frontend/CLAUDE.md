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
  which defers the request ~5s behind an Undo toast and flushes on unmount.

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
  `PoiCard.tsx`, `gmap.css`) behind the `MapViewProps` adapter in `components/trips/mapView.ts`;
  `TripMap` picks the real map or the plain SVG "Map preview". Google's script is loaded only when
  the map is first shown, through `@googlemaps/js-api-loader` (`importLibrary('maps'|'marker'|'core')`;
  `places` only on the first place tap or search), and never offline.
  - **Keys:** `VITE_GOOGLE_MAPS_API_KEY` (browser key, restricted by HTTP referrer and to the Maps
    JavaScript and Places (New) APIs) and `VITE_GOOGLE_MAP_ID` (the cloud style; `DEMO_MAP_ID` in dev
    only). Both live in the gitignored `.env.development.local`. No key or no Map ID: the plain
    "Map preview". **Never print, log or render the key.**
  - **Third-party origins:** `maps.googleapis.com` and `maps.gstatic.com` (script, tiles, fonts of
    Google's own UI) are the only allowed non-self origins. No service worker caches Google content.
  - **Attribution:** Google's logo (bottom-left) and terms (bottom-right) stay visible; our +/- sit
    above the terms strip, and on the phone the bottom card sits below the map, never over the logo.
    Suggestion lists show "Powered by Google" (the demo list says it is a demo).
  - **Markers** are `AdvancedMarkerElement`s with our own HTML (`gmap/pin.ts`, styled in
    `gmap/gmap.css`). After `idle` a greedy pass (`gmap/labels.ts`, priority selected, next, day
    order) hides labels that overlap; pips always show. Stacked stops cluster with
    `@googlemaps/markerclusterer` ("+N"); the next and selected stop are never clustered.
  - **Camera (brief 6q):** only explicit actions move it (Fit day, Show all days, "Show on map",
    picking a day, an opened item or a drag preview that is off screen). A scene that only changes
    `emphasisDay` never moves it.
  - **No adding from the map.** A tap on a Google place icon opens `PoiCard`: the place name (one
    `fetchFields` of `displayName` and `location`) and "Open in Google Maps" (`query_place_id`, a new
    tab, the app on a phone). Closes with the close key, Esc, a press outside or a pan. Google's own
    info window is suppressed; an empty spot does nothing. Adding is by search only (the add bar,
    the inspector place field, booking From/To, trip Where). Phones are otherwise read-only.
  - **Budget:** our map chunk (JS + CSS) must stay well under **320 KB gzip**; Google's script is
    third-party, loaded on demand and outside that budget. Trip route chunks stay near 50 KB. On
    phones the map is a full-screen view (history `#map`). Offline the map pane and its button are
    not rendered (5 s debounce), the plan widens, and nothing is requested.
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

## UI primitives (`src/components/ui/`)

Every trip overlay (and the House's New list / Edit list) is a composition of these, one file
each, styled by `ui/ui.css` from tokens on `:root` in `styles.css` (`--space-*`, `--radius-*`,
`--control-*`, `--row-h`, `--lead/--gap/--time-w`, `--sheet-*`, `--tier-*`, `--warn-*`). Import from
`@components/ui`; do not write one-off buttons, fields, chips or modals.

| Primitive | File | Is |
|---|---|---|
| `Sheet` | `Sheet.tsx` | The one overlay. Variants `sheet`, `panel` (docked over the map), `slip`, `confirm`, `chips` (popover on wide, small sheet elsewhere, hangs from `anchor`). Header: phone drag handle + close key; closes with the key, Esc (innermost only), scrim and swipe-down; `dirty` asks "Discard this?"; focus trap and return. Slots `identity`, `actions`, `details`, `footer` always lay out in that order. |
| `SheetIdentity`, `SheetTitle` | `SheetIdentity.tsx`, `SheetTitle.tsx` | Tier 1: leading mark, Outfit title (inline-editable, with the server's title limit), one muted context line. |
| `SheetActions` | `SheetActions.tsx` | Tier 2: the one yellow key and at most one quiet button. |
| `DetailGroup`, `NavRow` | `DetailGroup.tsx`, `NavRow.tsx` | Tier 3: a tinted group of 52px rows (label, value, chevron); a row is a button, link or opens a picker (`Sheet variant="chips"`). |
| `SheetFooter` | `SheetFooter.tsx` | Tier 4: "Added by Mia" and a red Delete. |
| `Button` | `Button.tsx` | `key`, `quiet`, `text` (`danger`); `href` makes it a link. |
| `Chip`, `ChipGroup` | `Chip.tsx`, `ChipGroup.tsx` | A pill that opens a picker; the large toggle choices (kinds, categories, times). |
| `Field`, `Switch` | `Field.tsx`, `Switch.tsx` | Borderless text field (with inline problem text); the yellow switch. |
| `Combobox` | `Combobox.tsx` | The one ARIA combobox: slips rise above an add bar, ↑/↓, Esc, Tab takes the ghost, polite count, `visualViewport` fit. Enter only picks a highlighted option, else `onSubmitText`. `AddItemBar` (pantry) and the trip `QuickAdd` (places) both use it; the draft stays in the bar. |
| `Stamp`, `Pip` | `Stamp.tsx`, `Pip.tsx` | Category/state tag; the colour dot. |
| `InlineWhen`, `InlineSelect`, `StampSelect` | `InlineWhen.tsx`, `InlineSelect.tsx`, `StampSelect.tsx` | The desktop inspector's in-place editors (variant `panel`; phones keep pickers). `InlineWhen`: a day select, a typed 24-hour time (`lib/trips/clock.ts` parses "9", "930", "2:30pm"; ↑/↓ ±15 min, Shift ±1 h; blank clears when allowed), and the length as segments. `InlineSelect`: a native select drawn like the paper (linked booking). `StampSelect`: stamps outlined in their colours, only the chosen one filled. The Place row stays a picker for now. |
| `Row` | `Row.tsx` | The row grid `[lead 24] 12 [time 48] 12 [title] [trail]`. |
| `Note`, `SectionLabel`, `EmptyState` | `Note.tsx`, `SectionLabel.tsx`, `EmptyState.tsx` | Muted/warn one-liner (warn = amber text + glyph, no side rule), small caps label, friendly empty line. |

Rules, enforced by `__tests__/ui.enforcement.test.ts`: trip files and `RoomPage` import no Ant
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
