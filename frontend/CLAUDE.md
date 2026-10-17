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
- **One window for the whole run.** The single fork shares one jsdom window across every test file,
  so global state a test leaves behind (stubs, `document.title`, pending timers) reaches later files.
- **`requestAnimationFrame` is ours, not jsdom's** (`setupTests.ts`): each frame is a ~16ms timeout
  on whichever clock is current, so fake timers drive frames while installed and can't leave frames
  dead afterwards (jsdom's shared frame interval could, which broke rAF-driven focus and sign-out in
  later files; `__tests__/testEnv.test.ts`).

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
- **Motion tier** (`lib/motion.ts`, set on `<html data-motion>` before mount): `lite` on every
  iPhone (any iOS browser; WebKit hides the model, and the full arrival is visibly slow even on an
  iPhone 15/16), on Save-Data, ≤4 cores or ≤4 GB; `full` on desktops, iPads and capable Android
  phones unless a frame check says otherwise: each CSS `animationstart` times 500ms of frames, a
  window is janky past 1/5 frames missed, and 2 janky windows of the last 6 switch to lite for a
  week (20 smooth in a row end the check). `?motion=full|lite` pins it. Lite skips the View Transition, halves
  confetti, stops `useScrollProgress`, and trims overlap in CSS (`:root[data-motion='lite']`
  blocks at the end of `styles.css` and in `ui.css`). **Rule for new motion:** animate
  `transform`/`opacity` only (fade a second layer in or out instead of animating a colour,
  border or shadow); anything that must lay out or repaint per frame, or that plays on top of a
  page's arrival, gets a lite override that removes it.

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

## Feature notes (read before changing a feature)

Full behavior lives in [docs/features/](../docs/features/README.md): [trips](../docs/features/trips.md)
(client, map, places, desk, dev mock), [lists](../docs/features/lists.md),
[suggestions](../docs/features/suggestions.md), [analytics](../docs/features/analytics.md) (tracker),
[landing](../docs/features/landing.md). The rules you must not break:

- **Trips:** mutations go through the store's outbox (`lib/trips/store.ts`), never straight to the API.
  Never persist Google place names/addresses (session memory only) and never print, log or render the
  Maps key. Every tab group uses `components/PillNav.tsx`.
- **Analytics:** events go only to our `POST /events`, carry no identity and no typed text. Tests need
  the default `POST /api/events` handler in `testServer.ts`.
- **Landing:** no `window`/`document` access outside effects and handlers (the page is prerendered).
  Calls to action say "Get started free". Offline is claimed for trips only.
- **Print and calendar:** print is a document (`PrintSheet`/`PrintOnly`, shown only between `beforeprint` and
  `afterprint`); a trip prints as a formal itinerary and neither it nor the .ics export ever includes
  confirmation codes, notes or Google place names.

## Design tokens (`src/styles.css`, top) and the living reference

All values come from the one `:root` block at the top of `src/styles.css`, grouped by role: type
(`--t-display`, `--t-title`, `--t-heading`, `--t-lead`, `--t-field`, `--t-body`, `--t-meta`, `--t-label`,
`--t-stamp`, `--t-code`), weights (`--w-regular/medium/semibold/bold`), inks (`--ink`, `--text`,
`--muted`), surfaces (`--bg`, `--desk-tone`, `--panel`, `--panel-subtle`; `--desk-tone` is the canvas colour and `theme-color`, see DESIGN.md), edges, accents, status, space, controls,
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
| `Sheet` | `Sheet.tsx` | The one overlay. Variants `sheet`, `panel` (docked over the map), `slip`, `confirm`, `chips` (popover on wide, small sheet elsewhere, hangs from `anchor`), `announce` (a centred dialog on every screen over a blurred desk, no close key, content then its one full-width yellow key that dismisses it; for rare moments like a run done). Header: phone drag handle + close key; closes with the key, Esc (innermost only), scrim and swipe-down; `dirty` asks "Discard this?"; focus trap and return. Slots `identity`, `actions`, `details`, `footer` always lay out in that order. |
| `SheetIdentity`, `SheetTitle` | `SheetIdentity.tsx`, `SheetTitle.tsx` | Tier 1: leading mark, Outfit title (inline-editable, with the server's title limit), one muted context line. |
| `SheetActions` | `SheetActions.tsx` | Tier 2: the one yellow key and at most one quiet button. |
| `DetailGroup`, `NavRow` | `DetailGroup.tsx`, `NavRow.tsx` | Tier 3: a tinted group of 52px rows (label, value, chevron); a row is a button, link or opens a picker (`Sheet variant="chips"`). |
| `SheetFooter` | `SheetFooter.tsx` | Tier 4: "Added by Mia" and a red Delete. |
| `Button` | `Button.tsx` | Paper at known heights: `key` (the one lifted control, one per sheet; sinks `--key-travel` when pressed; "not yet" is yellow soaked into the paper), `quiet` (a slip: rests a hair up, lifts on hover, presses in), `text` (ink on the sheet; `danger` is red). `iconOnly` makes a round one (the add bar's `kind="key" iconOnly` plus shows a paper disc while there's nothing to add). No `loading` spinner: the label says what is happening ("Saving…"). `href` makes it a link. |
| `Chip`, `ChipGroup` | `Chip.tsx`, `ChipGroup.tsx` | A pill that opens a picker; the large toggle choices (kinds, categories, times). |
| `StepSlider` | `StepSlider.tsx` | A few stops on one scale (autopilot: Off · Suggest · Assist): a 36px paper key slides along a groove pressed into the sheet, the groove fills with key yellow up to it, the key carries the chosen stop's glyph and turns it a quarter as it lands. One `role="slider"` (arrows, Home/End); drag snaps on release with a light haptic tick per stop; the names under the stops are tappable. For a matter of degree; a plain choice is a `ChipGroup`. |
| `Field`, `Switch` | `Field.tsx`, `Switch.tsx` | Borderless text field (with inline problem text); the yellow switch. |
| `Combobox` | `Combobox.tsx` | The one ARIA combobox: slips rise above an add bar, ↑/↓, Esc, Tab takes the ghost, polite count, `visualViewport` fit. Enter only picks a highlighted option, else `onSubmitText`. `AddItemBar` (pantry) and the trip `QuickAdd` (places) both use it; the draft stays in the bar. |
| `IconDisc` | `IconDisc.tsx` | A list's or trip's emoji on a round paper sticker, on a pale `--ground-*` tint of a brand colour (`md` 44px, `sm` 36px in a picker tile, `lg` 52px on the desk header; `blank` for no icon; `onClick` + `label` makes it a button). The only way an icon is drawn: use `ListIconDisc` / `TripIconDisc` (`components/IconDiscs.tsx`), which read the emoji and ground from `icons.ts` (`ICON_GROUND`, `TRIP_ICON_GROUND`). A new icon needs an emoji and a ground. |
| `Stamp`, `Pip` | `Stamp.tsx`, `Pip.tsx` | Category/state tag; the colour dot. |
| `InkStamp` | `InkStamp.tsx` | A rubber-stamp impression in green "done" ink, double-ruled, dated, off true, pressed in once; the centrepiece of an `announce` Sheet. Not a tag (that is `Stamp`). |
| `InlineWhen`, `InlineSelect`, `StampSelect` | `InlineWhen.tsx`, `InlineSelect.tsx`, `StampSelect.tsx` | The desktop inspector's in-place editors (variant `panel`; phones keep pickers). `InlineWhen`: a day select, a typed 24-hour time (`lib/trips/clock.ts` parses "9", "930", "2:30pm"; ↑/↓ ±15 min, Shift ±1 h; blank clears when allowed), and the length as segments. `InlineSelect`: a native select drawn like the paper (linked booking). `StampSelect`: stamps outlined in their colours, only the chosen one filled. The desktop Place rows (todo; booking From/To) are `InlinePlace` (Enter on typed text drops a pin from coordinates or keeps an address: `components/trips/typedPlace.ts`); phones keep `PlacePicker`. |
| `PrintSheet`, `PrintOnly` | `PrintSheet.tsx` | What a page prints, as a document: letterhead (`kicker`, `title`, `meta`, `facts`) and a body, in a portal beside the app root, mounted only between `beforeprint`/`afterprint` (`usePrinting`), the only thing on paper (print rules and `@page` in `ui.css`). `ListPrint` and `trips/TripPrint` are built from it. |
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
