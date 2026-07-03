# gracie-app — Agent Guide (index)

**Bauhouse** (user-facing brand) / **Gracie** (internal name) — a shared-household
lists app. Go + `chi` backend, React + Vite + TypeScript frontend, MongoDB.

This file is the index. Read the layer guide for the area you're touching:

- Backend — [backend/CLAUDE.md](backend/CLAUDE.md)
- Persistence / Mongo — [backend/internal/store/CLAUDE.md](backend/internal/store/CLAUDE.md)
- Frontend — [frontend/CLAUDE.md](frontend/CLAUDE.md)

## Branding rule

Do **not** rename internal identifiers for branding — package names, the `gracie`
database name, env vars, and docker-compose service names stay "gracie". Only
user-facing UI copy says "Bauhouse". The UI calls a room a **House**; backend
endpoints stay `/rooms/*`.

## Command surface — use these, not ad-hoc commands

All validation goes through the root `Makefile`, so humans, CI, and agents run the
exact same commands. From the repo root:

| Command | What it does |
|---|---|
| `make check` | **Run before every commit.** fmt-check + vet + lint + typecheck + build + test-unit. Fast (~20s), no external services. |
| `make fmt` | Auto-format (gofmt + Biome). |
| `make test-unit` | Fast tests only (backend in-process + frontend). |
| `make test-integration` | Mongo-backed tests (needs Mongo — see `.env.example`). |
| `make help` | List all targets. |

**Never trust a bare `go test ./...` for the persistence layer.** The Mongo tests
sit behind the `integration` build tag and only run via `make test-integration`.
The fast path is deliberately in-process (memstore fakes) so it stays honest and quick.

## Canonical facts

- **Datastore:** MongoDB only (single-node replica set locally, for transactions).
  There is no DynamoDB — it was removed.
- **Go:** 1.26, pinned to the `golang:1.26-alpine` deploy image. If you bump it,
  change `go.mod`, both `backend/Dockerfile*`, and `.github/workflows/tests.yml`
  in the same commit.
- **Frontend:** pnpm 9, Node 20 (`.nvmrc`). Newer Node can destabilize Vitest's
  worker pool, which is why the config forces a single fork.
- **Secrets:** AES key at `./.secrets/enc.key` (gitignored). Never commit it.

## Definition of Done

- [ ] `make check` passes.
- [ ] Tests added or updated for the change (backend and/or frontend).
- [ ] Coverage did not regress (ratchet floors are enforced in CI).
- [ ] `make test-integration` passes if you touched the Mongo layer.
- [ ] The relevant `CLAUDE.md` / README is updated if behavior or setup changed.

## Local development

`docker compose up --build` starts Mongo (RS), API (8080), and the frontend (3000).
For non-docker runs, copy `.env.example` to `.env`.

## CI

`.github/workflows/tests.yml` runs backend (build/vet/lint/test+coverage), frontend
(typecheck/lint/build/test+coverage), and a Mongo integration job. Make `tests` a
required status check in branch protection so deploys only follow green CI.
