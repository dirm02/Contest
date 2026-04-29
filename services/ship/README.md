# Ship Analyst Backend

This folder contains the portable ship-mode analyst service copied from `/home/david/GitHub/hackathon2026/output/ship`. The public API remains `output.ship.server:app`, so the `/accountability` UI can talk to it over HTTP instead of importing Python internals.

## What Runs

The repo-root `docker compose --env-file .env.docker up --build` starts the full application:

- `web`: React app on `http://localhost:8080`.
- `dossier-api`: Node dossier API behind `/api/*`.
- `ship-service`: FastAPI on `http://localhost:8765`, with conversation persistence in `investigator.ship_*` tables that the service creates on startup.
- `cloud-sql-proxy`: local tunnel to the shared GCP Cloud SQL/pgvector database.
- `postgres`: optional local fallback profile, not used by the default local runtime.

The user flow is:

1. The UI creates a conversation with `POST /conversations`.
2. The user sends a natural-language question to `POST /conversations/{id}/messages`.
3. The service routes the question, runs bounded SQL/web/CanLII recipes against the real database, verifies the answer, stores the messages and recipe run, and returns one of the documented response types.
4. Streaming clients call the same message endpoint with `?stream=true` and receive SSE progress events ending in `final_response`.

## Local Setup

```bash
cp /home/david/GitHub/hackathon2026/.env .env.docker
# Confirm .env.docker has OPENAI_API_KEY, WEB_SEARCH_ENABLED, and CANLII_API_KEY.
deploy/gcp/configure-local-gcp-db.sh
```

The default local runtime now uses the GCP Cloud SQL database through Docker's `cloud-sql-proxy` service. Prepare the local seed only when you intentionally need the `local-postgres` fallback or when you are loading Cloud SQL from this repo:

```bash
node scripts/prepare-project-database-seed.mjs --source=/home/david/GitHub/hackathon2026 --hardlink
node scripts/export-entity-vectors.mjs --source-db=postgresql://hackathon:hackathon@localhost:5432/hackathon
```

```bash
docker compose --env-file .env.docker up --build
```

Health and conversation checks:

```bash
curl http://localhost:8080/healthz
curl http://localhost:8765/healthz
curl -s -X POST http://localhost:8765/conversations
curl -s -X POST http://localhost:8765/conversations/$ID/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"Show me the largest charity funding cycles"}'
curl -N -X POST "http://localhost:8765/conversations/$ID/messages?stream=true" \
  -H "Content-Type: application/json" \
  -d '{"content":"Show me the largest charity funding cycles"}'
```

If no real seed exists, Postgres initialization fails instead of starting an empty analytical database. That is intentional: the ship service should never show fake success for data-backed questions.

## Environment

Local secrets live in `.env.docker`, which is gitignored. Production secrets live in Secret Manager.

Required:

- `DATABASE_URL`
- `OPENAI_API_KEY`

Optional:

- `CANLII_API_KEY`
- `PRIMARY_MODEL` and `FAST_MODEL`, both defaulting to `gpt-5.5`
- `SHIP_PROMPT_CACHE_RETENTION`, defaulting to `24h`
- `SHIP_API_PORT`, defaulting to `8765` locally

Cloud Run and local Docker can omit `DATABASE_URL` when these are set instead:

- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `CLOUD_SQL_CONNECTION_NAME`
- or `DB_HOST`/`DB_PORT` when connecting through the local `cloud-sql-proxy` service

`scripts/start.sh` constructs the Cloud SQL Unix-socket `DATABASE_URL` at container startup without putting the password into a git-tracked file or deployment command.

## GCP Deployment

Full-app deployment scripts live in `deploy/gcp/`. The older service-only scripts under `services/ship/deploy/gcp/` are kept as service-level references, but the complete app should use the root deployment path.

```bash
cp deploy/gcp/env.example deploy/gcp/env

deploy/gcp/bootstrap.sh
deploy/gcp/load-data.sh
deploy/gcp/build-and-deploy.sh
```

The deployed app runs three Cloud Run services, connects both backends to the same Cloud SQL Postgres 16 database through the Cloud SQL connector, reads OpenAI/CanLII/database secrets from Secret Manager, and keeps ship conversation state in the `investigator` schema.
