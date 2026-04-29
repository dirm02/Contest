# GCP Docker Deployment

This folder deploys the full Maple DOGE application, not only the ship service.

## What Users See

The public entry point is the `maple-doge-web` Cloud Run service. It serves the built React app and proxies:

- `/api/*` to the Node dossier API Cloud Run service.
- `/ship-api/*` to the ship analyst FastAPI Cloud Run service.

Both backend services connect to the same Cloud SQL PostgreSQL database. That database is loaded from this repo's `services/postgres/seed/` assets, including the public-accountability schemas and `investigator.entity_embeddings` vectors.

## One-Time Setup

```bash
cp deploy/gcp/env.example deploy/gcp/env
# Edit deploy/gcp/env with your GCP project, region, Cloud SQL sizing, and service names.

export OPENAI_API_KEY="..."
export CANLII_API_KEY="..."

deploy/gcp/bootstrap.sh
```

`bootstrap.sh` enables required APIs, creates Artifact Registry, creates a PostgreSQL 16 Cloud SQL instance, creates the `hackathon` database/user, and writes secrets into Secret Manager.

## Load Data

Prepare local seed assets first:

```bash
node scripts/prepare-project-database-seed.mjs --source=/home/david/GitHub/hackathon2026 --hardlink
node scripts/export-entity-vectors.mjs --source-db=postgresql://hackathon:hackathon@localhost:5432/hackathon
```

Then load Cloud SQL:

```bash
deploy/gcp/load-data.sh
```

The load script prefers `services/postgres/seed/hackathon.dump` when present. Otherwise it imports the `.local-db` JSONL bundle and then imports the vector CSV into both `investigator.entity_embeddings` and `entity_vectors.entities`.

## Build And Deploy

```bash
deploy/gcp/build-and-deploy.sh
```

The script builds and deploys three Docker images:

- `maple-doge-web`
- `maple-doge-dossier-api`
- `maple-doge-ship-api`

At the end it prints the public web URL plus API health URLs.
