# Frontend — Agent Guide

React 18 + Vite + TypeScript SPA. Ant Design + Tailwind v4, TanStack Query for
server state, React Router. See the root [CLAUDE.md](../CLAUDE.md) for the command
surface and canonical facts.

## Terminology (UI copy)

The UI is branded **Bauhouse** and calls a "room" a **House**. Backend endpoints and
internal identifiers stay `/rooms/*` / "gracie" — only visible copy changes.

## Layout

`src/` — `api/` (fetch `client.ts`, `endpoints.ts`, `types.ts`), `auth/`
(`AuthProvider` — API key in `localStorage` key `gracie_api_key`), `components/`,
`pages/`, `lib/` (helpers), `routes/`. Path aliases (`@api`, `@auth`, `@components`,
`@pages`, `@lib`, `@routes`, `@assets`) are defined in both `vite.config.ts` and
`tsconfig.json` — keep them in sync.

## Validation

Run from the repo root via `make check`, or directly here:

- **Typecheck:** `pnpm typecheck` (`tsc --noEmit`). `vite build` does **not**
  typecheck, so this is the only thing that enforces `strict` TS. Asset-module
  imports (`*.png`, `*.webmanifest`, …) are declared in `src/vite-env.d.ts`.
- **Lint/format:** `pnpm lint` / `pnpm format` (Biome, config in `biome.json`).
  Biome handles JS/TS only; Tailwind CSS is excluded.
- **Tests:** `pnpm test` (watch) / `pnpm test:ci` (coverage). Vitest + Testing
  Library + **MSW** for HTTP mocking. `src/testServer.ts` exports the shared server;
  register handlers per-test with `server.use(...)`.

Use **Node 20** (`.nvmrc`) — newer Node destabilizes Vitest's worker pool, which is
why the config forces a single fork.

## Testing conventions

- **No arbitrary `setTimeout`/sleep waits in tests.** Use `await waitFor(...)` or
  `findBy*` queries to await state — sleeps are flaky. (Some older tests still use
  sleeps; replace them when you touch those files.)
- Assert on user-visible behavior (roles/text), not implementation details.

## Ratchets (raise over time; never lower)

- **Coverage:** thresholds live in `vite.config.ts` (`test.coverage.thresholds`),
  set just under the current baseline. When you add tests, bump them to the new floor.
- **Lint:** `recommended` is on, but a batch of pre-existing violations (some a11y
  rules, plus `useExhaustiveDependencies`, `noArrayIndexKey`) are downgraded to
  `warn` in `biome.json` so the baseline is green. Fix violations and promote each
  rule back to error (its `recommended` default). Also open: `noExplicitAny` and
  `noNonNullAssertion` warnings to work down.
