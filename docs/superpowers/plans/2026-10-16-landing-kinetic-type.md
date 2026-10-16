# Landing page: bolder through kinetic type (Bayer style)

> **Built 2026-10-16**, with one change Jan asked for during the build: the hero shows the app itself, the live
> List page on an iPhone in the right column (the caption about who added what sits under the phone).

Date: 2026-10-16. Branch: `feature/landing-distill`. Replaces the rejected primitives direction
(`2026-10-16-landing-bolder-bauhaus.md`); keeps its poster hero, red square plate and bleeding trip fields.

## Idea

Bauhaus printed matter (Herbert Bayer, Moholy-Nagy): the type is the image. Heavy sans set huge and flush left,
words broken across lines, one word in a primary colour, type turned 90° up the margin, and thick ink rules as
structure. No shapes as decoration. Motion is typesetting: words slide into their lines and stop hard, as if set by
hand.

## What changes

| Where | Layout | Motion |
|---|---|---|
| Hero | Headline even tighter (line-height 0.88), "together." pushed right by two columns so the three lines step across the page. A thick ink rule (10px) under the headline, running off the left edge. | On load the lines slide in from alternate sides and stop hard: "Manage your" from the left, the cycling word drops in, "together." from the right. The cycling word changes by sliding up out of its line and the next sliding in, like type being swapped. |
| Margin | "BAUHOUSE" set in Outfit 800 at about 22vw, turned 90°, running up the right edge of the hero, House Red, cropped by the page edge. | It drifts up slower than the page (parallax) as you scroll. |
| Type band (new, between hero and lists) | Two lines of huge type across the full width: "Groceries · Chores · Packing" and "Trips · Days · Bookings", ink on the grey ground, the separators in the brand colours. | Scroll-linked: the lines run in opposite directions as you scroll, and stop when you stop. |
| Section headings | "Lists for the house.", "Plan the trip together.", "It costs nothing." set at the display size, broken across two or three lines, one word in a primary colour ("house" red, "together" blue, "nothing" set on the yellow highlighter). A thick ink rule above each, running off the page edge. | Each heading's words slide up into their lines one after another as it enters the screen, then stop. |
| Close | "Call your House ___ and start." at the display size. | Same word-by-word setting as the headings. |

## Kept as is

Palette, Outfit and Figtree, all copy, every demo (the app pictures stay paper), the red square plate, the bleeding
trip fields, the receipt.

## Motion rules

- Transforms and opacity only; scroll motion through `useScrollProgress` (`--p`), entrances through one
  IntersectionObserver-driven `data-set` attribute; nothing animates off screen.
- Hard stops: a fast exponential ease-out, no bounce or overshoot.
- Reduced motion: everything sits set in place; the type band does not move.
- Headings keep their real text and accessible names (word spans are aria-hidden duplicates or plain spans inside
  the heading, never split text that screen readers would read letter by letter).
- No new fonts or colours; display step stays at its current maximum (132px), the rotated margin word excepted as
  one decorative element (aria-hidden).

## Files

`pages/Landing.tsx` (hero lines, margin word, type band), new `components/landing/SetWords.tsx` (a heading whose
words set themselves in), `components/landing/HeadlineWord.tsx` (the vertical swap), `SharedPlate.tsx`,
`Capabilities.tsx`, `Closing.tsx` (headings), `landing.css`, tests (headings keep their names, the band and margin
word are hidden from screen readers, reduced motion rests set), `DESIGN.md`.

## Validation

`make check`; one browser round at 1280px and 375px with the motion played through; the Impeccable detector once.
