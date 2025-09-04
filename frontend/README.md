# Bauhouse Frontend (React + Vite)

Simple UI for the Bauhouse backend flows:

- Login or Register (API key)
- View current house (if any)
- Join a house with a 5-char code (no I/O/L); no need for an internal ID
- Create a solo house
- Vote to delete / cancel vote

## Prereqs

- Node.js 18+ (recommended 20)
- pnpm 9+ (npm/yarn also work)
- Backend running at http://localhost:8080

## Setup

```
cd frontend
pnpm install
pnpm dev
```

This uses a Vite dev proxy. The frontend calls `/api/*`, which proxies to the backend on port 8080.

If your backend is on another host/port, set `VITE_API_BASE_URL` when running `pnpm dev`:

```
VITE_API_BASE_URL=http://localhost:8080 pnpm dev
```

## Notes

- API key is stored in `localStorage` under `gracie_api_key`.
- Share codes are 5 characters, alphanumeric, excluding I/O/L.
- “Room” is called “House” in the UI; backend endpoints remain `/rooms/*`.
- House Settings lets you edit display name/description, rotate share code (in a dismissible modal with “Get new code”), and vote/cancel deletion.
- Errors from the backend are surfaced with friendly messages for 403/409 during join.

### Live Query Refresh Intervals

You can control live refresh intervals via Vite env vars (milliseconds):

```
VITE_LIVE_QUERY_LISTS_MS=4000   # refresh Lists on the House page
VITE_LIVE_QUERY_ITEMS_MS=2000   # refresh Items on the List page
```

- Dev: prefix on the command, e.g., `VITE_LIVE_QUERY_ITEMS_MS=1000 pnpm dev`.
- Docker: set build args under the `frontend` service in `docker-compose.yml`. These are compiled at build time and baked into the bundle.
