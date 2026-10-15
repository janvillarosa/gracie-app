# Trips: migrate maps and places to Google Maps Platform (plan)

**Status:** draft, awaiting approval. No code changes until this is approved.

**Decision (2026-10-15):** the product owner chose full Google Maps over keeping Protomaps and Photon,
having seen the trade-offs in `2026-10-15-google-maps-option.md`. This plan replaces brief sections
6j (tiles), 6s (map fonts) and the Photon parts of the API spec.

## Why "full" (Google terms that shape the design)

- **Places and Geocoding content must be shown on a Google map.** Autocomplete therefore can't feed a
  MapLibre map: the map moves too.
- **Only `place_id` may be stored indefinitely.** Google latitude and longitude may be cached for at most
  30 consecutive days, then refreshed or deleted. Google names and addresses may not be stored.
- **Attribution:** the Google logo and data attributions stay visible and unobscured on every map.

Have someone review the Google Maps Platform terms against this plan before launch. Clause references
are in `2026-10-15-google-maps-option.md`.

## Target architecture

**Map (frontend):** the Maps JavaScript API, loaded lazily (dynamic import of
`@googlemaps/js-api-loader`, or `@vis.gl/react-google-maps`), behind the existing `MapView` adapter
(`components/trips/mapView.ts`). `TripPage` doesn't change.

- **Style:** a cloud-styled **Map ID** set to a quiet light style matching Bauhouse paper, with POI
  icons muted.
- **Pins:** `AdvancedMarkerElement` with our own HTML pip and name label in Figtree, so the app's font
  is used, with no glyphs needed. Clustering uses `@googlemaps/markerclusterer` for "+N". Label
  collision uses a small greedy pass after `idle`, the same priority rules as today (selected, then
  next, then day order).
- **Behaviour (unchanged product rules):**
  - Desktop: interactive zoom and pan (native), Fit day and Show all days.
  - The map **stays put** while the list scrolls (6q); camera moves only on explicit actions.
  - Click-to-add: a POI click gives a `placeId`, then Place Details; an empty spot gives reverse
    Geocoding.
  - The phone map view is read-only.
  - **Offline: no map** (unchanged).
- **The route line:** a `Polyline` in the day colour.

**Places autocomplete:** Places API (New) via the JS library (`AutocompleteSuggestion` with session
tokens), called from the browser with a referrer-restricted key.

- Used by the shared `Combobox` in the add bar, the inspector Place field, the phone picker and the
  booking From/To fields.
- Field masks are limited to Essentials (`id`, `displayName`, `formattedAddress`, `location`, plus
  `addressComponents` for locality where it's an Essentials field).

**Place model (backend and client):** `Place` gains `place_id`, `source: "google"`, and
`coords_fetched_at`.

- **Google-sourced places store** `place_id`, `lat`, `lng`, `tz` and `coords_fetched_at`. They store
  **no** Google name or address.
- **Manual and dropped-pin places** keep name and address (user content), as today.
- **The todo title is user content.** Autofill copies the Google name into the title field as a
  suggestion the user accepts. This is flagged for the terms review; the alternative is leaving the
  title blank.
- **The display name** of a Google place comes from Place Details fetched while online, held in memory
  or the session only.
- **Offline,** rows show the user's title, and the place line shows only the locality the user typed,
  or nothing.

**Coordinate freshness:**
- When online, the client refreshes Google coordinates older than 25 days for current and upcoming
  trips. That's a Place Details call with the `location` field only, batched and rate-limited.
- The server rejects storing Google coordinates with `coords_fetched_at` older than 30 days.
- A daily backend job nulls Google coordinates older than 30 days. A trip planned more than 30 days
  out refreshes on its next open.

**Removed:**
- `maplibre-gl`, `@protomaps/basemaps`, `pmtiles`, `/public/map-glyphs`, and the glyph build script.
- The Photon proxy (`internal/services/places/*`, the `/places/*` endpoints, `place_cache` and its
  indexes, and `PHOTON_*`).
- The `tzf` geocoder use. `tzf` stays only for coordinates → time zone on the server, if still needed.
- `VITE_PROTOMAPS_API_KEY`, `VITE_PMTILES_URL` and `VITE_GLYPHS_URL`.

**Open Maps:** a Google Maps URL with `query_place_id` when a place has one, which is more precise.
iOS keeps the Apple Maps link (6t).

## Keys, security and cost

- **The browser key** `VITE_GOOGLE_MAPS_API_KEY`:
  - HTTP-referrer restrictions on the production domains and localhost dev ports;
  - API restrictions limited to the Maps JavaScript API, Places API (New) and Geocoding API.
- **The Map ID** goes in `VITE_GOOGLE_MAP_ID`. The product owner supplies both in the git-ignored
  `frontend/.env.development.local`. **Claude never handles the key value.**
- **Third-party origins** (`maps.googleapis.com`, `maps.gstatic.com`) are a narrow, documented
  exception in `frontend/CLAUDE.md`.
- **Cost controls:** per-API daily quotas and a billing budget alert, set by the owner in the Cloud
  console. Session tokens and Essentials field masks keep Autocomplete and Details on the cheapest
  SKUs. Estimates are in the research report (about $650 a month at 1,000 households).
- **Privacy:** searches and coordinates are sent to Google. Update the privacy notice; EU users may
  need a consent line.

## Performance on old devices

The Maps JS API is fetched only when the map is first shown (desktop) or the phone map opens. It's
counted as a third-party script outside our 320 KB chunk budget. Measure the load on the 6× CPU
harness. It must not block the trip route (about 50 KB).

## Work plan (agents, in order)

1. **Backend** (`backend/` only):
   - add `place_id`, `source: google` and `coords_fetched_at` to `Place`;
   - the validation rules and the 30-day coordinate rule;
   - the purge job;
   - remove Photon, `/places/*` and `place_cache`;
   - migrate existing `photon` places, which keep their names as legacy.
   - Tests and integration tests.
2. **Frontend map** (`components/trips/map*`, the `MapView` adapter):
   - the Google map implementation behind the adapter: markers, labels, clustering, route,
     click-to-add, Fit day, stays put, the phone read-only view;
   - remove the MapLibre code.
3. **Frontend places:** a Places Autocomplete source for the shared `Combobox` and the inline Place
   field, plus the client coordinate refresh.
4. **QA:** flows S15.6, S15.9 and S15.10 with the real key, plus the throttled performance run and a
   cost sanity check (call counts per flow).

Steps 1 and 2 can run in parallel in separate worktrees. Step 3 follows step 2.

## Open decisions for the owner

1. **Title autofill:** copy the Google name into the editable title (flagged for the terms review), or
   leave it blank and show the Google name only while online.
2. **Legacy Photon places:** keep their stored names as they are (user-equivalent content), or
   re-resolve them to Google `place_id`s.
3. **Map ID style:** use Google's "light" preset with muted POIs, or a custom style. Either can be
   tweaked later in the Cloud console without code.
