# The paper system — plan (2026-10-16)

Goal: every surface and every button in the app is drawn from one paper system, so the
"stack of paper on a desk" world is built into the components rather than re-assembled
page by page. Colours, type and the yellow key stay as DESIGN.md has them.

## What is there today (evidence)

- **Panels are hand-assembled per page.** House, List and Trip each compose
  `.paper-stack` + Ant `Card` + `paper-meta` / `paper-list` classes. The peeking sheet under
  a stack is drawn twice (`.paper-stack::after`; `.trip-deck-wrap.has-1/2` in trips.css). The
  desk's Ideas column is a flat card next to a Days column that is a stack. Settings, the
  no-House page and sign-in are single cards with nothing under them. Ant `Card` is the outer
  panel in 12 files.
- **Buttons come from three families.** `ui` Button (`key` 25, `quiet` 21, `text` 40), Ant
  `Button` (List page, add bar, item rows, sign-in, register, error states, lists index) and
  hand-rolled buttons (`undo-btn`, `completed-toggle`, `trip-inline-link`, `map-screen-text`,
  `avatar-button`). `styles.css` carries 164 `.ant-*` re-skin rules to make Ant look like us.
  Visible drift: the List page's add button is a grey disabled disc; sign-in's key is a grey
  pill over boxed inputs.
- **Shadows**: the four lifts exist, but 11 shadows are raw values (the peeking sheet's
  shadow is written three times; the auth card and login key have their own).

## 0. Tokens: type, weight, colour, sizing (the layer everything else reads)

Audit (2026-10-16): ~40 distinct font sizes (half outside the size tokens; 12 / 12.5 / 13 / 14 /
15 / 15.5 / 16 all in use), 8 weights (400 500 600 620 650 700 720 860), five text greys, alias
colour tokens (`--color-primary` = `--brand-yellow` …), 77 raw hex and 44 raw rgba values in
`styles.css` outside `:root`, stray radii (2 3 6 10 14px) and 44px written 18 times.

- **Type roles** (`--t-*`): Display `clamp(36px, 4.4vw, 48px)` Outfit 700 · Title 28 Outfit 700 ·
  Heading 22 Outfit 600 · Lead 17 · Field 16 (every input, the no-zoom rule) · Body 15 · Meta 13 ·
  Label 12 caps 700 · Stamp 11 caps 700 (Figtree). Every other size maps to its nearest role.
- **Weights** (`--w-*`): regular 400, medium 500, semibold 600, bold 700. 620 / 650 → 600; 720 → 700.
- **Colour roles**: three inks (`--ink` titles, values, controls; `--text` running text; `--muted`
  meta, labels, placeholders, never on yellow), three surfaces (`--bg` desk, `--panel` paper,
  `--panel-subtle` well), two edges (`--border` hairline, `--border-strong` edge), then key, danger,
  focus, warn, ok. Retired: `--ink-heading` (→ ink), `--text-secondary` (→ muted; it was 4.5:1),
  the `--color-*` aliases. Raw hex and rgba outside `:root` become tokens; the enforcement test
  extends the no-raw-colour rule from `ui.css` / `trips.css` to `styles.css`.
- **Sizing**: space 4…32 as now; controls `--control-sm` 32 (new) / md 36 / lg 44, row 52,
  composer 56; radii xs 6 (new) / sm 8 / md 12 / lg 16 / sheet 20 / pill; icons 16 / 18 / 20 / 24.
- **Texture and depth** (from the bolder mock): `--grain-paper`, `--grain-desk`, the sheet thickness
  in the lifts, the deeper lifts, `--well`, the key's 2px travel and the slip heights.
- DESIGN.md's frontmatter and Typography / Colors / Layout sections are rewritten to these roles;
  the sidecar is refreshed with `/impeccable document` afterwards.

## The system

### 1. Surfaces: `Paper` and `PaperStack`

- **`Paper`** (`components/ui/Paper.tsx`): one sheet. Props: `lift` (0 resting, 1 on top,
  2 overlay, 3 popover; the four heights DESIGN.md already names), `tone` (`paper` | `tint`),
  `as` (section/div/article), `inset` (the standard 24px / 20px sheet padding, or none).
  Draws the 1px edge, the paper-edge highlight, the 16px squircle and the lift. Replaces Ant
  `Card` and every `paper-card` class.
- **`PaperStack`** (`components/ui/PaperStack.tsx`): the stack, as one function. Children are
  sheets bottom-to-top; it does the 20px overlap, z-order, the peeking edges (`peek={0|1|2}`:
  how many sheets show beneath, at the 14px and 28px insets DESIGN.md specifies), and the
  arrival: the sheets settle bottom-up with one stagger, behind reduced motion. Used by House,
  List, Trip (plan and the next-stop deck), and as a one-sheet stack (`peek={1}`) for
  Settings, Account, no-House and sign-in, so every page is a small pile of paper, not a lone card.
- **Desk columns**: Ideas, Days and Map share the same top and bottom edges and lift; Ideas
  becomes a one-sheet stack so the three columns read as paper laid side by side.
- Tokens: `--peek-shadow` replaces the three hand-written peek shadows; the auth card and any
  other one-offs move onto a lift.

### 2. Buttons: one family, paper physics

All buttons come from `ui/Button`; the kinds keep their meaning (one key per sheet, red means
gone). What changes is that each one behaves like paper of a known height:

- **Key** (yellow): the one lifted control, as now. Press settles it 1px into the sheet.
- **Quiet**: a paper slip at lift 0: white, 1px edge, paper-edge highlight. Hover lifts it a
  hair; press presses it into the page (the shadow goes, a 1px inset appears). Disabled is
  paper with muted ink, never a grey pill.
- **Text**: ink on the paper, no surface. Danger is red ink.
- **Icon**: a round quiet slip (36px, 44px hit area).
- **New: `IconKey`**: the round yellow key (the add bar's plus, the composer's 48px key), so
  those stop being one-offs; disabled shows the paper disc, not Ant grey.
- Migrate every Ant `Button` and hand-rolled button to these (List page, add bar, item rows,
  sign-in, register, error states, lists index, undo, completed toggle, inline links). Then
  delete the Ant button re-skins.

### 3. Floating paper: menus, toasts, tooltips

Ant `Dropdown`, `message` and `Tooltip` stay (they're behaviour), but are skinned in one place
as paper slips at lift 3 with the paper edge, 12px corners and the same type, instead of the
scattered overrides.

### 4. Out of this pass

Sign-in and register fields stay Ant `Input` for now (they work, and auth is its own flow), but
they sit on the new paper and use the new key. Turning them into `Field`s is a follow-up.

## Order of work

1. `Paper`, `PaperStack`, `IconKey`, the quiet/disabled physics and the tokens, shown in the
   `/dev/ui` gallery.
2. Migrate House, List, Trip (incl. deck and desk columns), Settings, Account, no-House, sign-in.
3. Migrate the remaining Ant and hand-rolled buttons; delete the dead `.ant-btn` re-skins and
   the old `paper-*` / `trip-deck-wrap` stack CSS.
4. Skin menus, toasts and tooltips as paper slips.
5. Enforcement test: no Ant `Card` or `Button` outside the landing page; no raw shadows in
   `styles.css` outside `:root`. DESIGN.md and `frontend/CLAUDE.md` updated.

Verification: `make check`, the existing tests (several assert class names and will move to
the new components), one capture round at 390 and 1280 px across the migrated pages.
