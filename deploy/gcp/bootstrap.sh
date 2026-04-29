#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy deploy/gcp/env.example to deploy/gcp/env first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${REGION:?REGION is required}"
: "${ARTIFACT_REPOSITORY:?ARTIFACT_REPOSITORY is required}"
: "${CLOUD_SQL_INSTANCE:?CLOUD_SQL_INSTANCE is required}"
: "${CLOUD_SQL_DATABASE:?CLOUD_SQL_DATABASE is required}"
: "${CLOUD_SQL_USER:?CLOUD_SQL_USER is required}"
: "${CLOUD_SQL_TIER:?CLOUD_SQL_TIER is required}"
: "${CLOUD_SQL_STORAGE_GB:?CLOUD_SQL_STORAGE_GB is required}"

gcloud config set project "$PROJECT_ID"

gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com

gcloud artifacts repositories describe "$ARTIFACT_REPOSITORY" \
  --location "$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$ARTIFACT_REPOSITORY" \
    --repository-format docker \
    --location "$REGION" \
    --description "Maple DOGE Docker images"

if ! gcloud sql instances describe "$CLOUD_SQL_INSTANCE" >/dev/null 2>&1; then
  gcloud sql instances create "$CLOUD_SQL_INSTANCE" \
    --database-version POSTGRES_16 \
    --region "$REGION" \
    --tier "$CLOUD_SQL_TIER" \
    --storage-size "$CLOUD_SQL_STORAGE_GB" \
    --storage-type SSD \
    --availability-type zonal
fi

gcloud sql databases describe "$CLOUD_SQL_DATABASE" \
  --instance "$CLOUD_SQL_INSTANCE" >/dev/null 2>&1 || \
  gcloud sql databases create "$CLOUD_SQL_DATABASE" --instance "$CLOUD_SQL_INSTANCE"

DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -base64 36 | tr -d '\n')}"
if ! gcloud sql users list --instance "$CLOUD_SQL_INSTANCE" --format='value(name)' | grep -qx "$CLOUD_SQL_USER"; then
  gcloud sql users create "$CLOUD_SQL_USER" \
    --instance "$CLOUD_SQL_INSTANCE" \
    --password "$DB_PASSWORD"
else
  gcloud sql users set-password "$CLOUD_SQL_USER" \
    --instance "$CLOUD_SQL_INSTANCE" \
    --password "$DB_PASSWORD"
fi

upsert_secret() {
  local name="$1"
  local value="$2"
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=-
  else
    printf '%s' "$value" | gcloud secrets create "$name" --data-file=-
  fi
}

upsert_secret maple-doge-db-password "$DB_PASSWORD"

if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  upsert_secret maple-doge-openai-api-key "$OPENAI_API_KEY"
else
  echo "OPENAI_API_KEY is not set in the shell. Add it to Secret Manager before deploying ship-service." >&2
fi

if [[ -n "${CANLII_API_KEY:-}" ]]; then
  upsert_secret maple-doge-canlii-api-key "$CANLII_API_KEY"
else
  echo "CANLII_API_KEY is not set in the shell. Add it to Secret Manager before running CanLII-enabled flows." >&2
fi

echo "Bootstrap complete for project $PROJECT_ID."
echo "Cloud SQL instance: $CLOUD_SQL_INSTANCE"
echo "Artifact Registry: $REGION-docker.pkg.dev/$PROJECT_ID/$ARTIFACT_REPOSITORY"
echo "Repo root: $REPO_ROOT"
