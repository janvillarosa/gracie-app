# Landing page (`/`, logged out)

The logged-out marketing page. Visual rules are in the root [DESIGN.md](../../DESIGN.md).

## Frontend

_Frontend paths are relative to `frontend/src/`._

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
- The page's thesis: one shared space for the household that learns it, from the weekly shop to the next trip. Five parts and a close: hero, **Meet Butler** (`Butler.tsx`, id `butler`, on an Ink field: one Groceries list through a week, three moments as tabs (Thursday's suggestion, Friday night's assist adds, Saturday's Up next), each the app's own slip redrawn; the data and the step each moment plays out are pure in `butlerWeek.ts`. While on screen the moments come round every 6.4s, the active tab's rule filling as it holds, until the visitor picks one; with reduced motion nothing turns or plays. It says Butler speaks up after a few weeks and never buys or books anything; keep claims to what Suggest, Assist and Up next do), **Lists that sort themselves** (`SharedPlate.tsx`, id `lists`), **Plan the trip together** (`Capabilities.tsx`, id `trips`: a weekend in Porto in two views behind two tab pills, "Planning at home" = `PlanDesk.tsx`, the desk with the drawn `PortoMap.tsx` in a MacBook Pro frame, and "On the trip" = `PhoneTrip.tsx` in an iPhone 14 Pro frame, plus `OfflineSlip`. The frames are Devices.css (MIT), vendored as `components/landing/devices.css` (only those two devices; its reset is scoped to the frame's own parts, and the notice is a `/*!` comment so the build keeps it); `DeviceFit.tsx` scales a frame to the width it has; both views stay in the markup without JavaScript), **It costs nothing** (`FreeReceipt`, with `InstallLine`), then the closing sentence. The lists section's looping typing demo keeps its logic in `demo.ts` (`plateTick`, `plateLand`): one tick per new line, and a line already on the list is never landed again, so leaving and coming back mid-word can't duplicate or shrink it. It plays only while on screen and rests on a finished list with reduced motion. Calls to action say "Get started free" (never "Try"). `StickyKey` pins that key to the bottom of phones once the hero's has scrolled away, and steps aside while another key, the close, the footer or a `[data-ui]` picture is in its strip.
- Offline is claimed for trips only (lists have no outbox yet). Bring back a page-wide claim only once lists work offline.
- **Install:** `lib/installPrompt.ts` keeps the `beforeinstallprompt` event (listener registered in `main.tsx`, no `preventDefault`), and `useInstallWay()` returns `prompt` / `ios` / `installed` / `browser`; the receipt section shows an install button, Safari's step, or nothing accordingly.
- **Prerender:** `pnpm build` also runs `vite build --ssr src/landing.server.tsx` and `scripts/prerender.mjs`, which writes the landing HTML into `#prerender` in `dist/index.html` and links the landing stylesheet. An inline script drops it before paint on other routes and for signed-in members; `Landing` removes it in a layout effect. Keep the landing page free of `window`/`document` access outside effects and handlers (use `useClientLayoutEffect` for layout effects). An optional `SITE_URL` at build time makes `og:url`/`og:image` absolute. The Dockerfile copies `scripts/` and `public/`.
