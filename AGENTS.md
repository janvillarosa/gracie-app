# Agents — start here

This repository's agent guide is [CLAUDE.md](CLAUDE.md) (with layer guides in
[backend/CLAUDE.md](backend/CLAUDE.md), [backend/internal/store/CLAUDE.md](backend/internal/store/CLAUDE.md)
and [frontend/CLAUDE.md](frontend/CLAUDE.md)). Read it first; everything below is a summary of rules
stated there.

## Design system: do not invent

- The living reference is [docs/design-system/index.html](docs/design-system/index.html). It shows
  every design token the app uses (copied from the app by `pnpm design:sync`) and every UI pattern.
  [DESIGN.md](DESIGN.md) holds the rules and the reasons.
- Every colour, size, weight, radius, shadow and texture is a token in the single `:root` block at
  the top of `frontend/src/styles.css`. Never write a raw value in CSS; tests fail if you do.
- Panels are `Paper` / `PaperStack`, buttons are `Button` (`key` once per sheet, `quiet`, `text`),
  overlays are `Sheet`, all from `frontend/src/components/ui/`. No Ant `Card`, `Button` or `Modal`
  outside the landing page.
- If the system lacks what you need, extend the system (token or primitive, plus the reference page
  and DESIGN.md) instead of writing a one-off.

## Before you commit

`make check` from the repo root (and `make test-integration` if you touched the Mongo layer).
