Deploying Frontend (Vercel) and Backend (Railway)

Overview
- Frontend (Vite + React) is deployed to Vercel.
- Backend (Go API + MongoDB) is deployed to Railway.
- API requests are proxied via Vercel rewrites to avoid browser CORS.

1) Backend on Railway
- Create a Railway service from this repo, building from `backend/Dockerfile.railway`.
- Provide a MongoDB with a **replica set** (transactions require one) — e.g. MongoDB
  Atlas or a Railway Mongo plugin. Collections and indexes are managed by the app; no
  manual table/collection setup is needed.
- Configure environment variables:
  - `PORT` = `8080` (Railway also injects a port; the server reads `PORT`)
  - `MONGODB_URI` = your managed connection string (must target the replica set)
  - `MONGODB_DB` = `gracie`
  - `ENC_KEY_FILE` = `/data/enc.key` (see persistence below)
  - `API_KEY_TTL_HOURS` = `720` (optional)
  - `CORS_ORIGIN` = `https://<your-vercel-domain>` (only needed if you skip Vercel rewrites)
  - Embedding (optional): `EMBEDDING_ENABLED`, `EMBEDDING_MODEL_PATH`,
    `EMBED_THRESHOLD`, `EMBED_TOPK` — see `backend/README.md`.
- Persistence (encryption key):
  - Add a Railway volume mounted at `/data` so `/data/enc.key` persists across
    restarts. The API creates the key on first boot; attach the volume before boot so
    the key is retained.
  - The key stays on the volume on purpose: nobody downloads it or holds a copy. The
    cost is that Railway cannot overlap deploys of a volume-backed service (it stops
    the old container before starting the new one), so every backend deploy has a
    short outage. The server keeps it short by listening before the embedding model
    loads (items added in those first seconds get keyword categories).
- Healthcheck: set the service's Healthcheck Path to `/healthz`. Railway then marks a
  deploy live only once the server answers, instead of as soon as the container starts.

2) Frontend on Vercel
- Project root: set the Root Directory to `frontend`.
- Build settings:
  - Install Command: `pnpm install`
  - Build Command: `pnpm build`
  - Output Directory: `dist`
- API proxy to Railway (recommended):
  - Edit `frontend/vercel.json` and replace `YOUR-RAILWAY-API-HOST` with your Railway
    HTTPS host (e.g., `gracie-api.up.railway.app`).
  - The app then calls `/api/*` and Vercel forwards to Railway; no CORS changes needed.
- SPA fallback is configured in `vercel.json` to serve `index.html` for client routes.

3) Alternative: direct API base URL (requires CORS)
- Instead of rewrites, set `VITE_API_BASE_URL` in Vercel env vars to `https://<railway-host>`.
- Then set `CORS_ORIGIN=https://<your-vercel-domain>` in Railway env vars.

4) Local sanity checks
- `cd frontend && pnpm dev` (Vite proxy handles `/api` → local backend).
- `cd backend && go run ./cmd/gracie-server` against a local Mongo replica set — or
  just `docker compose up` from the repo root.

Notes
- MongoDB requires a replica set for transactions; the app falls back to
  non-transactional execution only in standalone dev.
- The API enables CORS when `CORS_ORIGIN` is set; otherwise it allows all origins
  without credentials.
