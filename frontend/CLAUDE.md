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
- **Map and tiles-origin exception:** the map is lazy (`MapCanvas`: maplibre-gl, pmtiles,
  `@protomaps/basemaps`) and loads only when `VITE_PMTILES_URL` is set (optional
  `VITE_GLYPHS_URL`; without it text layers are dropped). That origin is the one allowed
  non-self origin and is served by us; no third-party tile or glyph hosts. Without it the page
  draws the plain SVG "Offline map".
- **Dev mock (no backend needed):** `cd frontend && VITE_MOCK_TRIPS=1 pnpm dev`
  (optionally `--port 5174 --strictPort --host 127.0.0.1`). It boots an MSW worker (a fetch
  shim if a service worker can't register) backed by `mocks/tripsServer.ts`, seeded from
  `mocks/seed.ts` ("Lisbon & Porto", dates relative to today). `?mockPhase=` picks the trip
  phase. Dev only; never in a production build.
- **Tests:** `__tests__/trips.helpers.tsx` has `renderTrips`, `seed`, `setViewport`,
  `lisbonTrip`, `meState`, `resetTripsWorld`; the shared in-memory `tripServer` is in `testServer.ts`.

## Ratchets (raise over time; never lower)

- **Coverage:** thresholds live in `vite.config.ts` (`test.coverage.thresholds`),
  set just under the current baseline. When you add tests, bump them to the new floor.
- **Lint:** `recommended` is on, but a batch of pre-existing violations (some a11y
  rules, plus `useExhaustiveDependencies`, `noArrayIndexKey`) are downgraded to
  `warn` in `biome.json` so the baseline is green. Fix violations and promote each
  rule back to error (its `recommended` default). Also open: `noExplicitAny` and
  `noNonNullAssertion` warnings to work down.
