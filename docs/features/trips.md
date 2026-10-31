# Trips (offline-first)

Shared trip planning that works offline: an op log on the client, one aggregate document per trip on the server, Google Maps in the browser only. Moved here from the layer guides; the must-keep invariants are repeated in [backend/CLAUDE.md](../../backend/CLAUDE.md) and [frontend/CLAUDE.md](../../frontend/CLAUDE.md).

## Backend (sync API, places, purge)

_Backend paths are relative to `backend/`; packages live under `backend/internal/`._

Spec: `docs/superpowers/specs/2026-10-14-trips-api-persistence-design.md`.

- One aggregate document per trip (todos and bookings embedded).
- **All writes** go through `POST /rooms/{id}/trips/ops`: typed patches, per-device `seq`
  idempotency (`acked[client_id]`), per-field `at` clocks, tombstones, soft delete +
  restore. `ApplyOp` is pure; the service persists with a compare-and-swap `ReplaceCAS`.
- **Reads** go through `POST /rooms/{id}/trips/sync` with `known: {trip_id: version}`. It
  returns per-entity deltas, `removed`, and a `base_version` on each delta that the client
  must match; otherwise it resyncs.
- **Client rules for op results:** drop ops that come back `rejected`/`unsupported` and
  revert their optimistic state; keep `retry` ops in the outbox; treat `duplicate` as
  acked; surface `conflicted` with its `skipped_fields`.
- Invariants: never add a write path to `trips` that bypasses `ApplyOp` + `ReplaceCAS`;
  trip handlers use `tripStatus` (500 default), not `statusFromErr` (400 default).
- **Amendment 2026-10-15:** `TripTodo`/`Booking` carry server-set `created_by`/`updated_by`
  (never patch fields; a patch naming them is `unsupported`). `Place.locality` is user-typed
  content (the server never fills it). The trip has `stops` (ordered `[]Place`, cap 12, replaced
  whole via `trip.update`, clock `field_at["stops"]`) and `days` (date -> label <=40 chars,
  cap 60; `""` removes; clock `field_at["days.<date>"]`, so labelling different days never
  conflicts). Over-cap patches are rejected with code `cap`. `field_at` keys with dots are
  fine because trips are only ever written as whole documents (`ReplaceCAS`).
- **Who's going (2026-10-17):** `travellers` (user ids, cap 20, no blanks or duplicates) is
  replaced whole via `trip.update` (clock `field_at["travellers"]`); null or `[]` is the whole
  House (stored as absent). The service passes the House's members into `Ctx.Members` and a
  non-member is rejected per op as `invalid`; the pure engine (no `Members`) only checks shape.
  Ids of people who later leave are ignored at read time. Trip settings has a "Who's going" row
  (Everyone, or any members, via `ChipGroup` `values`), shown only in a House of two or more.
  `trips/presence.go` turns a House's trips into away spans for analytics (`HouseAway`: every
  current member away at once; `MemberAway`), from `start_date` 00:00 to `end_date` 24:00 in the
  trip's zone (the House's when empty); deleted and dateless trips don't count. `trips.EventsFor`
  emits `trip.away_changed` when dates, `tz` or travellers change and when a dated trip is created,
  deleted or restored, so analytics re-learns that House in home time (see analytics.md).
- **Attribution:** todos and bookings also carry server-set `updated_at` (UTC), stamped with
  `created_by`/`updated_by` on every applied change (create, update, and the booking-delete
  cascade); duplicate and fully-conflicted ops leave it alone. `GET /rooms/me` `members_meta`
  entries include `user_id` so clients can resolve `created_by`/`updated_by`/`done_by`.
- **Booking end_place:** `Booking.end_place` (optional, `null` clears; same Place validation
  and strict nested decoding) is the arrival / drop-off, `place` the departure / pick-up /
  only place. Own clock `field_at["end_place"]`. If a patch sets `end_place` with a tz and
  does not name `end_tz`, `end_tz` is derived from it (own clock); `start_tz` is never
  derived from `place`.
- **Trip icon:** `icon` (omitempty) on the trip fields, set via trip.create/update, clock
  `field_at["icon"]`; one of SUITCASE, PLANE, BEACH, MOUNTAIN, CITY, TRAIN, ROAD_TRIP,
  CAMPING, MAP, LANDMARK, WINE, SKI; `""` clears; anything else is `invalid`.
- **Todo -> booking link:** `TripTodo.booking_id` (optional, `null` clears) is set through
  todo.create/update. It must name a live booking of the same trip, else `invalid`; it has
  the normal clock `field_at["booking_id"]`. `booking.delete` clears the link on every todo
  that references it in the same write (todo `v` bumped, `updated_by` set), so those todos
  appear in the delta.
- **Batch semantics:** ops are grouped per trip and applied in `seq` order per `client_id`
  (array order across clients is kept). **Only one flusher may run per `client_id`**: seqs
  are a per-device total order, and a lower seq arriving after a higher one is `duplicate`.
  A storage error on one trip turns that trip's ops into `retry` and the rest of the batch
  proceeds; only a dead request context fails the whole call.
- **Bounded documents:** `acked` entries carry a last-seen time and are pruned after 30 days
  idle; at most 3 new `client_id`s per trip per batch and 200 per trip (else `cap`, seq not
  consumed). A `days` patch has at most 60 keys; `days.*` clocks are capped at 240 per trip
  and pruned for unlabelled dates after 30 days. Pruning an old `acked` entry means a replay
  older than 30 days could re-apply, the same horizon as tombstones.
- Packing-list link is stale (and relinked) only for not-found, soft-deleted, or a list in
  another room (e.g. left behind in a deleted solo room after a join); other lookup errors
  surface. Lists are not moved on join.
- **Places (Google Maps Platform, spec `2026-10-15-google-maps-migration.md`):** the server has
  no geocoder and no `/places/*` routes (they 404); search, autocomplete and maps run in the
  browser. `Place.source` is `google | pin | manual` (`photon` and `osm_ref` are gone; no migration).
  - `google`: `place_id` required (<= 256). `name` and `address` must be empty (Google content
    may not be stored; `invalid` otherwise). `lat`/`lng` come as a pair and only with
    `coords_fetched_at` no older than 30 days and not in the future (`invalid` otherwise);
    `tz` is always allowed; `locality` is allowed as user-typed content. A purged place is just
    `place_id` (+ `tz`, `locality`).
  - `pin` / `manual`: `name` and `lat`/`lng` required, `address`/`tz`/`locality` optional; no
    `place_id`, no `coords_fetched_at`.
  - A todo may have a blank title only when it has a Google place (the title is user content); any other todo still needs a non-blank title.
  - **tz decision:** clients send `tz`. When a google place has coordinates but no tz, `ApplyOp`
    derives it from lat/lng with tzf (`Ctx.TZ`, wired by `TripService.UseTZ`). tzf therefore
    stays, but loads lazily on the first such place (~34 MB heap, ~150 ms), never at startup.
    Photon removal saved no tzf cost; it removed the proxy, `place_cache`, `PHOTON_BASE_URL`
    and the places rate limiters. `time/tzdata` stays for validating zone names.
  - **30-day purge:** `Trip.coords_expire_at` (server-only, partial index) is the earliest
    moment a stored Google coordinate turns 30 days old, recomputed on every write.
    `TripService.PurgeStaleCoords` reads only trips due by that index (soft-deleted ones
    included), nulls `lat`, `lng`, `coords_fetched_at` on stale places (keeps `place_id`, `tz`),
    sets `v` on touched todos/bookings (and the trip fields when destination/stops changed),
    bumps `version`, and writes with the usual CAS, so clients receive a normal delta.
    Touched todos/bookings get `updated_by = "system:coords-purge"` (not a user id: render it
    as "Bauhouse" or nothing) and a fresh `updated_at`. It is idempotent and runs at startup
    and every 24h plus up to 1h jitter (`RunCoordsPurge`); a lost CAS race is retried next run.
  - Rate limiter burst is `ratelimit.Burst(rps)` (>= 1). All trip endpoints, including
    packing-list, share the per-user trips limiter.

## Frontend (client, map, desk)

_Frontend paths are relative to `frontend/src/`._

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
    changes `emphasisDay`: the day crossing a reading line under the sticky chrome
    (`pages/trip/useDayInView.ts`). Over the last stretch of the list that line slides down to the
    bottom edge (`readingLine`), so the last days, which can never scroll up to it, still get their
    turn. When that day's stops are all off screen (or piled up when zoomed out) the
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
    todo title is user content only: picking a place in the add bar keeps what was typed as the
    title (never Google's name, which can come back in another language); a blank title is allowed
    only with a Google place. `osm_ref` and the `photon` source are gone; the `/places/*` proxy too.
  - **Search** (`placesSource.ts`, `usePlaces.ts`): `AutocompleteSuggestion.fetchAutocompleteSuggestions`
    with one session token per search session, biased (`locationBias`, never a restriction, so any
    city is still findable) to where the day being edited is: `placeBias.ts` `dayBias` takes the
    day's own pinned items (a Lisbon to Porto day leans on both: `biasBox` draws one box round
    them, 25 km padding, capped at 5 degrees, past which only the last point counts), else the last
    place of the closest earlier day, else the destination or first stop (also for Ideas). Points
    are rounded to 0.1 degree. 250 ms debounce, at least 2 characters. A pick calls `fetchFields` on the prediction's place
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
    booking From/To and trip Where (a set place stays shown with a search under it, so a pick
    replaces it in one step; ✕ removes it); `QuickAdd` is the add bar (its highlighted suggestion previews as
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
- **Incomplete data (every surface must read finished with gaps in it):**
  - A stay with no check-out runs to the trip's last day (`stayEndDay` in `lib/trips/schedule.ts`,
    `bookingOverMs` in `lib/trips/bookings.ts`): it is tonight's stay, "Now · no check-out yet" in
    Bookings, and Ready to go says "<stay> has no check-out" with "Add check-out" (`open-booking`).
  - A booking with no title goes by its kind (`bookingName`, `lib/trips/kinds.ts`); one with no date
    says "No date yet". An item whose Google place has not loaded says "Saved place" in its sheet
    too. The default category (`other`) shows no stamp.
  - A folded day (phones) says what it holds: "3 plans", a booking ("Car at 09:00"), or "Nothing
    yet"; both day pickers (header and add bar) show the same notes. An empty day with a booking the
    plan leaves to Bookings says "Nothing planned yet · Car at 09:00".
  - Overlaps: a todo and a booking that are linked or start the same minute are one plan, never a
    clash; names in a warning are cut at 24 characters.
  - Phone rows end in the category dot only; who changed a row shows only on desks (CSS, `trips.css`).
- **Dev mock (no backend needed):** `cd frontend && VITE_MOCK_TRIPS=1 pnpm dev --port 5174 --strictPort --host 127.0.0.1`
  (or just `pnpm dev`). It boots an MSW worker (a fetch
  shim if a service worker can't register) backed by `mocks/tripsServer.ts`, seeded from
  `mocks/seed.ts` ("Lisbon & Porto", dates relative to today, plus "Seville, Granada & maybe Córdoba",
  a half-planned trip on the same dates for checking incomplete data: empty days, items with no time
  or place, an unloaded Google place, untitled and undated bookings, a stay with no check-out). `?mockPhase=before|during|after`
  picks the seed's phase and re-seeds from scratch on every load that carries it (every trips
  database, including the mock user's, is deleted first; without the param the tab keeps its last
  phase, default `during`). Dev only; never in a production build.
- **Tests:** `__tests__/trips.helpers.tsx` has `renderTrips`, `seed`, `setViewport`,
  `lisbonTrip`, `meState`, `resetTripsWorld`; the shared in-memory `tripServer` is in `testServer.ts`.

## Calendar, print and the Trips pill (frontend only)

- **Add to calendar** (trip ⋯ menu, only when the trip has dates): `lib/trips/ics.ts` builds an .ics file on the
  device (works offline): one all-day event spanning the trip and one event per dated booking, timed ones in
  UTC from their own zone. No todos, confirmation codes, notes or Google place names/addresses (only
  user-typed place text). Stable UIDs (`<id>@bauhouse`) so re-importing updates. A snapshot, not a feed.
- **Print:** the List and Trip ⋯ menus have Print (`window.print()`); Cmd+P works the same, and "Save as PDF"
  gives a file. It is laid out as a document (letterhead, summary, numbered sections, tables, page footer; see
  DESIGN.md, "Print"). `TripPrint` is a formal itinerary built from `lib/trips/itinerary.ts` (pure
  `buildItinerary`: summary, transport, accommodation, other bookings, days): enough for a visa appointment.
  `ListPrint` prints unchecked items by category with a box to tick. Neither prints confirmation codes or notes.
  The page footer (title, site, "Page N of M") is an `@page` margin box, so only Chrome and Edge draw it;
  elsewhere the closing line "Prepared with Bauhouse · bauhouse.app" (`SITE_URL`) stands in.
- **Trips pill countdown:** with no trip under way, a trip starting within 7 days shows on the House's Trips
  pill as "Trips · 5d" (`daysToNextTrip` in `lib/trips/schedule.ts`).
