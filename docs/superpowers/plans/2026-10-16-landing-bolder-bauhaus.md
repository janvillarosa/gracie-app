# Landing page: bolder, Bauhaus primitives build the House

> **Status: rejected 2026-10-16.** Jan called the shapes cheap and unfinished, even refined as a construction
> drawing. Kept from it: the poster hero (flush-left headline at up to 132px), the red square plate behind the
> lists demo, and the trip fields bleeding off the page edge. Next: kinetic typography.

Date: 2026-10-16. Branch: `feature/landing-distill` (on top of 91e5977).
Jan's brief: "Bolder with the animations and layout. I already like the color scheme, but Bauhaus is an
iconoclastic art movement, so our landing page must reflect that."

## Decisions (Jan, 2026-10-16)

- **Direction:** primitives build the House. Circle, square and triangle become the page's structure and its
  motion. The Bauhouse mark is literally a square and a triangle, so the brand gets to be built from the movement it
  is named after.
- **Departure:** the page goes poster; the app pictures stay paper. The hero list, typing demo, laptop, phone and
  receipt keep the real app's look, so they still show what you get.
- **Kept:** the palette (ink, House Blue, House Red, the yellow key), Outfit and Figtree, all copy, every working
  demo, the CTAs, and the page's order of parts.

## The system additions (new, named, small)

1. **Three primitives**, colour-fixed as Kandinsky paired them: a **yellow triangle**, a **red square**, a
   **blue circle**. Drawn as plain SVG or CSS shapes with hard edges, no outlines and no shadows. Yellow stays a
   shape, never a section field (DESIGN.md's rule holds).
2. **An asymmetric 12-column grid** for the marketing layout (`--ld-cols`), replacing centred stacks. Headings set
   flush left at full width.
3. **Hard-edged colour fields:** the trip sheets lose their rounded corners and bleed off one side of the page
   (planning bleeds left, the trip bleeds right). The lists plate becomes a true square.
4. **Display step raised** from 96px to 132px max, still one of the five type steps (the step changes size; no
   sixth size is added).
5. **One scroll-progress hook** (`useScrollProgress`) that writes a `--p` (0 to 1) custom property on a section,
   throttled to one write per frame, so motion is CSS transforms with no React re-renders.

## Section by section (one authored moment each)

| Section | Layout | The moment |
|---|---|---|
| Hero | Headline flush left across 8 columns at the new display size; the primitives on the right 4 columns; the live list below, offset to columns 2 to 9. | On load the three primitives fly in from off-grid, rotate square and **assemble into the House mark** (square body, triangle roof, circle window). As you scroll away, the house comes apart and the pieces drift toward the sections they will frame. |
| Lists | The typing demo sits on a hard **red square** plate, set off-centre with the copy in the opposite columns. | The square slides in from the edge on scroll and the demo card lands on it like paper on a desk. |
| Trips | Planning: a blue field bleeding off the left edge, the laptop crossing its edge. On the trip: a red field bleeding right, the phone crossing its edge. | A large **blue circle**, the sun over Porto, rises behind the laptop as you scroll; on the trip view a **yellow triangle** points to the phone's next stop. |
| Free | Receipt and copy on the asymmetric grid. | The "Nothing due" stamp keeps its landing; a small triangle points at the key. |
| Close | Unchanged sentence. | As the visitor types the House's name, the **square, triangle and circle build the house** around the "start." key: the page ends by building the house it began with. |
| Calls to action | Same keys. | A yellow triangle beside each key turns to point at it on hover and focus. |

## Motion rules

- Transforms and opacity only; no permanent `will-change`; nothing animates when off screen.
- Exponential ease-out (`--ease-out`), from an already-visible default: without JavaScript or with reduced motion,
  every primitive sits in its assembled, final place.
- `prefers-reduced-motion: reduce` turns off the fly-in, the scroll drift and the sun's rise.
- Budget: the hero composition is inline SVG (< 2 KB); the scroll hook adds < 1 KB.

## Files

`pages/Landing.tsx` (hero grid and House composition), new `components/landing/Primitives.tsx` (the three shapes and
the assembled House), new `components/landing/useScrollProgress.ts`, `components/landing/SharedPlate.tsx` (square
plate), `components/landing/Capabilities.tsx` (bleeding fields, sun, triangle), `components/landing/Closing.tsx`
(triangle at the key, the house building around "start."), `components/landing/landing.css`, tests
(`__tests__/Landing.test.tsx`: the House assembles, the close builds as a name is typed, reduced motion shows the
final state), `DESIGN.md` and the surface brief.

## Validation

`make check`; one batched browser round at 1280px and 375px with the motion played through; the Impeccable detector
once over the changed files; then `/impeccable polish` if anything needs it.
