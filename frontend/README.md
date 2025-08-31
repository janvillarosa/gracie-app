# Gracie Frontend (React + Vite)

Simple UI for the Gracie backend flows:

- Login or Register (API key)
- View current room (if any)
- Join a room with Room ID + 5-char code (no I/O/L)
- Create a solo room
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
- Errors from the backend are surfaced with friendly messages for 403/409 during join.

