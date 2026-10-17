# Lists

Household lists: the add bar, rows, undo. Core server flows (signup, share, join, deletion) are in [backend/CLAUDE.md](../../backend/CLAUDE.md).

## Frontend (list page)

_Frontend paths are relative to `frontend/src/`._

- **Add-bar suggestions:** `AddItemBar` is an ARIA combobox fed by `GET /rooms/{id}/pantry`
  (fetched once in `ListPage`, filtered client-side by `lib/suggest.ts`). Enter only takes a
  slip the user explicitly arrowed to; otherwise it adds the typed text. `ListPage.bumpPantry`
  keeps the cached pantry current after each add.
- **Rows:** swipe-left (touch) and the hover trash (desktop) both go through `onDeleteItem`,
  which defers the request ~5s behind an Undo toast and flushes on unmount. **Clear completed**
  (`onClearCompleted`) works the same way: rows leave at once, the `/clear` request waits for the
  toast to close, Undo cancels it.
