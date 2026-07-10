# Frontend — RentUg (PWA)

React + Vite PWA. Currently implements the landlord submission form (PRD Feature 1).

## Run locally

Terminal 1 — backend:

```bash
cd backend
ADMIN_TOKEN=<your-secret> .venv/bin/uvicorn app.main:create_app --factory --reload
```

Terminal 2 — frontend (Node is in `~/.local/node`, already on PATH via `.bashrc`):

```bash
cd frontend
npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` and `/uploads` to the
backend on port 8000 (override with `BACKEND_URL`), so no CORS setup is needed.

## Tests

```bash
npm test
```

## Production build

```bash
npm run build   # outputs dist/ with service worker + manifest
```

Serve `dist/` from the same origin as the API, or set `VITE_API_BASE_URL` at
build time (see `.env.example`).
