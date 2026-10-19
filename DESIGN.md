---
name: Bauhouse
description: The shared notebook for a household. Paper sheets on a pale desk, one yellow key.
colors:
  key-yellow: "#FFD417"
  key-yellow-deep: "#E6BE00"
  stamp-red: "#BE1E2D"
  ink-blue: "#2348A6"
  ink: "#1A1A1A"
  text: "#3B3B3B"
  muted: "#656C78"
  desk: "#F7F7F7"
  paper: "#FFFFFF"
  paper-tint: "#FAFAFA"
  hairline: "#E6E6E6"
  edge: "#D2D2D2"
  edge-soft: "#E2E2E0"
  edge-deep: "#D9D9D6"
  warn-ground: "#FFF4D6"
  warn-ink: "#7A4B00"
  ok-ink: "#2E6B32"
  on-red: "#FFFFFF"
  on-pin: "#FFFFFF"
  scrim: "rgba(0, 0, 0, 0.35)"
  day-0: "#2348A6"
  day-1: "#BE1E2D"
  day-2: "#946D00"
  day-3: "#1E7B3C"
  day-4: "#0E7C86"
  day-5: "#6A3FB5"
  transport-leg: "#4B5563"
  trip-food-bg: "#FDE7D2"
  trip-food-fg: "#8A4209"
  trip-sight-bg: "#DCE5FA"
  trip-sight-fg: "#1D3F93"
  trip-activity-bg: "#DDF0E2"
  trip-activity-fg: "#17602F"
  trip-transport-bg: "#E8E8E8"
  trip-transport-fg: "#333333"
  trip-stay-bg: "#FFF1B3"
  trip-stay-fg: "#6B5000"
  trip-shopping-bg: "#E8DFF6"
  trip-shopping-fg: "#55308F"
  trip-other-bg: "#EFEFEF"
  trip-other-fg: "#4A4A4A"
  pip-food: "#C4560C"
  pip-sight: "#2348A6"
  pip-activity: "#1E7B3C"
  pip-transport: "#5A6470"
  pip-stay: "#946D00"
  pip-shopping: "#8A3FB5"
  pip-other: "#767676"
  pip-done: "#A9ADA6"
  map-ground: "#E9EEE6"
  map-earth: "#EEF0E9"
  map-water: "#CFDDE3"
  cat-produce: "#4CAF50"
  cat-dairy: "#2196F3"
  cat-bakery: "#FF9800"
  cat-meat: "#F44336"
  cat-frozen: "#00BCD4"
  cat-plant: "#9C27B0"
  cat-grains: "#795548"
  cat-pantry: "#607D8B"
  cat-beverages: "#E91E63"
  cat-household: "#78909C"
  cat-general: "#9E9E9E"
typography:
  display:
    fontFamily: "'Outfit Variable', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
    fontSize: "clamp(36px, 4.4vw, 48px)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  title:
    fontFamily: "'Outfit Variable', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "'Outfit Variable', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  code:
    fontFamily: "'Outfit Variable', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.12em"
  lead:
    fontFamily: "'Figtree Variable', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.45
  field:
    fontFamily: "'Figtree Variable', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.4
  body:
    fontFamily: "'Figtree Variable', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  map-pill:
    fontFamily: "'Figtree Variable', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1
  meta:
    fontFamily: "'Figtree Variable', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "'Figtree Variable', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "0.08em"
  stamp:
    fontFamily: "'Figtree Variable', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.08em"
rounded:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  sheet: "20px"
  pill: "999px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "20px"
  space-6: "24px"
  space-7: "32px"
  control-sm: "32px"
  control-md: "36px"
  control-lg: "44px"
  row-h: "52px"
  sheet-inset: "20px"
  detail-inset: "16px"
  lead: "24px"
  gap: "12px"
  time-w: "48px"
  detail-label-w: "96px"
  tier-identity-actions: "18px"
  tier-actions-details: "26px"
  tier-details-footer: "22px"
  composer-h: "56px"
  ideas-col: "300px"
  map-col: "420px"
components:
  button-key:
    backgroundColor: "{colors.key-yellow}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-key-danger:
    backgroundColor: "{colors.stamp-red}"
    textColor: "{colors.on-red}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-quiet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  button-quiet-hover:
    backgroundColor: "{colors.paper-tint}"
  button-text:
    textColor: "{colors.ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "44px"
  button-text-danger:
    textColor: "{colors.stamp-red}"
  button-icon:
    textColor: "{colors.muted}"
    size: "36px"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  chip-open:
    backgroundColor: "{colors.key-yellow}"
    textColor: "{colors.ink}"
  choice:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    height: "56px"
  choice-pressed:
    backgroundColor: "{colors.key-yellow}"
    textColor: "{colors.ink}"
  segment:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.muted}"
    typography: "{typography.meta}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "36px"
  segment-pressed:
    backgroundColor: "{colors.key-yellow}"
    textColor: "{colors.ink}"
  field:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "12px 0"
  add-input:
    backgroundColor: "{colors.paper-tint}"
    textColor: "{colors.text}"
    rounded: "22px"
    padding: "10px 16px"
    height: "44px"
  composer:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.lead}"
    rounded: "{rounded.pill}"
    height: "56px"
  detail-group:
    backgroundColor: "{colors.paper-tint}"
    rounded: "{rounded.lg}"
  nav-row:
    textColor: "{colors.ink}"
    padding: "0 16px"
    height: "52px"
  stamp:
    backgroundColor: "{colors.paper-tint}"
    textColor: "{colors.muted}"
    typography: "{typography.stamp}"
    rounded: "5px"
    padding: "3px 7px"
  stamp-done:
    backgroundColor: "{colors.key-yellow}"
    textColor: "{colors.ink}"
  pill-nav:
    backgroundColor: "{colors.paper-tint}"
    rounded: "{rounded.pill}"
    padding: "3px"
    height: "44px"
  pill-nav-tab-selected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  paper-card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.lg}"
  sheet:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.sheet}"
    padding: "0 20px 24px"
  inspector:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    width: "440px"
  list-icon:
    backgroundColor: "{colors.paper-tint}"
    rounded: "50%"
    size: "44px"
  map-pill:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.map-pill}"
    rounded: "{rounded.pill}"
    padding: "0 14px 0 10px"
    height: "34px"
  map-pill-next:
    backgroundColor: "{colors.key-yellow}"
    textColor: "{colors.ink}"
  map-pill-phone:
    padding: "0 12px 0 9px"
    height: "30px"
  map-cluster:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-pin}"
    rounded: "{rounded.pill}"
    padding: "0 11px"
    height: "30px"
---

# Design System: Bauhouse

> **Living reference:** [docs/design-system/index.html](docs/design-system/index.html) shows every token
> in use (copied from `frontend/src/styles.css` by `pnpm design:sync`) and every pattern below. This file
> is the rules and the reasons; the reference page is what they look like. Agents: read both before any
> UI change, and extend the system rather than inventing a one-off (see CLAUDE.md, "Design system").

## Overview

**Creative North Star: "The Kitchen-Table Notebook"**

Bauhouse looks like the notebook a household keeps on the kitchen table: white sheets of paper on a pale desk, written in near-black ink, with one yellow key you press to make something happen. Every surface is a sheet of paper at a known height. A list is a short stack: a header sheet, the list sheet slid over it, and the edge of a third sheet peeking out below. A trip is the same stack. During the trip, today's next stop sits on top as a small deck of cards. On a desktop, the trip spreads out into a planning desk: an Ideas sheet, the Days stack and the map, side by side. Overlays are more paper: a sheet that rises from the bottom on a phone, and a dialog, an inspector or a popover on a wide screen.

The system is quiet by construction. Text fields have no boxes. Detail rows sit in a faintly tinted group, not in cards. Hairlines and spacing divide sections, and colour is spent on meaning (a day, a category, a warning), not on decoration. The only thing with real lift and saturation is Key Yellow, and a sheet has one of it. Motion behaves like paper: sheets set down with an exponential ease-out, rows lift when picked up, and a strike-through draws across a ticked item. All motion sits behind `prefers-reduced-motion: no-preference`. The reduced version keeps the meaning (the highlight, the finished logo) without the movement.

Density is phone-first. Every control is 44px tall or reaches 44px through an invisible hit area. Inputs are at least 16px so iOS never zooms, and hover effects exist only behind `(hover: hover)`. A wide screen gets the same paper with more of it side by side, not a different product. The map is the one surface that is not ours: a Google map with a quiet light style, on which our own paper pills and day-coloured routes carry the colour.

**Key Characteristics:**
- White paper on a pale desk. Paper has a fine grain, the desk a coarser one; a sheet shows its thickness as a stepped edge at its foot (the ream), and its shadow is warm and long.
- One yellow key per sheet. Red is for destructive actions only. Blue is the focus ring, the caret and links.
- Outfit for titles, Figtree for everything else. Small-caps labels at 12px / 0.08em.
- 16px squircle corners on paper, pills on controls, 20px on the top of a bottom sheet.
- One row grid `[lead 24] 12 [time 48] 12 [title] [trail]` for every line in a plan.
- The four-tier sheet: identity, actions, details, footer, always in that order.
- PillNav is the only tab style.

## Colors

A near-monochrome paper-and-ink palette with one saturated yellow, plus functional hues kept for days, categories and the map.

### Primary
- **Key Yellow** (`--brand-yellow`): the one primary action per sheet (the "key"). It is also the selected state of chips, choice tiles and segments, the checked switch, the "Day done" stamp, the Next pill on the map, the login screen's whole viewport, the text-selection tint and the highlighter (`--highlighter`, 70% yellow) that marks a just-added row, a matched suggestion or the row linked to a hovered map pill.
- **Key Yellow Deep** (`--brand-yellow-deep`): the key's 1px bottom edge, the borders of selected chips, choices and segments, the drop line while dragging, nav-row chevrons and the yellow switch's hover. It is an edge colour, never a fill on its own.

### Secondary
- **Stamp Red** (`--brand-red`): destructive actions only. That is the red Delete in a sheet footer, danger keys, the swipe-to-delete tray, field error text and the 2px error ring. It is never used for warnings.
- **Ink Blue** (`--brand-blue`): the focus ring (a 70% mix), the text caret and primary links. It is the system's "you are here" colour, not a decoration.

### Tertiary (functional hues)
- **Day colours** (`--trip-day-0` … `--trip-day-5`): blue, red, deep yellow, green, teal and violet, cycling per day of a trip (day 7 reuses day 1). They live on the map: each day's route is drawn in its colour. In the list, colour is limited to the day dot, the yellow key and state.
- **Icon grounds** (`--ground-blue`, `--ground-yellow`, `--ground-red`): the three brand colours as pale tints (16%, 45% and 14% over paper), used only behind a list or trip emoji (the icon disc). Each icon takes the ground that stands out from its own colour (`ICON_GROUND` and `TRIP_ICON_GROUND` in `icons.ts`): blue behind warm and red things, yellow behind blue things, red behind green ones. They are display only, never stored, and far too pale to read as selected, as a delete or as a link.
- **Transport leg** (`--trip-transport`, defined in `gmap.css`): the grey of the dotted line to a train, flight or car stop.
- **Trip category stamps** (`--trip-cat-*-bg` / `-fg`): a tinted ground with a darker ink of the same hue, 4.5:1 for the text. The categories are food, sight, activity, transport, stay, shopping and other.
- **Category pips** (`--pip-*`): the stamp hues, a little stronger, each at least 3:1 on the map ground. They colour the dot in a row, an idea and a map pill. A finished stop is the muted grey `--pip-done`.
- **Grocery categories** (`--cat-*`): base hues for list categories (produce, dairy, bakery …). They are never shown raw: a stamp uses the hue at 12% on white for its ground and 55% mixed into ink for its text.
- **Map ground** (`--trip-map-ground`, `--trip-map-earth`, `--trip-map-water`): the pale, desaturated ground of the plain "Map preview" (shown when there is no key or Map ID). The ground is also the Google map's background colour while tiles load.

### Neutral
- **Ink** (`--ink`): the darkest text. It is used for sheet titles, button labels, field text and row values, and as the fill of a map cluster.
- **Text** (`--text`): running text. There is no heading ink or 70% secondary text any more: titles are ink, secondary lines are muted.
- **Muted** (`--muted`): context lines, labels, placeholders, times, empty values and icon buttons. It is a cool grey so it reads as pencil, not as faded ink. 5.3:1 on paper; it never sits on yellow (3.7:1).
- **Desk** (`--bg`): the page background the paper sits on.
- **Desk Tone** (`--desk-tone`): the desk as it reads from arm's length, its grain averaged over `--bg` (#EAEAEA). It is the canvas colour and `theme-color`, because browsers tint their own bars (iOS Safari's top and bottom, Android's status bar) and paint overscroll with the flat background colour, never the grain; the grained desk is a fixed layer over it.
- **Paper** (`--panel`): every sheet, card, dialog, map pill and control face.
- **Paper Tint** (`--panel-subtle`): detail groups, the add-bar input, the PillNav track, list icons and quiet hover fills.
- **Hairline** (`--border`) and **Edge** (`--border-strong`): hairlines divide rows inside a sheet. The edge outlines a sheet of paper, a quiet button, the PillNav track, the composer and the dashed slot of an empty day. **The ream** (`--edge-soft`, `--edge-deep`) draws a sheet's thickness at its foot.
- **Warn Ground / Warn Ink** (`--warn-bg`, `--warn-ink`): the amber of an overlap or a ticket slip. The amber text is 6.8:1, and never red, because an overlap is not an error. **OK Ink** (`--ok-ink`) is its quiet green counterpart (a ready line in "Ready to go?").
- **On Red / On Pin** (`--on-red`, `--on-pin`): white text on a red key or a coloured pin.

### Named Rules
**The One Key Rule.** A sheet has at most one Key Yellow button (enforced by `ui.helpers.ts`). Yellow anywhere else means "selected", "next" or "done", never a second call to action. The one exception is the pale icon ground (`--ground-yellow`, a 45% tint behind a list or trip emoji), which is too light to read as the key; a selected picker tile turns its disc to plain paper so it never reads yellow on yellow.

**The Red Means Gone Rule.** Stamp Red is for deleting and for errors that block. Warnings are amber text with a glyph; they never borrow red. The 14% `--ground-red` tint behind an icon is decoration, not an error.

**The No Raw Hex Rule.** Colours live on `:root` in `styles.css`. `ui.css` and `trips.css` have no hex values outside `:root` (enforced by `ui.enforcement.test.ts`); they reference tokens.

## Typography

**Display Font:** Outfit Variable (with ui-sans-serif, system-ui fallbacks)
**Body Font:** Figtree Variable (with ui-sans-serif, system-ui fallbacks, plus emoji faces)

**Character:** Outfit is round and geometric, a little friendly, and is used only for titles. Figtree is a warm, open grotesque that does all the reading, every control and every map pill. Both are self-hosted variable faces (latin subset, `src/fonts.css`), so weights like 620, 650 and 720 are real. No font comes from a third-party origin; Google's own map UI brings its own fonts from `maps.gstatic.com`.

### Hierarchy
Ten roles (tokens `--t-*`) and four weights (`--w-regular` 400, `--w-medium` 500, `--w-semibold` 600, `--w-bold` 700). Every size in the app is one of these; nothing else exists.
- **Display** (Outfit 700, `clamp(36px, 4.4vw, 48px)`, 1.05, -0.03em): the page title (`h1`: the House, the no-House page).
- **Title** (Outfit 700, 28px, 1.15): a sheet's, a list's, a trip's or a settings page's title (`h2`).
- **Heading** (Outfit 600, 22px, 1.2): section heads and the empty-state line (`h3`).
- **Code** (Outfit 700, 32px, 0.12em, tabular): a confirmation or invite code.
- **Lead** (Figtree 400, 17px): the composer.
- **Field** (Figtree 400, 16px): every input. Never smaller, or iOS zooms on focus.
- **Body** (Figtree 400, 15px, 1.5; 500 for row text and values, 600 for buttons and tabs): everything you read.
- **Meta** (Figtree 400/600, 13px): times, notes, secondary lines, short labels, text buttons. Times and counts in tabular numerals.
- **Label** (Figtree 700, 12px, 0.08em, uppercase, muted): section labels.
- **Stamp** (Figtree 700, 11px, 0.08em, uppercase): stamps and kickers.

Icons and emoji have their own scale (`--icon-xs` 12 … `--icon-2xl` 28), never a type size.

### Named Rules
**The Outfit Is For Titles Rule.** Outfit appears only on headings, sheet and page titles, the empty-state line, modal titles and a ticket's confirmation code. Buttons, rows, chips, labels and map pills are Figtree.

**The Sixteen-Pixel Input Rule.** Every input renders at 16px or larger so mobile browsers never zoom on focus. A larger title input may override the rule upward, never downward.

## Layout

Spacing runs on a 4px base: `--space-1` … `--space-7` (4, 8, 12, 16, 20, 24, 32). Sheets inset their content 20px (`--sheet-inset`). Detail rows inset 16px (`--detail-inset`). Controls are 36px (`--control-md`: chips, quiet buttons, segments) or 44px (`--control-lg`: keys, text actions, the PillNav track), and a detail row is 52px (`--row-h`).

**Phone and tablet (below 1024px).** One centred column of paper on the desk. The list page uses a 720px container with 24px padding; at 480px and narrower its sides drop to 16px, and so do a sheet's (`.paper-body`), so rows aren't squeezed between two 24px margins. A trip's plan is one column with the Plan · Ideas · Bookings pills; below 768px the trip page drops to 12px side padding. The map is a full-screen, read-only view opened from a "Map" pill (history `#map`), with its stop card below the map, never over Google's logo. Overlays are bottom sheets.

**The planning desk (1024px and wider).** The trip becomes a desk inside a centred frame (`max-width: 1440px`). The window does not scroll; each column scrolls on its own and keeps its position per trip.
- **1200px and wider: three columns.** Ideas (300px), Days (fills the rest) and Map (420px, or 360px between 1200 and 1359px), with 20px gaps. The map column appears only when the trip has a place and the device is online. Before that, the place shows "Places you add show up here".
- **1024–1199px: two columns.** Ideas (300px) and Days. The map opens over them from the Map pill.
- On a desk Ideas is a column, so the pills are Plan · Bookings. Every trip date shows, and an empty day is a dashed slot.
- The header spans the Days column: icon (52px), the 32px title on one line, the route · dates · countdown line, and avatars on the right. Its foot holds "Ready to go?" before the trip and the Next stop card during it.
- The one add bar becomes a floating **composer**, fixed 24px above the window's bottom and centred on the Days column, 24px in from its sides.
- An open item is an **inspector**: it takes the right column at 1200px and wider (the map returns when it closes), and is a 440px fixed overlay panel, 16px from the window's edges, at 1024–1199px. Opening, switching or closing it never moves the Days column.

Breakpoints are `480px` (tighter PillNav tabs; 16px page and sheet sides), `640px` (paper-modal keys go full width), `767/768px` (phone vs tablet: heading size, side padding), `1024px` (`WIDE` in `useMedia.ts`: the desk, dialogs, popovers and the inspector replace bottom sheets) and `1200px` (the third column).

**The row grid.** Every line in a plan shares one grid: a 24px lead (checkbox or icon), a 12px gap, a 48px tabular time column, a 12px gap, the title, and a trailing slot. This covers todo rows, booking stubs, the Now marker, empty-day text and the next-stop card. A day or list without times sets the time column (`--tcol`) to 0, so text lines up with the title column across Plan, Ideas and Bookings. Pips and leading glyphs are centred on the title's first line (`--row-first-line`, 22px).

**The four tiers.** A sheet stacks identity (lead mark, Outfit title, one muted context line), then 18px, actions (one key and at most one quiet button), then 26px, a detail group, then 22px, the footer ("Added by Mia" and a red Delete). The gaps are tokens (`--tier-*`), and the order never changes.

### Named Rules
**The One Grid Rule.** A new kind of line in a plan uses the row grid. If it has no time, it starts in the title column; it does not invent its own indent.

**The Still Desk Rule.** Nothing the user did not ask for moves a column. Opening the inspector, scrolling the Days or hovering a pill never scrolls another pane or moves the map's camera.

## Elevation & Depth

Depth is paper height, and paper has body. Every sheet has a 1px edge, a white top highlight (`--paper-edge`), a fine grain (`--grain-paper`, a background layer with its strength baked in) and a stepped foot: two or three leaves of the ream showing beneath it (`--thick`, in every lift). Its shadow is warm (tinted from the desk's brown, not grey) and long. There are four heights:
- `--lift-0`: a sheet resting on the desk (the base of a stack, the Ideas column, a settings page).
- `--lift-1`: the sheet on top of a stack.
- `--lift-2`: bottom sheets, dialogs, the inspector and a dragged row.
- `--lift-3`: popovers, menus, toasts, tooltips and suggestion slips.

The add bar is the one control surface that floats over the plan, so it gets its own height: `--lift-bar` (the composer), with a tight dark contact shadow and a long drop, clearly above `--lift-3`. On a phone the bar is pinned to the sheet's foot instead, and casts `--shadow-up` onto the rows that scroll under it.

A lift is for paper on the desk or floating over it. Paper lying on a sheet (the smart-suggestion slip above a list's items) is not a new height: it rests a hair above the page with `--slip-rest`, the same as a quiet slip. A lift's ream and long drop inside a sheet would bleed over the rows below it.

The desk has its own, coarser grain (`--grain-desk`), so paper and desk read as two materials. Because both are grained, nothing inside a sheet is filled with flat colour: an in-sheet fill is `--paper-fill` (or `--well-fill` for a tint), and anything that must cover the desk is `--desk-fill`; a flat fill would read as a patch stuck on the paper.

The stacked look comes from overlap (`PaperStack`): each sheet after the first is slid 20px over the one before and lifted; the sheets beneath lose their foot edge under it; one or two more sheets peek out at the foot (10px and 18px, at 14px and 28px insets), each a fraction of a degree off true (`--peek-tilt-1`, `--peek-tilt-2`), like a real pile. On arrival the stack assembles bottom-up.

**Autopilot floats one slip at a time** (`SlipStack`). Slips lie on the list's sheet like the smart-suggestion slip, and when autopilot has more than one thing to show (Up next, "Added 3 for Saturday", a suggestion) they are a pile on the Z axis, never a column down the page: the front slip is in full, and one or two more slip edges peek out beneath its foot (the peek tilts above), display-only. The server orders them (`up_next`, then `auto_add`, then `suggestions`); closing the front slip brings the next one forward. The list below never moves for a second slip.

Things pressed **into** the paper are wells (`--well`, a soft inner shadow along the top): detail groups, the PillNav track, stamps. A well is never a card on the sheet.

The yellow key is the one control with real lift: a 2px deep-yellow underside, a warm drop that grows on hover, and when pressed it sinks its whole underside (`--key-travel`). Quiet buttons are slips of paper: a hair above the page (`--slip-rest`), a hair higher under the pointer (`--slip-hover`), pressed into the page when pressed (`--slip-press`).

Map pills are paper too, but they sit on a photograph-like ground, so they carry their own small shadows (`--pin-*`).

### Shadow Vocabulary
- **Paper edge** (`--paper-edge`): the white top-edge highlight on every sheet and card.
- **Thickness** (`--thick`): the ream at a sheet's foot, part of every lift.
- **Well** (`--well`): pressed into the sheet.
- **Slip** (`--slip-rest`, `--slip-hover`, `--slip-press`): a quiet button's three heights.
- **Lift 0–3** (`--lift-0` … `--lift-3`): the four paper heights above.
- **Bar lift** (`--lift-bar`): the composer, floating over the plan.
- **Shadow up** (`--shadow-up`): the phone's add bar, pinned to a sheet's foot, cast up onto the rows beneath.
- **Key** (`--shadow-key`, `--shadow-key-hover`): the yellow key, selected chips and pressed choice tiles.
- **Focus ring** (`--focus-ring`): a 2px paper gap, then a 2px Ink Blue ring at 70%. It is visible on white and on yellow.

### Named Rules
**The Paper Heights Rule.** A surface takes one of the four lifts, chosen by what it is (resting, on top, overlay, popover), never a bespoke shadow. The add bar has its own height (`--lift-bar`, or `--shadow-up` when pinned), because it is the one control that floats over the plan. Map pills are the other exception, because they sit on the map, not on the desk.

**The Only Lifted Control Rule.** Only the yellow key (and yellow-selected chips and choices) is lifted. Quiet slips rest a hair above the page and press into it; text buttons and everything else are flat on the sheet.

## Shapes

Paper has soft squircle corners (16px, `--radius-lg`). The corner scale is `--radius-xs` 6, `sm` 8, `md` 12, `lg` 16, `sheet` 20 and `pill`; nothing else. The top corners of a bottom sheet are 20px (`--radius-sheet`). Controls you press are pills (`--radius-pill`): keys, quiet buttons, chips, the PillNav track and its sliding tab, the add-bar input (22px on a 44px field), the composer and map pills. Choice tiles, segments, empty-day slots and the dashed drag placeholder use 12px (`--radius-md`). Focus rings and text buttons use 8px (`--radius-sm`). Icon buttons, list icons and pips are circles. Stamps are nearly square at 6px (`--radius-xs`). List checkboxes are 7px at 22px. Hairlines between rows are inset to the row's text start, so they never bend around a rounded hover fill.

A map pill has a pointer tail (a 10px square turned 45°) and a 10px anchor ring on the exact coordinate. A collapsed pill keeps only the anchor and the dot.

There are no side-stripe accent borders anywhere (enforced by test). Emphasis is carried by a tint, a stamp, a glyph or weight. Dashed edges mean "a place for something": an empty day, a drag's source, and the 2px dashed tear edge at the top of a ticket slip (where a confirmation code sits in Outfit 32px, 0.12em tracking).

## Components

All overlays and form controls in trip screens come from `src/components/ui/`, styled by `ui.css` from `:root` tokens. The dev-only gallery at `/dev/ui` shows every primitive and state.

### Buttons
One family (`Button`), each kind paper at a known height.
- **Key** (`kind="key"`): Key Yellow, ink label 600, 44px, 20px side padding, a 2px deep-yellow underside and a warm drop (`--shadow-key`). One per sheet. Pressed, it sinks 2px (`--key-travel`). Not yet pressable: yellow soaked into the paper (38% on paper), flat, muted ink.
- **Round key** (`kind="key" iconOnly`): the add bar's plus (44px) and the composer's (38px, 8px clear of the pill on every side, hit area 46px). With nothing to add it is a plain paper disc.
- **Danger key**: the key in Stamp Red with white text and a red-tinted shadow, for a confirmation only.
- **Quiet** (`kind="quiet"`): a paper slip, 36px, 1px edge, grain, resting a hair above the page; lifts 1px on hover; presses in when pressed. Disabled: paper with faded ink and edge, never grey, never see-through.
- **Text** (`kind="text"`): 44px tall, 13px 600, ink on the sheet; a wash on hover. Danger is red ink.
- **Icon** (`iconOnly`): round, 36px, with a 44px hit area; a text icon is bare, a quiet icon is a round slip.
- **No spinners:** a button that is working says so in its label ("Saving…", "Logging in…").
- There are no Ant buttons in the app (enforced).

### Chips, choices and segments
- **Chip:** a white 36px pill with a 1px hairline border, 15px text and a small muted glyph. It opens a picker. An empty chip shows muted text ("+ Time").
- **Open:** a Key Yellow fill, a deep-yellow border, the key shadow and an ink glyph.
- **Choice tiles** (`ChipGroup`): a grid of 56px tiles (6 columns by default) with 12px corners, an icon above a 12px weight-600 label in muted grey. Pressed (`aria-pressed="true"`) turns Key Yellow with the key shadow. With `values` several can be pressed at once (Trip settings' "Who's going": Everyone, or any of the members); the caller decides what a press toggles.
- **Step slider** (`StepSlider`): a setting that is a matter of degree, low to high (autopilot: Off · Suggest · Assist). A 10px groove pressed into the sheet (Paper Tint, `--well`) fills with Key Yellow up to a 36px (`--control-md`) round paper key with `--slip-rest`; 4px stop dots turn Key Yellow Deep once reached. The key carries the chosen stop's glyph (autopilot: moon, lightbulb, service bell; ink, muted at the lowest stop), which turns a quarter as it lands (`--dur-slow`, `--ease-out`); the key slides by transform over `--dur-base` and sinks `--key-travel` while held. Names sit under the stops, the chosen one in ink. One `role="slider"`; reduced motion swaps glyphs without the turn, and the lite tier keeps the slide but drops the turn.
- **Segments** (the inspector's duration): 36px, 12px corners, 13px weight-600 muted labels; pressed is Key Yellow with a deep-yellow border and no shadow.
- **Stamp select** (the inspector's category): every stamp outlined 1.5px in its own ink at 78% opacity. Only the chosen one is filled with its tint.

### Cards / Containers
- **Paper** (`Paper`): white with grain, a 1px edge, 16px corners, the paper-edge highlight and one of the four lifts. Every panel is one; there are no Ant cards (enforced).
- **Stack** (`PaperStack`): the only way sheets are piled; see Elevation. Every page is a stack, even a one-sheet one (settings, Account, no-House, sign-in), so nothing is a lone card floating on the desk.
- **Detail group** (`DetailGroup`): a well (Paper Tint, pressed in) with 16px corners, holding 52px nav rows separated by hairlines inset 16px. No border; never a card.
- **Internal padding:** sheets 20px at the sides and 24px at the bottom; list cards 24px (16px at the sides at 480px and narrower); the Ideas column 16px.

### Inputs / Fields
- **Field:** borderless text on the paper, 16px, 12px vertical padding and a muted placeholder. Focus draws the shared focus ring around it. An error draws a 2px Stamp Red ring with a 13px red line of problem text beneath.
- **Add bar:** a 44px pill input on Paper Tint (white on focus) inside a bar pinned to the bottom of the viewport, docked flush to the card's bottom edge at the end of the list. A parsed quantity ("2 kg") shows as a small yellow-tinted pill inside the field. The top suggestion's tail shows as faded ghost text. Suggestions are slips that rise above the bar (`Combobox`).
- **Composer** (the desk's add bar): a 56px white pill with a 1px edge, the paper edge and `--lift-bar`, 17px text, a 32px target chip (a day or Ideas) and a 38px yellow key, 8px clear of the pill on every side. Focus turns the edge deep yellow and adds a 3px yellow halo at 55%. An empty, unfocused composer shows a muted `/` key hint on devices with a fine pointer.
- **Inspector editors** (desktop only; phones keep pickers): `InlineWhen` (a day select, a typed 24-hour time where ↑/↓ moves 15 minutes, and duration segments), `InlinePlace` (inline search with slips below), `InlineSelect` (a native select drawn like the paper) and `StampSelect`.
- **Switch:** the Ant switch, checked in Key Yellow with an ink handle. Hover deepens it to Key Yellow Deep.

### Navigation
- **PillNav:** the only tab style, on the House (Lists · Trips), List (Items · Notes) and Trip (Plan · Ideas · Bookings; Plan · Bookings on a desk) screens. It is a 44px Paper Tint track with a 1px edge border and 3px padding. A white pill slides under the selected tab (320ms ease-out), lifted with a soft double shadow. Tabs are 14px weight-600, muted until selected (ink). Adornments are an unchecked count and an 8px yellow dot (a trip happening now). Extra controls (the category toggle, the phone's Map pill) sit at the right end of the same bar. The newly shown pane rises 6px and fades in (260ms).
- **Top bar:** the House mark on the left (a shared element that glides between pages) and the avatar on the right. The way back is a chevron plus the House name in a 44px target.

### Sheet (signature)
The one overlay (`Sheet`). Its variants are `sheet` (a bottom sheet on phones, a dialog at 1024px and wider), `panel` (the desk inspector, sliding in 24px from the right), `slip`, `confirm`, `chips` (a popover hanging from its anchor on wide screens, a small sheet elsewhere) and `announce` (below). A 44px header holds the phone drag handle (36×4px, edge grey) and a 44px close key. It closes with the key, Esc (innermost only), the scrim (35% black) or a swipe down, and asks "Discard this?" when there are unsaved changes. **Announce** is the exception to all of that: for the rare moment worth stopping for (a shopping run done). The desk goes pale and out of focus (`--announce-scrim`, `--announce-blur`), and a 340px sheet at popover height sits in the middle of every screen, phones included. No close key or handle: content first, centred, then its one yellow key, full width and focused, which dismisses it (Esc and the scrim do too). Its label may cheer (the run-done key says "Nice!", "Huzzah!" and friends, never the same twice in a row). Never for errors or questions; those are `confirm`. Content scrolls inside a 90dvh maximum and always lays out in the four tiers:
1. **Identity** (`SheetIdentity`, `SheetTitle`): a 28px lead (checkbox, kind icon or a 44px icon tile), the Outfit 26px title and one muted 15px context line.
2. **Actions** (`SheetActions`): the one yellow key and at most one quiet button, indented to the title column.
3. **Details** (`DetailGroup` + `NavRow`): one tinted group of rows. Each row has a short muted label, a value and a yellow chevron, and opens one picker. On the desk inspector the rows edit in place.
4. **Footer** (`SheetFooter`): "Added by … · day" on the left, a red text Delete on the right.

Bottom sheets have 20px top corners and `--lift-2`. Dialogs have a 1px edge, 16px corners and the paper edge. Pickers apply their choice at once, and sheets autosave: there is no Save button.

### Rows
- **List item row:** 52px minimum, a 22px checkbox with 7px corners, the item text at 15px/500, a quantity in muted tabular numerals and a category stamp. Ticking draws a strike-through across the text (420ms) and mutes it. Desktop shows a drag handle and a trash on hover. Touch swipes left over a red tray, behind a 5-second Undo toast.
- **Autopilot stamp** (assist mode): a row autopilot put on the list carries a state stamp beside its category stamp: icon-only, outlined 1px in ink, holding the service bell (`CallBell`, `--icon-xs`; autopilot at your service), 24 × 18px so it sits level with the category stamp. The bell is autopilot's one mark: the slip and the slider's Assist stop carry it too. Monochrome ink against the pastel category stamps makes it read at a glance without borrowing yellow (selected), red (delete) or blue (focus). The two stamps travel as one group (`.item-stamps`), so on a narrow list they drop under the words together. It reaches the 44px touch target through an invisible hit area; tapping it (`aria-expanded`) fills it with Paper Tint and opens one muted `--t-meta` line under the words, "Added by autopilot. You buy it about every 9 days". On a checked-off row it goes to Edge and muted ink.
- **Autopilot slip** (assist mode): once per planned run, a slip above the items, lying on the list's sheet like the suggestion slip (`--slip-rest`, `--radius-lg`, an Edge border, no warm edge and no key, since nothing waits on anyone): the mark in a small pressed-in well (`--well`), "Added 4 for Saturday" in ink, the names in muted meta on one line (two on a narrow phone), a quiet "Undo all" and a round "Got it" X. It settles in once (`--dur-slow`); Got it, or Undo all once it worked, folds its space away (grid rows, `--dur-base`) so the list closes up instead of jumping, and only then do the undone rows leave. Either closes it for that run. It never shares the sheet with a suggestion slip: on assist nothing is suggested, since what would be is added.
- **Trip row:** two lines at most on the row grid: checkbox, time, title, and the place under it. The category is a pip, not a text chip. An idea on a desk shows its grip at rest and lifts on hover.
- **Nav row** (`NavRow`): 52px, a 96px muted label column, a weight-500 value that ellipsises (muted at 400 when empty) and a deep-yellow chevron. The `is-list` layout (days, settings) makes the label the 15px weight-600 text and the value a muted 13px note, with a hairline below.

### Icon disc
- **IconDisc** (`components/ui/IconDisc.tsx`; `ListIconDisc` and `TripIconDisc` in `components/IconDiscs.tsx` pick the emoji and ground from the icon): the one way a list's or trip's emoji is drawn. A round paper sticker (Edge border, `--slip-rest`, grain) on a pale `--ground-*` tint. It is `md` 44px with a 24px emoji in House rows and list and trip headers, `sm` 36px with a 20px emoji inside a picker tile and a New list row, and `lg` 52px with a 28px emoji on the desk's trip header. With no icon chosen a list row keeps the place with a plain Paper Tint disc and a muted glyph (`blank`). The disc is decorative (`aria-hidden`); with `onClick` and a `label` it is a button (trip settings' "Change icon").
- A selected picker tile is Key Yellow and its disc goes to plain paper.

### Stamps, Pips and Notes
- **Stamp:** an 11px uppercase weight-700 tag with 5px corners, muted on Paper Tint. Category stamps use their tint and ink pair; `used` is an outlined stamp; `done` is Key Yellow.
- **Ink stamp** (`InkStamp`): a rubber-stamp impression for a moment worth marking, never a control or a tag (that is the Stamp). Green "done" ink (`--ok-ink`) in a double rule (3px border, a 3px paper gap, a 1.5px inner line), 8px corners, a small dated note above the words (Figtree 12px caps at 0.16em, then Outfit 28px caps at 0.1em), set off true by `--ink-tilt`. The ink multiplies onto the paper at 92%, so the grain shows through. It presses in once (`--dur-ink`); reduced motion: it is simply there.
- **Pip:** an 8px dot in a day or category colour, or the muted done grey. An idea's pip is hollow (white with a coloured ring).
- **Note:** a 13px one-liner. Muted for context ("These are dated outside 13–21 Oct."). Warn is weight-600 amber text after a 14px flag glyph, underlined on hover when it is a link. No box, no side rule.
- **Empty state:** an Outfit 22px line, a muted sentence and an optional key, left-aligned. On a desk an empty day is a dashed 12px-corner slot, "Nothing planned yet", in muted 13px text.

### Print
- **PrintSheet** (`components/ui/PrintSheet.tsx`, wrapped in `PrintOnly`): what a list or a trip prints, from the ⋯ menu's Print or Cmd+P (and "Save as PDF" from there). It is a document, not a screenshot. It mounts only between `beforeprint` and `afterprint`, beside the app's root, and the print stylesheet hides everything else, so desks, maps and add bars never reach paper. Plain ink on white: no paper, grain, shadow or fills.
- **Letterhead:** the house mark and "Bauhouse" in Outfit 700 on the left, the kind of document in 11px caps on the right ("Travel itinerary", "List"), then a 4px ink rule with a 72px yellow tip (a border, so it prints with "background graphics" off). The title is Outfit 700 at `--t-title`, and the summary is a two-column form of caps labels over values, ruled with `--border-strong` and `--border` hairlines.
- **Body:** numbered sections (`1. Transport`, `2. Accommodation`, `3. Tickets and other bookings`, `4. Day-by-day itinerary`; the number is a CSS counter in muted Figtree) over a 1.5px ink rule. Tables have caps column heads that repeat on every page, hairline rows that never split, and a muted second line for the kind or place. Days are `Day 3 · Sat 17 Oct · Sintra` over a time column and the plan, and a day never splits across pages. A list prints its unchecked items by category after an empty box to tick by pen.
- **Page:** `@page` sets the margins and, where the browser supports margin boxes (Chrome, Edge), a footer of the title on the left and "Page 2 of 4" on the right. Elsewhere (Safari) the closing line "Prepared with Bauhouse · bauhouse.app" stands in; it names the site as a constant (`SITE_URL`), never the page's own address.
- A trip prints what the screen shows: never confirmation codes or notes. It is meant to be enough for a visa appointment: dates, flights and trains with their times, where you are staying and for how many nights, and the plan.

### Dragging on the desk
A dragged row leaves a dashed placeholder (1.5px edge, 12px corners) at its source and follows the pointer as a paper chip at `--lift-2`, scaled to 1.02. The landing place is a 2px deep-yellow line. While anything is dragged, every empty-day slot turns yellow (16% yellow, deep-yellow border) and the slot under the pointer deepens to 34%. Every drag has "Move to…" as its keyboard and menu equivalent.

### Map (signature, brief 6u and 6v)
A Google map (Maps JavaScript API, a cloud-styled light Map ID, light in every theme). Google's default controls, place icons and tilt are off; Google's logo (bottom-left) and terms (bottom-right) are never covered. It is for viewing only: the one click action is a pill, which selects its item in the list.
- **Stop pill:** a 34px white paper pill: a 12px category dot (with a 2px white ring), the name in Figtree 14/600 (cut at 22 characters) and the time at 12.5px muted tabular. A pointer tail stands 10px above a 10px anchor ring in the stop's colour on the exact spot. Pills are `aria-hidden`; the list is the accessible source.
- **Next:** the Key Yellow pill with a deep-yellow border and warm drop, and an 11px "NEXT" kicker.
- **Done:** a grey pill with muted text and the done-grey dot.
- **Selected:** a 2px ink outline.
- **Idea:** a white pill outlined 2px in its category colour, with a hollow dot.
- **Other days:** dimmed to 55% opacity. Scrolling the list changes emphasis only; it never moves the camera.
- **Collisions:** lower-priority pills (priority selected, then next, then day order) and other days' pills collapse to a 22px stub of anchor and dot. They expand on hover.
- **Clusters:** a 30px ink pill with a white "+N" in 13px weight-700 tabular numerals. The next, selected and emphasised-day pins are never clustered.
- **Routes:** per day, a 5px day-colour line on a 10px white casing, with white chevrons edged in the day colour about 100px apart. A leg to a transport stop is dotted in the transport grey on a 9px white casing. Other days' routes fade to 35%.
- **Controls:** our own +/− stack (40px buttons, 14px corners, an edge border, `--lift-1`, yellow on hover) sits 44px above the bottom so the terms strip stays visible. When the emphasised day is off screen, a paper chip "Wed 28 is off the map · Show" sits at the top centre with a small yellow Show pill. The add bar's highlighted place previews as an 18px hollow ink ring.
- **Phone:** 30px pills with 13px text, no time and names cut at 16 characters.
- **Offline or no key:** no map. The pane and its button disappear after a 5-second debounce and the plan widens. With no key or Map ID, the plain "Map preview" draws on the map-ground tokens.

### Paper stack and next-stop deck (signature)
The list page is a stack: a meta sheet (header, PillNav) with its bottom edge hidden, the list sheet pulled up 20px over it at `--lift-1`, and a third sheet's edge peeking 8px below. On arrival the stack assembles bottom-up: the meta sheet sets down 6px (420ms), the list sheet settles from 28px (560ms, 60ms delay) and the peeking edge drops in last (520ms, 180ms delay). The House page and a trip's Plan reuse the stack. During a trip the Plan deals today's remaining stops on top as a deck of cards: the place is the title, a muted line gives the time, and the one key is Open Maps. One or two further edges show when more stops are coming.

### Motion
Arrivals use an exponential ease-out (`--ease-out: cubic-bezier(0.22, 1, 0.36, 1)`). Durations are 90ms press, 160ms fast, 240ms base and 420ms slow. Every animation sits behind `prefers-reduced-motion: no-preference`. Under `reduce`, sheets and dialogs only fade (160ms linear), a just-added row keeps its highlighter without moving, and the House loader shows the finished house with a softly glowing window. Page loads show the House loader only after 250ms. In-sheet loads show skeleton rows drawn to the real rows' geometry.

## Landing page (Persuade surface)

The marketing page at `/` (logged-out visitors) is the same paper turned up to poster scale. It keeps the
app's ground, ink, faces, stamps, highlighter and yellow key. Direction contract:
`.impeccable/surfaces/frontend-src-pages-landing-tsx.md`; build notes in `frontend/CLAUDE.md`.

**Thesis.** One shared space for the household, from the weekly shop to the next trip: the same House shares
both, instead of a group chat full of screenshots. Its demonstrations show less work, not more features. The
page is four parts and a close (distilled 2026-10-16 after a sales critique; plan in
`docs/superpowers/plans/2026-10-16-landing-distill.md`): the hero with its live list, **Lists** (one typing
demo that also shows the add bar's suggestion), **Trips** (one example trip, a weekend in Porto, in two views
switched by two pills: "Planning at home" is a laptop showing the app's desk, with Ideas, the days, "Ready to go?"
and a drawn map of Porto; "On the trip" is a phone showing the next stop and its booking code, then the no-signal
itinerary, because working offline is a trip promise today), **Free** (the receipt, where it runs, and
the way onto the home screen), then the closing sentence. Don't name rival apps; the page sells home plus trips.

**Type.** Outfit 800 for display and headings, Figtree for text, in five steps only: display `clamp(46px, 6.4vw, 96px)`,
heading `clamp(36px, 4.4vw, 66px)`, title `clamp(22px, 2vw, 30px)`, text 18px, small 14px. The headline's last
word cycles (life, groceries, chores, trips, shopping, lists) with the highlighter swiping under each; the
heading's accessible name stays "Manage your life together.".

**Colour.** Whole-section fields are Ink, House Blue or House Red, with white text. Yellow is never a section
or sheet field; it stays on keys, the highlighter and the switch's on-state. Landing tone `#ECECEC` is the
toned paper (the blank in the closing sentence, the secondary key).

**Shapes and paper.** Paper has shaped edges instead of boxes: the peeking sheet under the hero list, two flat
trip sheets (blue for planning, red for the trip) with rounded corners, a zigzag-torn itinerary slip, and a torn till receipt with a tilted red "Nothing due" rubber stamp that lands once.
Controls are 12px-cornered on the landing (full pills in the app).

**Product pictures** are the app's own rows, tabs, add bar, day plan, bookings and packing list, copied from the
real screens (`components/landing/appUi.tsx`), marked `data-ui`. Only the two trip views sit in devices: the MacBook Pro and iPhone 14 Pro frames from
Devices.css (MIT, vendored in `components/landing/devices.css` with its notice). `DeviceFit.tsx` lays each frame out
at its own size and scales it to fit, so a phone shows the same laptop, smaller; the desk is laid out at 960x600
and shrunk into the MacBook's screen. The map of Porto is drawn, not map data (`PortoMap.tsx`, generated
paths in `portoMapData.ts`), with the app's pills and day routes on it. They show only what the app
does (list rows carry no "added by" line). The hero list and the typing list are live: a line is typed, another
housemate ticks the bottom item, the new line lands with the highlighter and its section stamp, and the ticked one
folds into "Show checked-off items" so the list stays balanced. From the second letter the typing list's add bar
shows its suggestion slip rising over the rows, as the app's slips do. Say "sections", never "aisles": the app
sorts by category, not by a shop's layout. Example housemates (Mia, Sam, Jo) are never
labelled "demo": the page sells the product.

**Photographs** are credited open-licence pictures (CC BY, Wikimedia Commons) in `frontend/src/assets/landing/`
with provenance in `credits.json` and in each file. Every photo carries a caption naming the line of the plan it
shows, and that line carries the highlighter; a photo with no line to point to does not go on the page. The trip
photos are of the example trip's own stops: São Bento station (the 11:00 stop on Saturday's plan, beside the
laptop), Santa Apolónia (the phone's next stop, the 09:09 train) and Ribeira (where Saturday's slip ends).

**Poster and kinetic type** (2026-10-16, plan `docs/superpowers/plans/2026-10-16-landing-kinetic-type.md`): set
like Bauhaus printed matter, the type is the image. The hero is a poster on the left, three lines flush left at the
display size (up to 132px), a thick ink rule under them
running off the left edge; on the right the app itself, the live List page on an iPhone 14 Pro, with "Bauhouse"
turned up the margin behind it in House Red, cropped by the page edge, drifting slower than the scroll. The lines are
pushed in from alternate sides and stop hard (`--ld-ease-set`); the cycling word swaps by lifting out of its line. A
band of huge type ("Groceries · Chores · Packing", "Trips · Days · Bookings") runs in opposite directions with the
scroll between the hero and the lists. Section headings (`SetWords.tsx`) are set big across two lines with one word
in a primary colour (or on the highlighter) and a thick rule above that runs off the page; their words slide up into
their lines as they come on screen. The lists demo sits on a hard red square that slides in; the trip sheets are
hard-edged fields bleeding off the page. Scroll motion goes through `useScrollProgress` (`--p`). Everything rests set
with reduced motion. A shapes-as-mascot direction (circle, square and triangle assembling into the logo) was tried
and rejected as clip-art: boldness comes from type, layout and motion, not decorative geometry.

**Composition** (2026-10-16): one page column (`--ld-page`, 1280px max between gutters) that every section's
content starts on, including colour bands, which pad by `--ld-edge` (the distance from the screen's edge to the
column) rather than by the gutter. One section interval, `--ld-section` (104 to 168px), used whole between unrelated
parts and in fractions where two parts belong together (hero to type band, band to lists). Every left-side heavy
rule runs from the screen's edge to the page's centre line, so the rules line up down the page; the lists heading's
rule runs off the right instead. The sideways name is sized to stand the hero's full height and is clipped to the
hero. On wide screens the trip sheets are two-column posters, mirrored: planning has words and photo in 4 columns
and the laptop in 8, the trip has the phone in 5 and words and photo in 7. The closing sentence is set at the
headings' size.

**Motion** is the paper's own: stamps land one after another, the highlighter inks in, ticks pop with confetti in
brand colours, the footer wordmark rises, "start." wakes once there's a name in the blank. All of it sits behind
`prefers-reduced-motion: no-preference`. On phones a sticky "Get started free" key stays within thumb reach once
the first one has scrolled away. It steps aside whenever another key, the closing sentence or the footer is on
screen, and whenever a product picture reaches the strip it would cover.

**Calls to action** say "Get started free" ("Get started" in the nav). Never "Try", which reads as a trial with
a paywall after it, and never "Start your House". The House is introduced in the hero's lede ("everyone you live
with joins your House") and again in the closing note.

**Home screen.** The receipt section says it runs in the browser on iPhone, Android and laptops. Where the
browser can install it (`beforeinstallprompt`, Chromium) a quiet outlined "Install Bauhouse" button sits under
that line; on iPhone and iPad it adds Safari's one step (Share, then Add to Home Screen); once installed it says
nothing more (`lib/installPrompt.ts`).

**Without JavaScript.** `/` is rendered to HTML at build time (`src/landing.server.tsx`,
`scripts/prerender.mjs`) with its stylesheet linked, so search engines, link previews (`public/og.png`) and
visitors without JavaScript see the whole page. The live page replaces that copy before its first paint.

**Landing Don'ts.** Don't fill a section or sheet with yellow (the app's sign-in screens are the only yellow
field). Don't add a sixth type size. Don't put an eyebrow label above a heading. Don't invent a feature the app
lacks in a mockup. The sidecar `.impeccable/design.json` does not yet carry the landing tokens; refresh it with
`/impeccable document`.

## Do's and Don'ts

### Do:
- **Do** build every overlay from `Sheet` and its four tiers: identity, actions, details, footer, separated by 18px, 26px and 22px.
- **Do** give a sheet at most one Key Yellow button. A second action is a quiet button or a text button.
- **Do** place every line of a plan on the row grid `[24] 12 [48] 12 [title] [trail]`, dropping the time column to 0 when there are no times.
- **Do** use the paper heights `--lift-0` … `--lift-3` with `--paper-edge`, chosen by what the surface is, through `Paper` and `PaperStack`.
- **Do** take every value from a token, and run `pnpm design:sync` after changing one so the reference page shows it.
- **Do** keep every control 44px tall or give it a 44px invisible hit area (`ui.css` widens targets under `pointer: coarse`), and keep inputs at 16px or more.
- **Do** put hover effects behind `@media (hover: hover)` and animations behind `prefers-reduced-motion: no-preference`, with a reduced version that keeps the meaning.
- **Do** use PillNav for every tab group.
- **Do** show warnings as amber text with a glyph (`--warn-ink`), and errors and deletes in Stamp Red.
- **Do** keep Google's logo and terms visible on the map, and keep map clicks to "select this item".
- **Do** move the map's camera only on an explicit action: Fit day, Show all days, "Show", a day pick, or an opened item or drag preview that is off screen.

### Don't:
- **Don't** import Ant `Modal`, `Drawer` or `Popover` in trip files, `RoomPage` or any `components/ui` file other than `Sheet.tsx`, or Ant `Input`, `Select`, `Button`, `Switch` or `DatePicker` in trip files. Use the `components/ui` primitives.
- **Don't** write a raw colour, a px font size or a numeric weight in `styles.css`, `trips.css`, `ui.css` or `gmap.css` outside the token block. Add a token, and don't use a `var(--…)` that is not defined.
- **Don't** import Ant `Card` or `Button` anywhere outside the landing page.
- **Don't** use a side-stripe accent border (`border-left` or `border-right` of 2px or more) to mark a row, note or card.
- **Don't** add a second tab style, a bordered text field or a card inside a sheet. Group with tints, hairlines and spacing.
- **Don't** use Outfit for buttons, rows, chips, labels or map pills.
- **Don't** add numbers to map stops or rows; order is shown by the route's chevrons and the list.
- **Don't** add click-to-add, place popovers or clickable Google place icons to the map.
- **Don't** add a permanent `will-change`, a `filter` on an always-visible image, or a font or script origin other than Google Maps for the map.
