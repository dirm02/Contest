# GCP Docker Deployment

This folder deploys the full Maple DOGE application, not only the ship service.

## What Users See

The public entry point is the `maple-doge-web` Cloud Run service. It serves the built React app and proxies:

- `/api/*` to the Node dossier API Cloud Run service.
- `/ship-api/*` to the ship analyst FastAPI Cloud Run service.

Both backend services connect to the same Cloud SQL PostgreSQL database. That database is loaded from this repo's `services/postgres/seed/` assets, including the public-accountability schemas and `investigator.entity_embeddings` vectors.

## Project Split

Use `agency2026ot-doge-v-0429` for the application runtime: Cloud Run, Cloud SQL, Artifact Registry, and Secret Manager.

Keep source-data BigQuery on `agency2026ot-data-1776775157`. The web screen flow may call deployed APIs in the app project, but BigQuery-backed analytical endpoints still read from the data project.

## One-Time Setup

```bash
cp deploy/gcp/env.example deploy/gcp/env
# Edit deploy/gcp/env only if the live Cloud SQL instance/service names differ from the defaults.

export OPENAI_API_KEY="..."
export CANLII_API_KEY="..."

deploy/gcp/bootstrap.sh
```

`bootstrap.sh` enables required APIs, creates Artifact Registry, creates a PostgreSQL 16 Cloud SQL instance, creates the `hackathon` database/user, and writes secrets into Secret Manager.

## Load Data

Prepare local seed assets first:

```bash
node scripts/prepare-project-database-seed.mjs --source=/home/david/GitHub/hackathon2026 --hardlink
node scripts/export-entity-vectors.mjs --server-copy --source-db=postgresql://hackathon:hackathon@localhost:5432/hackathon --output=services/postgres/seed/entity-vectors/entity_vectors_full.csv.gz
```

Then load Cloud SQL:

```bash
deploy/gcp/load-data.sh
```

The load script prefers `services/postgres/seed/hackathon.dump` when present. Otherwise it imports the `.local-db` JSONL bundle and then imports the vector CSV or CSV.GZ into both `investigator.entity_embeddings` and `entity_vectors.entities`.

## Build And Deploy

```bash
deploy/gcp/build-and-deploy.sh
```

The script builds and deploys three Docker images:

- `maple-doge-web`
- `maple-doge-dossier-api`
- `maple-doge-ship-api`

At the end it prints the public web URL plus API health URLs.

## Point The UI At Existing APIs

If another process already created the database and deployed the API services, you do not need to reload data just to update the UI routing. Set or confirm `DOSSIER_API_SERVICE`, `SHIP_API_SERVICE`, and `WEB_SERVICE` in `deploy/gcp/env`, then run:

```bash
deploy/gcp/update-web-routing.sh
```

The web service will keep serving the same React screens. The only visible behavior change is that `/api` and `/ship-api` now route to the API services connected to the GCP Cloud SQL database.

## Use The GCP Database Locally

Local Docker uses the same GCP database by default. Once the Cloud SQL instance and `maple-doge-db-password` secret exist, run:

```bash
deploy/gcp/configure-local-gcp-db.sh
docker compose --env-file .env.docker up --build
```

The script writes Cloud SQL connection settings into the gitignored `.env.docker` file. It does not print the database password. The browser entry point remains `http://localhost:8080`, with `/api` and `/ship-api` handled locally while both backends use the GCP database through the `cloud-sql-proxy` container.

The proxy needs local Google Application Default Credentials:

```bash
gcloud auth application-default login
```
