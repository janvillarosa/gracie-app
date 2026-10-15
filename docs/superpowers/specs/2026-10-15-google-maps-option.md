# Google Maps option for Trips: decision report

Date: 2026-10-15. Spike, no code changed. Sources were fetched on this date; items I could not confirm from an official page are marked **unverified**.

## Recommendation

- **Do not adopt.** Keep Protomaps + MapLibre + Photon.
- Google's terms forbid the core of our design: storing place name, address and lat/lng in our DB and in IndexedDB, and showing Places data on a non-Google map. A Google-only stack would need a Google map everywhere, plus 30-day refetches that fail with no signal.
- Cost is also real: roughly $25/month at 100 households, $650 at 1,000 and $7-8k at 10,000 (estimates below), against a near-zero marginal cost today.
- Cheap, safe use of Google: "Open in Maps" links (no key; **unverified** here, check the Maps URLs docs). Revisit only if the owner accepts online-only places and a Google map on every surface.

## Terms collisions (most important)

Source: [Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) and [Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms), fetched 2026-10-15.

1. **Places on a non-Google map is banned.** Service terms 14.2: "Customer must not use Google Maps Content from the Places API in conjunction with a non-Google map." ToS: "Customer will not (i) display or use Places content on a non-Google Map". So Places Autocomplete/Details cannot feed our MapLibre map. Exception: 15.1, Places UI Kit "with or without any map, including a non-Google Map" (a prebuilt Google widget, not a data API; **unverified** that it fits our add bar or offline needs).
2. **Geocoding on a non-Google map is banned.** 6.2 has the same wording for the Geocoding API.
3. **No storing of lat/lng beyond 30 days (Places).** 14.3: "may temporarily cache latitude and longitude values from the Places API for up to 30 consecutive calendar days, after which Customer must delete". Our `Place` snapshot lives for the life of the trip.
4. **No storing of names and addresses.** ToS "No Scraping": Customer will not "pre-fetch, index, store, reshare, or rehost Google Maps Content outside the services" or "copy and save business names, addresses, or user reviews". "No Caching: ... except as expressly permitted". The Places terms list no name/address allowance.
5. **Geocoding's indefinite-cache clause does not fit.** 6.3.2 allows indefinite cache of lat/lng and address only "solely to support the direct, End User facing functionality ... not ... a replacement for making an additional call", and "Cached data must be logically isolated to the specific End User ... and must not be used across multiple End Users." A shared House breaks that, and it covers Geocoding only, not Places.
6. **place_id is the one thing we may keep.** General terms 3: "Customer may cache the Google ID values ... (a) place_id from Places API". [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies): "You can therefore store place ID values indefinitely." Offline would then need a refetch of everything else.
7. **Places results must sit on a Google map or carry the logo.** Places policies: "Places API results displayed on a map must be shown on a Google Map"; without a map, "you must include the Google logo".
8. **Map Tiles in MapLibre is allowed, with limits.** [Map Tiles policies](https://developers.google.com/maps/documentation/tile/policies): you "must not overlap or obscure the Google logo with any other logo", attribution must say "Google Maps" and the data providers, you must "not pre-fetch, index, store, or cache any Content", and "Offline uses" are not permitted. So no service-worker tile cache, and the map is blank offline. (The ToS "Use With Non-Google Maps" clause names "Core Services"; whether Map Tiles counts is **unverified**.)
9. **EEA billing addresses.** The tiles overview says EEA terms apply from 8 July 2025 and "some Map Tiles content is no longer returned" ([2D tiles overview](https://developers.google.com/maps/documentation/tile/2d-tiles-overview)). This depends on the billing account address, not on end users. The detail is **unverified** (the EEA terms page would not load).

## Options compared

Scores: 1 (poor) to 5 (good). "Terms fit" means fit with offline snapshots and a non-Google map.

| | Protomaps + Photon (current) | (a) Maps JS API | (b) Map Tiles 2D in MapLibre | (c) vis.gl wrapper |
|---|---|---|---|---|
| Cost | 5 (Protomaps hosted price not researched; Photon self-hosted) | 2 | 3 | 2 (same Maps JS billing) |
| Quality, POIs | 3 (OSM gaps in some regions) | 5 | 4 | 5 |
| Terms fit | 5 (ODbL attribution) | 1 | 2 (no offline, no store) | 1 |
| Old phones | 4 (~301 KB gzip, lazy) | 2 (script loads at runtime; size **unverified**; I assume heavier than MapLibre) | 3 (MapLibre cost, plus session-token tile calls) | 2 (adds a React layer to Maps JS) |
| Privacy | 5 (our proxy, one tile origin) | 2 | 3 | 2 |
| Effort | 5 (done) | 2 | 2 | 2 |

Notes per option:
- **(a) Maps JS API.** Raster or vector (vector needs a Map ID). Styling goes through Cloud-based styling in the console, which can style or hide POIs ([docs](https://developers.google.com/maps/documentation/javascript/cloud-customization/overview)); a quiet light look is probably achievable but not tested. POI click is supported in the API (`placeId` on click, from my knowledge; the events page did not confirm it, so **unverified**). Pin performance at ~150 AdvancedMarkers is **unverified**. It adds a third-party script origin, which breaks the frontend rule of no third-party script origins and needs a CSP change.
- **(b) 2D Map Tiles.** Roadmap tiles are images rendered from Google's vector data (themes: roadmap, satellite, terrain). They are raster, so styling is limited to Google's style options. A session token is required on every request. No POI click, because tiles carry no feature data; click-to-add would need Geocoding/Places, which cannot be used with a non-Google map (items 1-2).
- **(c) vis.gl.** It only wraps (a), so it has the same terms, cost and script origin. It gives clean React ergonomics and adds a dependency.

## Places and Geocoding as a Photon replacement

- **Quality.** Google is stronger for travel POIs, opening hours and ratings. We do not need those fields, and requesting them moves the call to a Pro/Enterprise SKU ([session pricing](https://developers.google.com/maps/documentation/places/web-service/session-pricing)).
- **Sessions.** Autocomplete (New) with a session token: the first 12 requests are billed per request, then free; the closing Place Details bills at its tier. Abandoned sessions bill every keystroke request. Token lifetime is **unverified**.
- **Proxy shape.** Same Go `Geocoder` interface; a `GooglePlacesGeocoder` with a server key, a field mask limited to the Essentials fields we need (id, displayName, formattedAddress, location), and the session token passed through from the client. We could not keep the `place_cache` for results: terms 14.3 and No Caching cap lat/lng at 30 days and bar names and addresses, so the TTL would drop from 30 days to under 30 and caching names/addresses is not permitted at all.
- **tz.** Our offline `tzf` lookup from lat/lng is derived content; whether it breaches "No Creating Content" is **unverified**.

## Cost estimates

Assumptions: per household per month, 20 trip-page views (each one map load) and 30 place searches. Each search is 1 session of ~6 Autocomplete requests plus 1 Place Details with Essentials fields (180 + 30 calls). Add 5 reverse geocodes. List prices per 1,000 calls, first tier, from the [pricing page](https://developers.google.com/maps/billing-and-pricing/pricing) and the [pricing overview](https://mapsplatform.google.com/pricing/): Dynamic Maps $7.00 (10k free), Autocomplete Requests $2.83 (10k free), Place Details Essentials $5.00 (10k free), Geocoding $5.00 (10k free), 2D Map Tiles $0.60 (100k free; billing unit **unverified**). Free usage is per SKU per month since 1 March 2025. Volume discounts of 20%+ above 100k are not applied.

| Households | Map loads | Autocomplete | Details | Geocode | Approx. total |
|---|---|---|---|---|---|
| 100 | 2k, free | 18k, ~$23 | 3k, free | 0.5k, free | **~$25/mo** |
| 1,000 | 20k, ~$70 | 180k, ~$480 | 30k, ~$100 | 5k, free | **~$650/mo** |
| 10,000 | 200k, ~$1.3k | 1.8M, ~$4-5k | 300k, ~$1.4k | 50k, ~$200 | **~$7-8k/mo** |

Map Tiles instead of Dynamic Maps (assuming ~20 tiles per view): 10,000 households is about 4M tiles, ~$2.3k, so roughly double the map-load cost.

## Security and privacy

- Browser key: HTTP-referrer restriction plus an API restriction; a separate server key for the proxy, restricted by IP (egress IP stability depends on hosting). Referrer-restricted keys are public in page source.
- Data sent to Google: viewer IP and user agent on every script and tile call, map viewport, and search text. Our proxy keeps that off the client for Places, but not for the map.
- EU users: a Google script origin and its cookies and local storage likely need consent. Google's controller/processor roles and consent-mode details are **unverified** (EEA page not readable).

## Offline-first impact

With no signal, Google map tiles show nothing (no tile cache, no offline use). Place snapshots would need deletion of lat/lng after 30 days, so an old trip loses pins just when someone opens it abroad. Names and addresses could not be stored at all. Currently, snapshots and the cached tiles we are allowed to keep keep working. Only place_id survives.

## Engineering cost to switch (days)

- `MapCanvas` rewrite, Google script loader, CSP, styling: 3-4
- `GooglePlacesGeocoder`, session-token flow, field masks, rate limits, tests: 2-3
- `Place` model: add `place_id`, expiry on lat/lng, refetch job, client re-hydrate: 2-3
- `place_cache` rework and the offline/IndexedDB expiry logic: 1-2
- Consent UI, attribution, key setup: 1

Total about 9-13 days, and the offline design needs a rethink.

## Open questions for the owner

1. Is an online-only place model acceptable, or are offline pins on trips a must-have?
2. Do you accept Google branding on every map surface, plus consent for EU users?
3. What is the budget ceiling per household per month?
4. Is OSM data quality in your target regions actually a problem? Any examples that failed in Photon?
5. Would a hybrid help: Google only for "Open in Maps" links, with Photon unchanged?
6. Do you want legal review of the 30-day rule, since this report is not legal advice?
