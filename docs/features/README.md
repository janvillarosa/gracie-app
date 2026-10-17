# Feature notes

Per-feature behavior and invariants, backend and frontend together. Read the one for the feature you
are changing; the layer guides (`backend/CLAUDE.md`, `frontend/CLAUDE.md`) only keep the rules that
must never be missed. Update the note in the same commit when you change a feature's behavior.

| Feature | Note | Spec(s) in `docs/superpowers/specs/` |
|---|---|---|
| Trips (offline sync, map, places, desk) | [trips.md](trips.md) | `2026-10-14-trips-api-persistence-design.md`, `2026-10-15-trips-ui-brief.md`, `2026-10-15-google-maps-migration.md` |
| Behavior analytics | [analytics.md](analytics.md) | `2026-10-16-behavior-analytics-design.md`, `2026-10-16-analytics-backfill-design.md` |
| Smart suggestions | [suggestions.md](suggestions.md) | `2026-10-16-smart-suggestions-design.md` |
| Lists (add bar, rows, undo) | [lists.md](lists.md) | `2026-10-14-list-autocomplete-and-rows-brief.md` |
| Landing page | [landing.md](landing.md) | `2026-10-15-landing-page-brief.md` |
| Categorization | [backend/CLAUDE.md](../../backend/CLAUDE.md) | `2026-06-28-embedding-categorization-design.md`, `2026-06-28-category-index-design.md` |
