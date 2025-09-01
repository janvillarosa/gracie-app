Deploying Frontend (Vercel) and Backend (Railway)

Overview
- Frontend (Vite + React) is deployed to Vercel.
- Backend (Go API + DynamoDB) is deployed to Railway.
- API requests are proxied via Vercel rewrites to avoid browser CORS.

1) Backend on Railway
- Create a new Railway service from this repo (root) or a Go template pointing to `backend/`.
- Configure environment variables:
  - `PORT` = 8080 (Railway will inject a port, but server reads `PORT` as well)
  - `AWS_REGION` = your AWS region (e.g., `us-east-1`)
  - `DDB_ENDPOINT` = `aws` (use AWS-managed DynamoDB; leave blank or `aws`)
  - `USERS_TABLE` = `Users`
  - `ROOMS_TABLE` = `Rooms`
  - `LISTS_TABLE` = `Lists`
  - `LIST_ITEMS_TABLE` = `ListItems`
  - `ENC_KEY_FILE` = `/data/enc.key` (see persistence below)
  - `API_KEY_TTL_HOURS` = `720` (optional)
  - `CORS_ORIGIN` = `https://<your-vercel-domain>` (only needed if you skip Vercel rewrites)
- AWS credentials (choose one):
  - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (and optionally `AWS_SESSION_TOKEN`)
  - Or attach an IAM role if using a platform that supports it.
- Persistence (encryption key):
  - Add a Railway volume mounted at `/data` (or similar) so `/data/enc.key` persists across restarts.
  - On first boot, the API creates the key if it doesn’t exist; ensure the volume is attached before boot so the key is retained.
- DynamoDB tables:
  - Create `Users`, `Rooms`, `Lists`, `ListItems` in AWS DynamoDB (on first run you can run the local `setup-ddb` tool against AWS by setting `DDB_ENDPOINT=aws` and AWS credentials locally).

2) Frontend on Vercel
- Project root: set the Root Directory to `frontend` (Vercel → Project Settings → General).
- Build settings:
  - Install Command: `pnpm install`
  - Build Command: `pnpm build`
  - Output Directory: `dist`
- API proxy to Railway (recommended):
  - Edit `frontend/vercel.json` and replace `YOUR-RAILWAY-API-HOST` with your Railway HTTPS host (e.g., `gracie-api.up.railway.app`).
  - With this in place, the app calls `/api/*` and Vercel forwards to Railway; no CORS changes are needed.
- SPA fallback is configured in `vercel.json` to serve `index.html` for client routes.

3) Alternative: direct API base URL (requires CORS)
- Instead of rewrites, set `VITE_API_BASE_URL` in Vercel env vars to `https://<railway-host>`.
- Then set `CORS_ORIGIN=https://<your-vercel-domain>` in Railway env vars (CORS is enabled in the API).

4) Local sanity checks
- `cd frontend && pnpm dev` (Vite proxy handles `/api` → local backend)
- `cd backend && go run ./cmd/gracie-server` with DynamoDB Local or AWS.

Notes
- The backend now supports AWS DynamoDB (when `DDB_ENDPOINT` is blank or `aws`) and DynamoDB Local (when set to a URL like `http://localhost:8000`).
- The API enables CORS when `CORS_ORIGIN` is set; otherwise it allows all origins without credentials.

