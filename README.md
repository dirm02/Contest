# Contest (AccountibilityMax UI)

React + Vite app. **Production** is static files + `/api` on your host (e.g. nginx → Node). **Local dev** always uses **127.0.0.1** and fixed ports.

## Local development (recommended)

Two terminals — same machine, local ports only:

| What | Where | Command | URL / port |
|------|--------|---------|------------|
| Dossier API | `agency-26-hackathon/general` | `npm install` then `npm run entities:dossier` | **http://127.0.0.1:3801** |
| This UI | this repo (`Contest`) | `npm install` then `npm run dev` | **http://127.0.0.1:5173** |

Open **http://127.0.0.1:5173**. The dev server proxies `/api/*` → `http://127.0.0.1:3801` (see `vite.config.ts`).

API needs `general/.env` with `DB_CONNECTION_STRING` (Postgres can be remote; the browser never talks to Postgres).

Optional: copy `.env.development.example` → `.env.development` and set `DEV_API_PROXY_TARGET` if your API is not on 3801.

## Production build (deploy / CI)

From this repo:

```bash
npm ci
npm run build
```

Output: `dist/`. Upload or sync `dist/` to your static host; `/api` must be proxied to the dossier server (same pattern as prod nginx).

## Preview production build locally

```bash
npm run build
npm run preview
```

Serves **http://127.0.0.1:4173** (no proxy in preview — use dev workflow above for API-backed testing, or point preview at a host that serves both static + `/api`).

## Repo layout note

The **backend** lives in **GovAlta/agency-26-hackathon** (`general/visualizations/server.js`). This repo is the UI only; keep API and UI versions in sync when you add routes.
