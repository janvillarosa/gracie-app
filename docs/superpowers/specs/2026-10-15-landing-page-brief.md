# Landing page brief: "Write on it"

Status: approved and built 2026-10-15 (`frontend/src/pages/Landing.tsx`). Not yet committed.
Shaped with impeccable `shape` (Persuade mode) and tasteskill v2 (direction `page-is-the-object`,
seed 53926605, palette and type kept from the brand; sheet at `.taste-skill/direction.json`).
Locked first-viewport sketch: `.impeccable/mocks/decision/landing-write-on-it.html`.

## Job

- **Who:** people who like planning and organising their home and their travel. Couples, families,
  housemates. They arrive curious, often on a phone, and are comparing Bauhouse with a group chat or a
  notes app.
- **What they must believe after one screen:** Bauhouse is one shared notebook for the house, and it's
  free.
- **What they do:** "Start your House, free", which goes to `/register`. "Log in" is the quiet second action.
- **Where:** `/` for logged-out visitors (today `/` redirects to `/login`). Logged-in visitors still go to
  `/app`. The page loads lazily, like every other route.

## The idea

> On this page, **the House's shared sheet, where every line is signed by whoever added or ticked it
> ("Added by Mia", "Ticked by Sam")**, becomes **the stationery the whole page is printed on.**

Competitor test: a to-do app has a list but no House and no names on the lines, so the sentence fails
for it. Every section is another piece of the same paper: a sheet, a stack of coloured sheets, an
itinerary slip, a ticket, and the back of the sheet as the footer.

**The live thing:** the add bar on the hero sheet. The visitor types an item, it lands at the top with
the highlighter swipe, and a category stamp lands a beat later. A few seconds after that, a demo
housemate ("Sam") ticks one of the items with "Ticked by Sam, just now". All of it is local; there are
no API calls. The demo stops after about 8 items and suggests starting a House. Without script, the
sheet is a static list and the button still works.

## The argument (one claim per section)

| # | Claim | Proof | Composition (from the sheet) |
|---|---|---|---|
| 1 | It's one list everyone in your house writes on. | The live "Why Bauhouse" sheet, the four pitch points as its items | Hero: the locked sketch |
| 2 | Everyone sees the same thing, and who did what. | The real list fragment with Groceries / Chores / Packing tabs and signed rows | Square plate, spare text |
| 3 | It covers lists *and* trips. | Four colour sheets that stack as you scroll, each holding a real UI fragment | Stacking colour sheets (pinned story) |
| 4 | It works with no signal. | A Lisbon itinerary slip plus a **No signal** switch: edits queue, then "4 changes synced" | Itinerary on a slip |
| 5 | It's completely free. | A ticket priced "Free" | The ticket |
| 6 | Start now. | "Call your House ____ and start." | A sentence with a blank |
| 7 | (close) | The wordmark, the back of the sheet | Name first, links under it |

## Copy deck

> **Revised 2026-10-15 after the build.** Jan asked for a clarity and humanizer pass and a new
> headline. The shipped copy lives in `frontend/src/components/landing/` and `pages/Landing.tsx` and
> wins over the draft below. Main changes:
> - H1 is "Manage your [word] together." The word cycles through life, groceries, chores, trips,
>   shopping and lists, with a highlighter swipe. It is two lines on desktop ("together." below) and
>   three on phones. The heading's accessible name stays "Manage your life together.".
> - Section headings: "The same list on every phone.", "The weekly shop and the summer trip.",
>   "Still works with no signal.", "What it costs."
> - Each Lisbon photo has a caption naming the line of the plan it shows, and that line carries a
>   highlighter mark (Tram 28 at 11:00, Santa Apolónia for the 09:09 train, dinner in Alfama).
> - Slogans, staccato fragments, and lists of three used only for rhythm were rewritten as plain
>   sentences. "Start your House" is the one name for the action everywhere.

**Nav:** Bauhouse (mark + wordmark) · Lists · Trips · Log in · [Start your House]

**1 · Hero**
- H1: **Plan the house together.** (24 chars, one face, one colour; the highlighter moved to the live item)
- Supporting line: Groceries, chores and the next trip, on one list everyone you live with can write on.
- Sheet "Why Bauhouse" · Mia, Sam and Jo
  - ☑ Dead simple. One bar adds anything. Ticked by Mia · stamp Simple
  - ☑ Everyone in the house sees the same list. Ticked by Sam, just now · stamp Shared
  - ☐ Works with no signal. At the shop, on the train, abroad · stamp Offline (highlighted)
  - ☐ Free. No plan to pick, no card to enter. Added by Jo · stamp Free
- Add bar: Add something. Try "oat milk" · [Start your House, free]
- Under the sheet: Demo list with made-up housemates. Type to try it.

**2 · Shared**
- H2: **One list, whole house.**
- Tabs: Groceries · Chores · Packing
- Body: When Sam ticks the eggs at the shop, they tick off on Mia's phone too. Every line says who
  added it and who got it.
- Actions: [Start your House] [See trips ↓]

**3 · Capabilities**
- H2: **Everything a house plans.**
- Yellow sheet, "One bar adds anything": Type it and press enter. Bauhouse files it under Dairy or
  Produce and remembers what your house buys.
- Blue sheet, "Trips, day by day": Shape each day, keep ideas for later, and see every stop on a map.
- Red sheet, "Bookings at the counter": Flights, stays and tickets with their codes, ready when someone
  asks.
- White sheet, "Packing is just a list": The trip's packing list is a normal Bauhouse list, so everyone
  packs from the same one.

**4 · Offline**
- H2: **Plans that work offline.**
- Body: Bauhouse keeps your House on your phone. Tick, add and edit with no signal. It catches up when
  you're back.
- Switch: No signal
- Slip "Lisbon · Saturday":
  - Morning: Pastéis in Belém ··· 09:30 · Tram 28 to Graça ··· 11:00
  - Afternoon: Miradouro da Senhora do Monte ··· 14:00 · Pick up the Porto train tickets ··· 16:30
  - Evening: Dinner in Alfama, booked ··· 20:00
  - Inverted last row: Back online · 4 changes synced

**5 · Free**
- Ticket, main part: **A House for everyone** · Lists and trips · Everyone you live with · Works
  offline · No card, no trial
- Stub: **Free** · [Start your House]

**6 · Close**
- Statement: Call your House [ the Flat ] and **start**. (The last word is the button.)
- Under it: You'll pick a password next, then invite your house with a link.
- The House name is passed to `/register` and prefills the House name if the flow supports it.
  Otherwise it is dropped (open decision 4).

**7 · Footer**
- Wordmark Bauhouse at full width, cropped at the bottom edge
- Links: Start a House · Log in · Lists · Trips
- Legal line · Back to top

Housemates, items, trips and times belong to an example House. Per Jan, the page does not call them a demo. The mockups copy the real app's look and claim nothing the app can't do.

## Visual rules (both skills, reconciled)

Brand kept: the yellow key, Outfit and Figtree, the HouseMark, the yellow/red/blue Bauhaus palette,
paper sheets, stamps, the highlighter.

Where tasteskill's house rules and the brand disagree:

| Rule | Decision |
|---|---|
| No styled accent word in headlines | **Follow it.** The highlighter leaves the H1 and lives on the item the visitor adds. |
| No thin rules, no tiny uppercase labels | Real UI fragments carry `data-ui`, so their row lines and stamps stay as the app draws them. Page chrome has none. |
| No shadows at rest | The sheets are told apart by tone steps and their peeking edges, not shadows. The app's key keeps its pressed-key shadow (`--allow`, brand asset). |
| Square or pill buttons only | The brand key is 12px-rounded. Keep the brand and pass `--allow` for that rule, noted in the report. |
| ≥4 real pictures | Met by the UI fragments (hero sheet, shared plate, four capability sheets). One credited open-licence photo of Lisbon (Wikimedia Commons, CC BY-SA) is tipped onto the slip as a plate. It shows the city, never a customer. |
| Headlines ≤2 lines at every width | All headlines are 21–24 characters. |
| Outfit is on impeccable's "default font" list | Pinned by the brand, so it stays. |

## Motion

- **Signature move:** the four capability sheets are sticky and stack as you scroll, like the app's
  paper stack. Each leaves its title band showing.
- Staggered entrances per section.
- Press, hover and focus feedback on every control.
- The highlighter and stamp on the live add. The ticks sync between two sheets.
- With reduced motion: the highlighter fades in instead of sweeping, and the stack becomes ordinary
  sheets.

## Phone

The phone is designed in its own right, not just narrowed. The hero sheet runs full width (16px gutter),
and the add bar and the key stack, each at least 44px tall. The capability sheets keep a 52px sticky
offset. The slip goes full width with its zigzag edge. The ticket stands upright, with the
perforation running across.

## Constraints

- Self-hosted fonts and no third-party origins. No Google Maps on this page; the trips sheet uses the
  plain SVG map preview.
- The landing chunk loads lazily and stays small. Low-end devices get the same rules as the app
  (`frontend/CLAUDE.md`).
- Validation: `make check`, the tasteskill `lint.mjs` and `inspect.mjs`, impeccable `detect`, then
  the impeccable finish review and DESIGN.md.

## Open decisions (Jan)

1. **Launch blocker:** lists don't work offline yet; only trips do. The broad offline claim needs a
   local copy and an outbox for lists before launch.
2. **SEO and link previews:** pre-render `/` to static HTML with a title, description and share image?
   Because the app is client-rendered, crawlers would otherwise see an empty page.
3. **Domain, contact email** for the footer, and a privacy/terms page. Not needed to build, but needed
   to launch.
4. Should `/register` accept a House name from the closing sentence?
