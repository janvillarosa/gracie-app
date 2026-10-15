# Trips UI: impeccable audit (2026-10-15)

- **Scope:** `pages/TripPage.tsx`, `pages/trip/*`, `pages/TripSettings.tsx`, `components/trips/*`,
  `components/ui/*`, the House Lists · Trips pill, `trips.css`, `ui.css`.
- **Build:** `feature/trips` at `990b204` (make check green, 573 tests).
- **Evidence:**
  - The impeccable detector over all scoped files.
  - Code greps (motion, layout animation, scroll listeners, hard-coded colours, copy tells).
  - Live measurements on the real-backend build at 375×812: contrast for every text node, every
    interactive box, horizontal overflow.
  - Production build chunk sizes.
- **Not covered:**
  - A real touch device for swipe and long-press (only emulated viewport plus mouse).
  - A CPU-throttled run (S11).

## Audit health score

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 3 | The row and sheet checkbox hit area is 22×23px; the brief and the List page promise 44px. |
| 2 | Performance | 3 | Lean: trip route about 50 KB gzip, map lazy at about 304 KB (under the 320 KB cap). The slow-device run was not done. |
| 3 | Theming | 3 | Tokens are enforced by tests. The MapCanvas basemap colours are hard-coded. The app has no dark mode (product-wide, out of scope). |
| 4 | Responsive design | 3 | No horizontal scroll at 375. Several controls are under 44px. Touch gestures were not exercised under real touch. |
| 5 | Implementation integrity | 4 | Detector: 0 findings. One Sheet, one primitive set, side-stripe and hex bans enforced in CI. |
| **Total** | | **16/20** | **Good**: address touch targets, then verify on a real phone. |

## Implementation integrity verdict: **pass**

The trips UI is one coherent system, not a collage. Every overlay is the shared `Sheet` with
the four-tier slots. Sheet content is built only from `components/ui` primitives, and
`ui.enforcement.test.ts` fails the build on direct Ant overlays and inputs, hex outside `:root`,
side-stripe borders, undefined tokens, or more than one yellow key per sheet.

The detector found nothing across the scope. The code greps found:
- no gradients, blur or backdrop filters, and no `will-change`
- no animated layout properties
- no scroll listeners (day tracking uses IntersectionObserver)
- no slop copy ("Oops", "seamless", exclamation marks, emoji ornament)

The copy reads in the House voice ("Where to first?", "Nothing planned yet", "Next stop").

## Executive summary

- **16/20, Good.** P0: 0 · P1: 1 · P2: 3 · P3: 3.
- **Top issues:**
  1. **[P1]** The checkbox hit area is 22px.
  2. **[P2]** Several controls are 28–36px tall: "Add a label" 28, the day-hide chevron and the add-bar day chip 32, the ⋮ menu and the pill tabs 36.
  3. **[P2]** Gestures are unverified on real touch.
- **Next:** `/impeccable adapt` for the touch targets, a real-phone pass for gestures, then `/impeccable polish`.

## Findings by severity

**[P1] Checkbox hit area is 22px**
- **Location:** Spine rows (`TodoRow`), the Next stop card and the sheet identity, all using the Ant checkbox inside `.trip-check`.
- **Category:** Accessibility / Responsive.
- **Impact:** Ticking is the most frequent action on a trip, often one-handed while walking. A 22px target means mis-taps.
- **Standard:** WCAG 2.5.8 (AA) needs 24px. The brief and the List page set 44px.
- **Recommendation:** Give the label a 44×44 hit box (padding or a pseudo-element) with the visual staying at 22px, the same as the List `ItemRow` checkbox.
- **Command:** /impeccable adapt.

**[P2] Sub-44px controls on the phone**
- **Location:** ⋮ "More trip options" (36), PillNav tabs (36 inside a 44 track), "Add a label" (72×28), the day-hide chevron (32), the add-bar day chip (75×32).
- **Category:** Responsive.
- **Impact:** Mis-taps on secondary controls.
- **Recommendation:**
  - Pad the hit areas to 44 without changing the visuals.
  - Pill tabs: make the tab fill the 44px track height.
- **Command:** /impeccable adapt.

**[P2] Touch gestures untested on a real device**
- **Location:** swipe-to-delete (the reused `useSwipeToDelete`), long-press reorder (lazy dnd above 40 todos), swipe-down to close sheets, the phone map pinch/pan.
- **Category:** Responsive.
- **Impact:** These are the primary phone interactions, and they're only covered by unit tests plus emulation.
- **Recommendation:** Run on an iPhone and an Android phone. Specifically check:
  - the first long-press after lazy arming (reported as possibly not dragging);
  - swipe vs vertical scroll;
  - sheet swipe-down vs inner scroll.
- **Command:** /impeccable harden.

**[P2] Slow-device performance not measured**
- **Category:** Performance.
- **Impact:** "Runs lean on old systems" is the product owner's bar. The sizes are good (route about 50 KB), but runtime cost (IntersectionObserver plus map follow, 150-row spine) hasn't been measured under CPU throttling.
- **Recommendation:** Run S11: 6× CPU, Fast 3G, a 150-todo trip; record the load and the scroll frame rate.
- **Command:** /impeccable optimize.

**[P3] MapCanvas basemap colours are hard-coded**
- **Location:** `components/trips/MapCanvas.tsx:20-22, 78, 114` (earth, water, white), plus hex fallbacks for tokens.
- **Category:** Theming.
- **Recommendation:** Read the earth and water colours from `:root` tokens like the rest. Keep the fallbacks.
- **Command:** /impeccable colorize.

**[P3] Unguarded press transition**
- **Location:** `components/ui/ui.css:19`, a Button transform/shadow transition outside a reduced-motion guard.
- **Category:** Accessibility.
- **Impact:** Negligible (a 90ms press), but inconsistent with the project rule.
- **Recommendation:** Wrap it in `prefers-reduced-motion: no-preference`.

**[P3] Shared Ant vendor chunk is 219 KB gzip**
- **Category:** Performance.
- **Impact:** App-wide and pre-existing. Trips no longer adds Ant overlays or inputs, which shrinks future reliance.
- **Recommendation:** Later, consider dropping the Ant Checkbox/Card/Typography still used in trips so the trip route can avoid antd entirely. Not urgent.

## Patterns and systemic issues

- **Touch targets:** secondary controls were sized visually (28–36px) without a separate hit area. The fix is one pattern applied in the primitives (`Button` text/quiet, `Chip`, icon buttons), not per screen.

## Positive findings

- **Bundle discipline:** trip route about 35.8 KB plus about 4.4 KB shared trips JS plus 9.6 KB CSS; the map is lazy (293.9 KB JS, 10.6 KB CSS) and never fetched offline; `pmtiles` was removed.
- **Motion:**
  - Every trips animation is behind `prefers-reduced-motion: no-preference` and uses transform/opacity only.
  - No permanent `will-change`.
  - Hover effects sit behind `(hover: hover)`.
- **Contrast:** no text node failed WCAG AA at 375px.
- **System enforcement in CI** prevents drift back to one-off modals, colours or the side-stripe slop pattern.
- **Copy** is plain, specific and in the Bauhouse voice.

## Recommended actions

1. **[P1] `/impeccable adapt`:** 44px hit areas for checkboxes, then the sub-44 controls (as a primitive-level fix).
2. **[P2] `/impeccable harden`:** a real-device gesture pass (swipe, long-press, sheet swipe-down, map pinch).
3. **[P2] `/impeccable optimize`:** the S11 throttled run on a 150-todo trip.
4. **[P3] `/impeccable colorize`:** tokenise the MapCanvas basemap colours.
5. **`/impeccable polish`:** a final pass once the above land.
