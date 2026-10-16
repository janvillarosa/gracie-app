# Landing page: distill + clarify + polish

Date: 2026-10-16. Target: `frontend/src/pages/Landing.tsx` and `frontend/src/components/landing/*`.
Inputs: a sales critique (2026-10-15) and Jan's note: "the landing page is unfocused. It should be much
simpler without diluting the usefulness of the app."

## Why not plain polish

Impeccable's polish keeps the incumbent concept. The problem is the concept's focus: 8 sections and
about 7 "Try" keys, and the one unique angle (the same household shares the weekly shop and the next trip)
is never said in one line. So this is **distill** first, then **clarify** (copy), then **polish** (defects).
The visual world (paper, stamps, highlighter, Bauhaus fields, Outfit/Figtree) stays as it is.

## Decisions (Jan, 2026-10-16)

- **Headline:** keep the rotating "Manage your ___ together." The lede carries the home-plus-trips line.
- **CTA:** "Get started free" everywhere (nav: "Get started"). This replaces "Try Bauhouse free", which read as
  a trial with a paywall later. Still not "Start your House".
- **Bookings:** be honest. They are typed in once by one person, and then the whole House has them. No email-import claim.
- **Trust:** claim only "free, no ads, no paid plans". Make no claims about export, encryption, data selling or who runs it.

## New structure (8 sections → 4 + close)

1. **Hero.** Rotating H1 stays. New lede: "One shared space for your household, from the weekly shop to the
   next trip. Everyone in your House (the people you live with) adds to the same plan, instead of a group chat full of
   screenshots." One CTA. The live `HeroSheet` stays. Its four rows are reworded so they don't overclaim (see copy).
2. **Lists.** `SharedPlate` typing demo + the "learns your shop" autocomplete merged into one block
   (the autocomplete popover appears inside the demo card, and the separate ink `LearnsSheet` goes).
   "Aisles" → "sections" everywhere. Remove the Notion/Sheets repetition and name no rival.
3. **Trips.** One sheet instead of three stacking sheets: the day plan + one booking with its code. Copy:
   "One person adds the booking, and the whole House has the code at the counter." The packing list becomes one line.
   The **offline toggle moves here** from its own section, scoped to trips. That matches the product today
   (only trips have the outbox), so it also removes the lists-offline overclaim flagged in memory.
4. **Free.** The receipt stays. The heading stays "It costs nothing." One plain line underneath: "No ads, no paid plans."
   Add install help: "On iPhone: Share → Add to Home Screen. On Android: Install app."
5. **Close.** The House-name sentence and the footer stay as they are.

**Cut:** `Parts` (two link blocks under the hero, which repeat the nav), the separate `OfflineSlip` section,
two of the three `Capabilities` sheets with their sticky-stack logic, `LearnsSheet` as its own sheet, and every
CTA except the nav, the hero, the receipt and the closing sentence.

## Defect fixes (polish)

- **Duplicate "Oat milk"** (reproduced): `SharedPlate` `TypingList` increments `turn` only at the end of a
  cycle. If the card leaves the screen after the insert, the effect restarts, types the same word again and
  reuses the same row id (a duplicate React key). Fix: give every inserted row a unique id from a separate counter,
  and advance `turn` as soon as the row is inserted. Add a regression test.
- **Sticky CTA:** `StickyKey` hides whenever any inline CTA is on screen (`.ld-key` outside the sticky), not
  only after the hero CTA and before the close. It also never covers demo content (add bottom padding while it's shown).
- **"House" introduced** in the hero lede, before it is used anywhere else.

## Discoverability

- Pre-render `/` at build time: a small Vite build step renders `<Landing />` with
  `react-dom/server` into `dist/index.html`'s `#root`, and the client hydrates it. The demos keep
  deterministic initial state, so the server and client markup match.
- Add a `<meta name="description">`, Open Graph and Twitter tags, and a `og:image` built from the hero (rendered
  once, provenance noted). Own the phrase "shared household lists and trip planner".

## Files

`pages/Landing.tsx`, `components/landing/{SharedPlate,Capabilities,OfflineSlip,StickyKey,HeroSheet,Closing,demo}.tsx/ts`,
delete `Parts.tsx`, trim `landing.css`, `frontend/index.html`, `vite.config.ts` (+ prerender script),
tests: `__tests__/Landing.test.tsx`, `__tests__/landingDemo.test.ts`. Docs: `DESIGN.md` landing section,
surface brief, `frontend/CLAUDE.md` build notes.

## Validation

`make check`. Landing tests updated: CTA label, sections present, no duplicate rows after a visibility
toggle, and sticky hidden while an inline CTA is visible. Browser check at 375 and 1280 widths. Impeccable detector
run once over changed files. `curl` of the built `/` shows the headline text with JS off.

## Out of scope (proposed separately)

- Email/forwarding import for bookings.
- Lists offline (outbox), which is needed before any page-wide offline claim returns.
