# List autocomplete, rows and navigation — implementation plan

Spec: `docs/superpowers/specs/2026-10-14-list-autocomplete-and-rows-brief.md` (approved).

Isolation: backend (Go) and frontend (TS) touch disjoint files; backend lands first
because the frontend type depends on the new pantry shape.

1. **Backend** — `ListItemRepository.ListByRoom` (mongo + memstore); `GetPantry` aggregates
   active + archived items by `parse.NormalizeKey`, returns `quantity, unit, times_added,
   last_added_at, common`; sparse houses get `GroceryAnchors` appended as `common`.
   Tests: service unit test (memstore) + Mongo integration test for `ListByRoom`.
2. **Autocomplete** — `lib/suggest.ts` (rank/filter, pure, tested) + combobox in
   `AddItemBar` (ARIA combobox, ghost text, slips). Pantry fetched once via react-query.
   Enter never hijacked without an explicitly highlighted slip.
3. **Rows** — `ItemRow` inline qty, trailing category stamp, hover trash, hand-written
   swipe-to-delete, long-press drag on touch, Undo toast (deferred delete).
4. **Header/nav** — back chevron + house name in `TopNav` on list page, single meta
   line, "By category" toggle beside tabs, completed footer row.
5. **Validate** — `make check`, `make test-integration` if Mongo is up, browser pass
   (desktop + mobile) once.
