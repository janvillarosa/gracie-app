# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Installable PWA (`display: standalone`, `frontend/src/assets/site.webmanifest`). Used on phones
and on desktop browsers. Mobile web, not native.

## Users

Members of a **House**: a small group (a couple, a family, housemates) who share one space in
the app. Every member can read and write everything in the House.

- **At home / in the shop:** someone with a phone in one hand, adding or ticking off list
  items fast.
- **Planning a trip (desktop, weeks or days before):** two or more members plan in parallel.
  They shape days, collect ideas, think about geography and enter logistics. They care who
  added or changed what.
- **On the trip (phone, often weak or no signal):** a member wants what's next today, needs to
  pull up a booking at a counter or door, and captures ideas or ticks things off as plans
  change.

## Product Purpose

Bauhouse is the shared notebook for a household: lists (groceries, chores, packing) and, next,
trips. It exists so the people who live together can plan and run the shared parts of life in
one place, without one person owning the plan. Success is the House using one plan together
instead of a group chat plus screenshots.

## Positioning

Built for a household, not one traveller or a team. The same people who share the grocery
list share the trip. Every plan is co-owned by the House by default. Trips reuse House
objects: a trip's packing list is a normal Bauhouse List.

## Operating Context

- Lists: add bar with pantry autocomplete, category stamps, check-off with confetti, notes,
  grouped view, swipe-to-delete with undo.
- Trips (designed, not built yet; spec: `docs/superpowers/specs/2026-10-14-trips-api-persistence-design.md`):
  a trip has a destination, dates (or none, as a draft), a time zone and notes. It holds
  **todos** (checkbox, title, day or no day = **Ideas**, start time, duration, category, notes,
  place, "open in maps"), a **bookings vault** (flight, stay, train, car, ticket, other, with
  confirmation codes and per-end time zones) and an optional linked **packing list**.
- Typical trips range from day trips and weekends to 1–2 week holidays that move between
  cities (50–150 todos; caps are 150 todos and 50 bookings per trip).
- Trips must be fast and work offline: local copy, outbox, delta sync. Edits made offline can
  come back as "conflicted" when another member changed the same field.

## Capabilities and Constraints

- Stack: Go + chi API, MongoDB; React 18 + Vite + TypeScript, Ant Design + Tailwind v4,
  TanStack Query, React Router. Self-hosted fonts; no third-party font or script origins.
  Map tiles come from one allowed origin, `api.protomaps.com`.
- Places come from an OSM geocoder (Photon) via a backend proxy. The UI must show OSM/ODbL
  attribution. Search can degrade; manual place or dropped pin is the fallback.
- Times are wall-clock + IANA zone. A flight can start and end in different zones.
- Packing list linking is online-only.
- Trip delete is soft; any member can restore within 30 days.
- Terminology: UI says **House**, backend says room. Internal names stay "gracie".
- Low-end devices matter: lazy routes, memoised rows, no permanent `will-change`, hover
  behind `(hover: hover)`, motion behind `prefers-reduced-motion: no-preference`.
- Multi-city trips: the trip keeps one destination and one zone. The route ("Lisbon → Porto") is
  a hand-entered list of stops. Todos store their own place and zone. Todos and bookings
  record who added and last changed them. Days can carry labels.
- Maps: MapLibre GL with the Protomaps hosted API (one allowed third-party origin,
  `api.protomaps.com`). No offline tile prefetch.

## Brand Commitments

- User-facing name **Bauhouse**; internal name Gracie. Do not rename internal identifiers.
- The House mark (`HouseMark` inline SVG, traced from `logo-168.png`) is the in-app logo.
- Voice: plain, warm, short. Sentence case. Confirmations say what happened ("3 checked off").

## Evidence on Hand

- Logo artwork: `frontend/src/assets/logo-168.png`, `logo-112.png`; PWA icons in the same folder.
- No real trip data, photos or user research exists. Demonstration data must be labelled
  synthetic.

## Product Principles

1. **The House owns the plan.** No single owner; show who did what without making it a
   permissions system.
2. **Instant, even offline.** Every tap lands locally first. Sync state is honest but never
   blocks the user.
3. **Simple first, capable underneath.** The common path (what's next, tick, add) is one tap;
   depth (time zones, bookings, reordering, geography) is there when asked for.
4. **One product, two postures.** Desktop is for shaping the plan; the phone is for living it.
   Same data, different priorities.

## Accessibility & Inclusion

- Keyboard and screen-reader parity for every drag interaction (reorder, move to a day).
- 44px touch targets; 16px inputs to avoid iOS zoom.
- Respect `prefers-reduced-motion`.
