# House screen polish — plan (2026-10-16)

Scope: the House page (`RoomPage`) and everything it opens: Share code, New list / Edit list
(+ icon picker), the list row menu, New trip, House settings, and the no-House page with
Create a house. Out of scope by request: the paper-stack motif, the colour scheme, and anything
DESIGN.md already settles. Evidence: before-captures at 390×844 and 1280×860 of every surface.

## P0 — behaviour that loses data or misleads

1. **Opening Share code kills the code you already sent.** `POST /rooms/share` mints a new token
   on every open (`RotateShareToken`), so a housemate holding yesterday's code gets "doesn't match
   a house". Fix (backend + store): `GET /rooms/share` returns the current token, minting one only
   if none exists; `POST` stays the explicit "Get new code". Handler + service + memstore + Mongo
   store, unit + integration tests.
2. **Delete votes are one tap, no confirm.** "Vote to delete house" and "Vote to delete list"
   fire immediately; in a one-person House that tap deletes outright. Add a `confirm` Sheet
   (as Trip settings does) whose copy says what will happen: alone → "This deletes Elm Street and
   its lists." / shared → "Elm Street is deleted once everyone votes. 1 of 2 so far."

## P1 — off-system overlays (the four tiers, one key, `components/ui`)

3. **Share code** (Ant `Modal` → `Sheet`). Identity: "Invite to Elm Street", context "They enter
   it under Join a House." The code set like a ticket slip (Outfit 32px, 0.12em, tabular). One key
   "Copy code" → "Copied". Quiet "Share…" only where `navigator.share` exists. Footer text action
   "Get new code" with a muted note "The old code stops working."
4. **Create a house** (Ant `Modal` + `Form` → `Sheet`). Identity is the name field itself (like
   New list / New trip), context "You can change this later." Description as a field row. One key
   "Create house"; Cancel goes (the close key, Esc and the scrim already do it). Name-rule error
   as the field's red line, not Ant help text.
5. **Icon picker** (Ant buttons + tooltips, a yellow "No icon" pill) → `ChipGroup` choice tiles
   with labels, "None" as the first tile; the same picker Trip settings uses.
6. **New list / Edit list / New trip / Rename trip title field:** the focus ring is a rectangle
   that overhangs the sheet inset by 4px and the title text sits 2px left of its context line.
   Fix once in `ui.css` for `.ui-sheet-title` fields (8px ring with paper gap, text on the inset).
   Context lines stop repeating the action ("Add list", "Edit list"): New list → "Everyone in
   Elm Street can see it.", Edit list → "In Elm Street". Description placeholder "Optional"; empty icon value "None" (one wording in both).
7. **Edit list autosaves** (DESIGN: sheets have no Save button): title commits on Enter/blur,
   description on blur, icon on pick. Footer: red "Vote to delete" (→ the P0 confirm). The row
   menu keeps "Edit details" and the vote item for speed.

## P2 — the House page and settings

8. **Meta sheet:** drop "Members:" colon label for an avatar stack with names for screen readers
   and a muted "2 members" line; Share code and the gear become `ui` Buttons (quiet pill, 44px
   icon hit area). Inline styles move to classes.
9. **List rows without an icon** (Hardware store) start in the icon column, so titles zig-zag.
   Give them the same 44px tile with a quiet list glyph so every title starts on one line.
10. **Pending delete votes are invisible.** A list someone voted to delete shows a muted stamp
    "Delete vote 1/2" in its row; the menu says "Cancel my vote".
11. **Empty states** ("No lists yet…", "No trips yet…") use `EmptyState` (Outfit 22 line + muted
    sentence), left-aligned, no duplicate key (the pill bar already has it).
12. **New list / New trip keys** → `ui` key Button (same look, one source).
13. **House settings** rebuilt like Trip settings: back link "‹ Elm Street" in the top bar
    (replacing the Back pill), editable Outfit title for the name with its rule as the error line,
    Description as an autosaving field row, a "Members" section listing each housemate, an
    "Invite" NavRow that opens the Share sheet, and the footer's red "Vote to delete house" /
    "Cancel my vote" with the vote count. Removes the Save button, the second yellow key and the
    Ant form boxes.
14. **No-House page:** two yellow keys today (Create, Join). Create keeps the key; Join becomes a
    quiet button beside a large code field (Outfit, 0.12em, 5 slots' width, auto-uppercase,
    `inputmode="text"`, `autocapitalize="characters"`). One layout for phone and desk (drops the
    `isMobile` duplicate button). Divider → hairline + spacing.

## Cleanup
Unused imports and `any`s in `RoomPage`/`RoomSettings` (`useMemo`, `FloppyDisk`, `X`,
`MenuProps`, `NAME_RE`), inline styles → `styles.css` classes, Ant `Form`/`Input`/`Modal` out of
these files. Extend `ui.enforcement.test.ts` so `RoomSettings`, `NoRoomPage` and the two House
modals can't import Ant `Modal`.

## Tests and verification
Update `RoomPage.test.tsx` (code shown as text; GET then explicit rotate), `CreateHouseModal.test.tsx`;
add tests for the delete confirms, settings autosave and the GET share endpoint (handler + store).
`make check`, `make test-integration`, then one after-capture round at 390 and 1280 px.

---

# Part 2 — Account settings and nav loading (2026-10-16)

Evidence: captures of a cold load and of House → Account settings with `/api/*` slowed 1.2s and
avatar images 1.5s, plus Account settings at 390 and 1280 px.

## Nav and loading

1. **The first loading frame has no nav.** The route fallback (`AppRoutes` Suspense) is a bare
   card at the top of the page; when the page arrives the nav appears above it and everything
   drops ~66px. On `/app/*` the fallback draws the same top bar as the page (static logo + the
   avatar disc), so the card lands where it will stay. Guest routes (`/`, `/login`) keep theirs.
2. **Avatars are blank until a third-party image arrives.** The nav disc and the House's member
   stack show nothing (on a phone the meta row's left side is empty). `Avatar` gets a ground in
   its own colour (the pastel it already derives) with the person's initial, the image fades in
   over it, and above-the-fold avatars load eagerly instead of `loading="lazy"`.
3. **The avatar menu ghosts into the next page.** Choosing "Account settings" starts the page
   cross-fade with the menu still open, so it fades across both pages. Close the menu first.
4. Not in this pass, flagged: avatars come from `api.dicebear.com`, a third-party origin that
   PRODUCT.md says the app doesn't use (only Google Maps). Self-hosting them (the `@dicebear/*`
   packages render the same SVG locally) is a follow-up of its own.

## Account settings (rebuilt like Trip and House settings)

5. Back link "‹ Elm Street" in the top bar (no Back pill); identity is the avatar tile, the name
   typed in place (saves on commit) and the email as the context line.
6. **Sign-in** group: Email as an autosaving field row with its rule inline; **Password** as a
   NavRow that opens a sheet (current / new / confirm, borderless fields, rule and mismatch shown
   inline, one key "Change password"). Removes both Save buttons and the boxed Ant inputs.
7. **Just for you** group: the existing "Show next stop when I'm travelling" switch.
8. Footer: muted "Your avatar is made from your account." and a red "Delete account". It opens a
   `confirm` Sheet that keeps type-DELETE-to-confirm, with true copy: you leave your House; if
   you're the only one in it, the House and its lists and trips go too. Replaces the Ant Modal
   and the "Danger zone" heading.

## Tests and verification
Account settings tests (name and email autosave, email rule, password sheet, delete confirm),
a route-fallback test (the app shell has the nav), `make check`, then one slowed-network capture
round at 390 and 1280 px.
