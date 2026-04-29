#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/env"
  set +a
fi

: "${PROJECT_ID:?must set PROJECT_ID}"
REGION="${REGION:-us-central1}"
REPOSITORY="${REPOSITORY:-ship}"
INSTANCE="${INSTANCE:-ship-postgres}"
DB_NAME="${DB_NAME:-hackathon}"
DB_USER="${DB_USER:-hackathon}"
DB_TIER="${DB_TIER:-db-custom-2-7680}"
DB_STORAGE_SIZE="${DB_STORAGE_SIZE:-50GB}"
DB_AVAILABILITY="${DB_AVAILABILITY:-zonal}"
DB_PASSWORD_SECRET="${DB_PASSWORD_SECRET:-ship-db-password}"
OPENAI_SECRET_NAME="${OPENAI_SECRET_NAME:-openai-api-key}"
CANLII_SECRET_NAME="${CANLII_SECRET_NAME:-canlii-api-key}"
RUNTIME_SA="${RUNTIME_SA:-ship-service}"
RUNTIME_SA_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID" >/dev/null

gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  compute.googleapis.com \
  storage.googleapis.com \
  iam.googleapis.com

if ! gcloud artifacts repositories describe "$REPOSITORY" --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Ship analyst service images"
fi

if ! gcloud iam service-accounts describe "$RUNTIME_SA_EMAIL" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$RUNTIME_SA" \
    --display-name="Ship analyst Cloud Run runtime"
fi

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/cloudsql.client" \
  --quiet >/dev/null

if ! gcloud sql instances describe "$INSTANCE" >/dev/null 2>&1; then
  gcloud sql instances create "$INSTANCE" \
    --database-version=POSTGRES_16 \
    --tier="$DB_TIER" \
    --region="$REGION" \
    --storage-size="$DB_STORAGE_SIZE" \
    --storage-auto-increase \
    --availability-type="$DB_AVAILABILITY"
fi

if ! gcloud sql databases describe "$DB_NAME" --instance="$INSTANCE" >/dev/null 2>&1; then
  gcloud sql databases create "$DB_NAME" --instance="$INSTANCE"
fi

if ! gcloud sql users list --instance="$INSTANCE" --format="value(name)" | grep -qx "$DB_USER"; then
  DB_PASSWORD="$(openssl rand -hex 24)"
  gcloud sql users create "$DB_USER" --instance="$INSTANCE" --password="$DB_PASSWORD"
  if gcloud secrets describe "$DB_PASSWORD_SECRET" >/dev/null 2>&1; then
    printf '%s' "$DB_PASSWORD" | gcloud secrets versions add "$DB_PASSWORD_SECRET" --data-file=-
  else
    printf '%s' "$DB_PASSWORD" | gcloud secrets create "$DB_PASSWORD_SECRET" \
      --replication-policy=automatic \
      --data-file=-
  fi
else
  if ! gcloud secrets describe "$DB_PASSWORD_SECRET" >/dev/null 2>&1; then
    echo "Cloud SQL user ${DB_USER} already exists, but Secret Manager secret ${DB_PASSWORD_SECRET} does not." >&2
    echo "Create it with: printf '%s' 'EXISTING_PASSWORD' | gcloud secrets create ${DB_PASSWORD_SECRET} --replication-policy=automatic --data-file=-" >&2
  fi
fi

grant_secret_access() {
  local secret_name="$1"
  if gcloud secrets describe "$secret_name" >/dev/null 2>&1; then
    gcloud secrets add-iam-policy-binding "$secret_name" \
      --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
      --role="roles/secretmanager.secretAccessor" \
      --quiet >/dev/null
  fi
}

grant_secret_access "$DB_PASSWORD_SECRET"

for secret_name in "$OPENAI_SECRET_NAME" "$CANLII_SECRET_NAME"; do
  if gcloud secrets describe "$secret_name" >/dev/null 2>&1; then
    grant_secret_access "$secret_name"
  else
    echo "Create secret ${secret_name} with: printf '%s' 'VALUE' | gcloud secrets create ${secret_name} --replication-policy=automatic --data-file=-"
  fi
done

echo "Bootstrap complete."
echo "Cloud SQL connection name: ${PROJECT_ID}:${REGION}:${INSTANCE}"
echo "Runtime service account: ${RUNTIME_SA_EMAIL}"

