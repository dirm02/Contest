# GCP Deployment Runbook

This deploys the ship analyst as a Cloud Run service backed by Cloud SQL Postgres 16. The frontend continues to call the service over HTTPS; the ship container stays stateless, while the `investigator.ship_*` tables store conversations and recipe runs inside Postgres.

## 1. Prepare Environment

```bash
cp services/ship/deploy/gcp/env.example services/ship/deploy/gcp/env
```

Edit `env`:

- `PROJECT_ID`: target GCP project.
- `REGION`: Cloud Run, Artifact Registry, bucket, and Cloud SQL region.
- `INSTANCE`, `DB_NAME`, `DB_USER`: Cloud SQL names.
- `DUMP_PATH`: local path to `hackathon.dump`, `hackathon.sql`, or `hackathon.sql.gz`.
- `BUCKET`: staging bucket for the database seed.

Store real secrets in Secret Manager, not in `env`:

```bash
printf '%s' 'OPENAI_KEY_VALUE' | gcloud secrets create openai-api-key --replication-policy=automatic --data-file=-
printf '%s' 'CANLII_KEY_VALUE' | gcloud secrets create canlii-api-key --replication-policy=automatic --data-file=-
```

## 2. Bootstrap Cloud Resources

```bash
services/ship/deploy/gcp/bootstrap.sh
```

The script is safe to re-run. It enables required APIs, creates the Artifact Registry repository, creates the Cloud Run runtime service account, provisions Cloud SQL when missing, creates the database/user when missing, and grants the runtime service account access to Cloud SQL and existing secrets.

Cloud SQL sizing defaults to `db-custom-2-7680`, 50 GB storage, zonal availability. Raise those values in `env` for a longer-lived production deployment.

## 3. Load Data

Preferred dump for local Docker is custom format:

```bash
pg_dump -h localhost -U hackathon -F c -d hackathon -f hackathon.dump
```

Cloud SQL has two import paths:

- Plain SQL dumps (`hackathon.sql` or `hackathon.sql.gz`) use `gcloud sql import sql` from the GCS bucket.
- Custom dumps (`hackathon.dump`) restore through a local Cloud SQL Auth Proxy with `pg_restore`.

For custom dumps, install these local tools first:

- `cloud-sql-proxy`
- `pg_restore` and `psql` from PostgreSQL 16 client tools

Then run:

```bash
services/ship/deploy/gcp/load-data.sh
```

For idempotent custom-format re-runs, `PG_RESTORE_CLEAN=true` is the default, which passes `--clean --if-exists` to `pg_restore`. For plain SQL, create the dump with `pg_dump -F p --clean --if-exists` if you need repeatable imports.

The script creates `pg_trgm`, `fuzzystrmatch`, `pgcrypto`, and `investigator` after a custom restore. The ship service creates `investigator.ship_conversations`, `investigator.ship_messages`, and `investigator.ship_recipe_runs` on startup.

## 4. Deploy Service

```bash
services/ship/deploy/gcp/deploy-service.sh
```

The deploy script builds `services/ship` with Cloud Build, pushes the image to Artifact Registry, and deploys Cloud Run with:

- 2 GiB memory
- 2 vCPU
- concurrency 8
- 300 second timeout
- scale-to-zero by default
- Cloud SQL socket mounted through `--add-cloudsql-instances`
- secrets mounted as environment variables

It prints the Cloud Run URL. Verify:

```bash
curl "$SERVICE_URL/healthz"
curl -s -X POST "$SERVICE_URL/conversations"
curl -N -X POST "$SERVICE_URL/conversations/$ID/messages?stream=true" \
  -H "Content-Type: application/json" \
  -d '{"content":"Show me the largest charity funding cycles"}'
```

If cold start is above 10 seconds, set `MIN_INSTANCES=1` in `env` and rerun `deploy-service.sh`.

## Optional Cloud Build Config

`cloudbuild.yaml` can be used directly:

```bash
gcloud builds submit services/ship --config services/ship/deploy/gcp/cloudbuild.yaml
```

Before using it in CI, make sure the Cloud Build service account has permission to deploy Cloud Run, use the runtime service account, push to Artifact Registry, and update services with Secret Manager references.

