# gracie-app — Agent Guide (index)

**Bauhouse** (user-facing brand) / **Gracie** (internal name) — a shared-household
lists app. Go + `chi` backend, React + Vite + TypeScript frontend, MongoDB.

This file is the index. Read the guide for the area you're touching:

| Area | Guide |
|---|---|
| Backend (architecture, core flows, tests) | [backend/CLAUDE.md](backend/CLAUDE.md) |
| Persistence / Mongo | [backend/internal/store/CLAUDE.md](backend/internal/store/CLAUDE.md) |
| Frontend (layout, tests, tokens, UI primitives) | [frontend/CLAUDE.md](frontend/CLAUDE.md) |
| A feature (trips, lists, suggestions, analytics, landing) | [docs/features/](docs/features/README.md) |
| Visual design rules | [DESIGN.md](DESIGN.md), [docs/design-system/index.html](docs/design-system/index.html) |
| Product intent, users, tone | [PRODUCT.md](PRODUCT.md) |
| Deploy (Railway, Vercel, `enc.key`) | [DEPLOY.md](DEPLOY.md) |

## Start here: fresh clone or worktree

Worktrees do not share gitignored files with the main checkout, so a new one has no
`node_modules`, no linter binary and no local env. Run this once before anything else:

```bash
make bootstrap
```

It installs Go and pnpm deps, builds `backend/bin/golangci-lint`, and copies
`frontend/.env.development.local` (Google Maps key) from the main checkout if there is one.
Then `make check` works. Don't hunt for the linter in `~/go/bin` or the main checkout.

## Command surface — use these, not ad-hoc commands

All validation goes through the root `Makefile`, so humans, CI, and agents run the
exact same commands. From the repo root:

| Command | What it does |
|---|---|
| `make bootstrap` | One-time setup for a fresh clone/worktree (see above). |
| `make check` | **Run before every commit.** fmt-check + vet + lint + typecheck + build + test-unit. Fast (~20s), no external services. |
| `make fmt` | Auto-format (gofmt + Biome). Run it when `make check` fails on formatting. |
| `make test-unit` | Fast tests only (backend in-process + frontend). |
| `make test-integration` | Mongo-backed tests (needs Mongo — see "Integration tests" below). |
| `make help` | List all targets. |

**Never trust a bare `go test ./...` for the persistence layer.** The Mongo tests
sit behind the `integration` build tag and only run via `make test-integration`.
The fast path is deliberately in-process (memstore fakes) so it stays honest and quick.

**Running one test while iterating** (then finish with `make check`):

- Backend: `cd backend && go test ./internal/services/ -run TestName -count=1`
- Frontend: `cd frontend && pnpm exec vitest run src/__tests__/File.test.tsx`
  (the config already forces a single fork; no `--pool` flag or `npx` needed)

### Integration tests (Mongo)

One recipe; don't improvise URIs or containers:

```bash
docker compose up -d mongo mongo-rs-init
```

```bash
MONGODB_URI='mongodb://localhost:27017/?directConnection=true' make test-integration
```

`directConnection=true` is required from the host: the replica set member is named
`mongo:27017`, which only resolves inside compose. Tests **skip** (not fail) when Mongo is
unreachable, so read the output for `SKIP` before calling it green. Docker must be running;
`mongosh` is not installed on the host (use `docker exec gracie-mongo mongosh`).

### Running the app

- **Frontend only, no backend (fastest for UI work):** `cd frontend && VITE_MOCK_TRIPS=1 pnpm dev`.
  An in-browser MSW mock signs you in as a mock user with lists and a seeded trip
  (`?mockPhase=before|during|after`). Configs for the preview tool are in `.claude/launch.json`.
- **Full stack:** `docker compose up --build` starts Mongo (RS), API (8080) and the frontend
  (3000). Or run Mongo from compose, then the API (it reads only real env vars, not a `.env` file;
  see `.env.example` for the rest):
  `cd backend && MONGODB_URI='mongodb://localhost:27017/?directConnection=true' ENC_KEY_FILE=../.secrets/enc.key go run ./cmd/gracie-server`,
  and `cd frontend && pnpm dev` (5173, proxies `/api` to 8080).
- Pick a fixed port with `--strictPort`; don't probe for free ports.

## Environment gotchas (this machine)

- **Go builds with `CGO_ENABLED=0`** (the Makefile exports it, like the deploy images). It keeps
  Go off the macOS system linker, which fails on some SDKs (`ld: tapi error: malformed file`).
  If you call `go` directly and hit that error, prefix `CGO_ENABLED=0`.
- **Node 20** (`.nvmrc`); the machine default may be newer. Use `nvm use` if Vitest misbehaves.
- **The shell is zsh.** Quote globs (`grep -rn foo --include='*.ts'`), or zsh fails with
  "no matches found". `sed` is BSD sed: `sed -i ''`, no `\n` in replacements; use the Edit tool
  or a small script for multi-line edits.

## Git and PR workflow

- **Default: branch + PR, with Auto-fix on.** Work on a branch (worktree branches are
  `claude/<topic>`), open a PR to `main`, and turn on Auto-fix for it. Push to `main` directly
  only when Jan says so in that session.
- Commits: Conventional style with a scope, imperative and lower-case, e.g.
  `fix(add-bar): cap autocomplete at 3 slips`, `feat(trips): …`, `chore(harness): …`.
  Separate logical changes into separate commits.
- Before starting, make sure the branch is current with `main` (Jan often merges in parallel).
- Keep git commands simple and standalone (`git status`, `git add <paths>`, `git commit -m …`).
  The worktree guard refuses git mixed with `cd`, heredocs or pipes into other tools, and never
  `cd` into the main checkout from a worktree.
- Never commit `.claude/` (except `launch.json`), `.superpowers/`, `.playwright-mcp/`, screenshots,
  `.env*` files or `.secrets/`. They are gitignored; don't force-add them.

## Where docs go

- Design specs: `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (briefs: `-brief.md`).
- Implementation plans: `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.
- QA reviews and audits: `docs/superpowers/qa/<topic>-YYYY-MM-DD.md`.
- When a feature ships or changes, update its note in `docs/features/` in the same PR.

## Branding rule

Do **not** rename internal identifiers for branding — package names, the `gracie`
database name, env vars, and docker-compose service names stay "gracie". Only
user-facing UI copy says "Bauhouse". The UI calls a room a **House**; backend
endpoints stay `/rooms/*`.

## Design system — read before any UI change

Bauhouse has one design system. Do not invent around it.

1. **Look it up first.** The living reference is [docs/design-system/index.html](docs/design-system/index.html)
   (open it in a browser): every token in use and every pattern (paper, stacks, the button family,
   floating slips). The rules and rationale are in [DESIGN.md](DESIGN.md); the components are in
   `frontend/src/components/ui/` (see [frontend/CLAUDE.md](frontend/CLAUDE.md), "UI primitives").
2. **Draw only with tokens.** Every colour, font size, weight, radius, control height, icon size,
   shadow and grain is a token in the one `:root` block at the top of `frontend/src/styles.css`.
   No raw hex/rgba, px font sizes or numeric weights in the app's CSS (tests enforce it). Type is
   nine roles (`--t-display` … `--t-code`), weights are four (`--w-*`), text is three inks
   (`--ink`, `--text`, `--muted`).
3. **Compose from the primitives.** Panels are `Paper` (one sheet at one of four heights) and
   `PaperStack` (sheets slid over each other with sheets peeking beneath). Buttons are `Button`
   (`key`: one per sheet; `quiet`; `text`; `iconOnly`). Overlays are `Sheet`. No Ant `Card`,
   `Button` or `Modal` outside the landing page (tests enforce it).
4. **Missing something?** Add it to the system first: a token in the block (then run
   `pnpm design:sync` in `frontend/` so the reference page shows it), or a primitive in
   `components/ui/` with its section on the reference page and in DESIGN.md. Never a one-off.

## Canonical facts

- **Datastore:** MongoDB only (single-node replica set locally, for transactions).
  There is no DynamoDB — it was removed.
- **Go:** 1.26, pinned to the `golang:1.26-alpine` deploy image. If you bump it,
  change `go.mod`, both `backend/Dockerfile*`, and `.github/workflows/tests.yml`
  in the same commit.
- **Frontend:** pnpm 9 (never npm or `npx`; use `pnpm exec`), Node 20 (`.nvmrc`). Newer Node can
  destabilize Vitest's worker pool, which is why the config forces a single fork.
- **Secrets:** AES key at `./.secrets/enc.key` (gitignored). Never commit it, and never copy,
  download or move the production key (it stays on the Railway volume; user data is encrypted
  with it).

## Definition of Done

- [ ] `make check` passes.
- [ ] Tests added or updated for the change (backend and/or frontend).
- [ ] Coverage did not regress (ratchet floors are enforced in CI).
- [ ] `make test-integration` passes if you touched the Mongo layer.
- [ ] The relevant `CLAUDE.md`, `docs/features/` note or README is updated if behavior or setup changed.
- [ ] UI changes checked in the running app (mock dev server is enough), not only in tests.

## CI

`.github/workflows/tests.yml` runs backend (build/vet/lint/test+coverage), frontend
(typecheck/lint/build/test+coverage), and a Mongo integration job. Make `tests` a
required status check in branch protection so deploys only follow green CI.
